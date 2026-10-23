// The system loss of a PV system (`system_loss`) is a parameter of the place,
// resolved by `parameter_of()` (decision 0055): the profiles that fold their
// losses into one name it without a value; the system, its participant, its
// project or its organisation say it, and the generic level the module
// publishes, PVGIS PVcalc's 14 %, answers when none does. The estimate keeps
// the fraction and where it was found. Without years, a `pvgis_like`
// estimate reads every year PVGIS covers and gives their mean.
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { pvgis } from '@nexgen-os/pvgis';
import type { Fetch } from '@nexgen-os/core';
import { estimateYield } from '../src/yield.js';
import { USER_A, freshDatabase, insert, one, organisation, participant, repoRoot } from '../../../tests/helpers/db.js';

interface Hourly { time: string; P: number }
interface Recorded { inputs: { meteo_data: { year_min: number; year_max: number } }; outputs: { hourly: Hourly[] } }

let db: PGlite;
let org: string;
let project: string;
let home: string;
let system: string;
let recorded: Recorded;
const asked: string[] = [];

const answering = (body: unknown) => pvgis({
  fetch: (async (url: string) => {
    asked.push(url);
    return { ok: true, status: 200, json: async () => body };
  }) as Fetch,
});

const lossAsked = () => new URL(asked.at(-1) as string).searchParams.get('loss');

async function say(kind: string, id: string, fraction: number) {
  await db.query(`select set_attribute($1, $2, 'system_loss', $3::jsonb, null, null, 'measured on its installations', 'measured')`, [kind, id, JSON.stringify(fraction)]);
}

beforeAll(async () => {
  db = await freshDatabase(['solar']);
  recorded = JSON.parse(await readFile(`${repoRoot}/tests/fixtures/pvgis-seriescalc-brussels-2023-48h.json`, 'utf8')) as Recorded;
  org = await organisation(db, 'A cooperative', USER_A);
  project = await insert(db, 'projects', { organisation_id: org, name: 'Rooftops', country: 'BE' });
  home = await participant(db, { organisation_id: org, project_id: project, name: 'Hall', country: 'BE', time_zone: 'Europe/Brussels', geometry: { type: 'Point', coordinates: [4.35, 50.85] } });
  system = await insert(db, 'devices', { organisation_id: org, participant_id: home, name: 'Roof PV', device_type: 'solar', rated_power_kw: 6 });
  await db.query('insert into solar.devices (id, kwp_dc) values ($1, 6)', [system]);
  await db.query(`insert into solar.pv_arrays (organisation_id, device_id, azimuth_deg, tilt_deg, name, mounting, kwp_dc) values ($1, $2, 180, 30, 'South', 'roof_parallel', 6)`, [org, system]);
});

afterAll(async () => {
  await db.close();
});

describe('system_loss', () => {
  it('is named without a value by the profiles that fold their losses into one', async () => {
    const profiles = (await db.query<{ code: string; losses: unknown }>(`select code, losses from solar.yield_profiles where code in ('pvgis_like', 'pvwatts') order by code`)).rows;
    expect(profiles).toEqual([
      { code: 'pvgis_like', losses: [{ code: 'system', pct: null }] },
      { code: 'pvwatts', losses: [{ code: 'system', pct: null }] },
    ]);
  });

  it('is the generic level the module publishes, PVGIS PVcalc\'s 14 %, when no place says it', async () => {
    const result = await estimateYield(db, { deviceId: system, years: { from: 2023, to: 2023 } }, answering(recorded));
    expect(lossAsked()).toBe('14');
    const { inputs } = await one<{ inputs: Record<string, unknown> }>(db, 'select inputs from solar.estimates where id = $1', [result.estimateId]);
    expect(inputs.losses).toEqual([{ code: 'system', pct: 14 }]);
    expect(inputs.system_loss).toMatchObject({ fraction: 0.14, level: 'generic', source_code: 'pvgis', status: 'default' });
    const chain = await one<Record<string, unknown>>(db, 'select code, fraction::float8, source_code, status from solar.estimate_losses where estimate_id = $1', [result.estimateId]);
    expect(chain).toEqual({ code: 'system', fraction: 0.14, source_code: 'pvgis', status: 'default' });
  });

  it('is the organisation\'s, then the project\'s, then the participant\'s, then the system\'s, the most specific answering', async () => {
    const cases: [string, string, number, string][] = [
      ['organisation', org, 0.025, '2.5'],
      ['project', project, 0.03, '3'],
      ['participant', home, 0.04, '4'],
      ['device', system, 0.05, '5'],
    ];
    for (const [kind, id, fraction, pct] of cases) {
      await say(kind, id, fraction);
      const result = await estimateYield(db, { deviceId: system, years: { from: 2023, to: 2023 } }, answering(recorded));
      expect(lossAsked()).toBe(pct);
      const { inputs } = await one<{ inputs: { system_loss: Record<string, unknown> } }>(db, 'select inputs from solar.estimates where id = $1', [result.estimateId]);
      expect(inputs.system_loss).toMatchObject({ fraction, level: kind === 'device' ? 'object' : kind, object_id: id, status: 'measured' });
      const chain = await one<{ reference: string; status: string }>(db, 'select reference, status from solar.estimate_losses where estimate_id = $1', [result.estimateId]);
      expect(chain).toEqual({ reference: 'measured on its installations', status: 'measured' });
    }
  });

  it('takes zero as a value, not as unset', async () => {
    await db.query(`select set_attribute('device', $1, 'system_loss', '0'::jsonb, now(), null, 'a loss counted elsewhere', 'estimated')`, [system]);
    // The year asked starts before the zero was set: the system's 5 % held then.
    await estimateYield(db, { deviceId: system, years: { from: 2023, to: 2023 } }, answering(recorded));
    expect(lossAsked()).toBe('5');
    await estimateYield(db, { deviceId: system, years: { from: new Date().getUTCFullYear() + 1, to: new Date().getUTCFullYear() + 1 } }, answering(recorded));
    expect(lossAsked()).toBe('0');
  });
});

describe('a pvgis_like estimate without years', () => {
  it('reads every year PVGIS covers and gives their mean annual', async () => {
    // Two years of the recorded hours: 2022 and 2023, the second twice the first.
    const twoYears: Recorded = {
      ...recorded,
      inputs: { ...recorded.inputs, meteo_data: { ...recorded.inputs.meteo_data, year_min: 2022, year_max: 2023 } },
      outputs: { hourly: [
        ...recorded.outputs.hourly.map((h) => ({ ...h, time: `2022${h.time.slice(4)}` })),
        ...recorded.outputs.hourly.map((h) => ({ ...h, P: h.P * 2 })),
      ] },
    };
    const result = await estimateYield(db, { deviceId: system }, answering(twoYears));
    const params = new URL(asked.at(-1) as string).searchParams;
    expect([params.has('startyear'), params.has('endyear')]).toEqual([false, false]);
    const oneYearKwh = recorded.outputs.hourly.reduce((s, h) => s + h.P, 0) / 1000;
    expect(result.annualKwh).toBeCloseTo((oneYearKwh * 3) / 2, 3);
    const { inputs } = await one<{ inputs: { weather: Record<string, unknown> } }>(db, 'select inputs from solar.estimates where id = $1', [result.estimateId]);
    expect(inputs.weather).toMatchObject({ years: { from: 2022, to: 2023 }, years_asked: 'every year the radiation database covers' });
  });

  it('is refused by name for a profile that computes the years it is given', async () => {
    await expect(estimateYield(db, { deviceId: system, profileCode: 'pvwatts' })).rejects.toThrow(/^years_required: pvwatts/);
  });
});
