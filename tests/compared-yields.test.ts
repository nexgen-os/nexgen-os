// The compared case of `docs/demo/compared.ts` on recorded answers: a 1 kWp
// roof in Brussels facing south at 35°, its 2023 yield by PVGIS (SARAH3,
// recorded from PVGIS 5.3) and by the module's PVWatts on the ERA5 reanalysis
// (recorded from the Open-Meteo archive), month by month. The figures of
// `docs/demo/README.md` are the ones asserted here: a change of a method
// that moves them shows in this test before it shows in a study.
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { pvgis } from '@nexgen-os/pvgis';
import { openMeteo } from '@nexgen-os/open-meteo';
import type { Fetch } from '@nexgen-os/core';
import { compareYields, comparisonTable, type Comparison } from '../docs/demo/compared.js';
import { USER_A, freshDatabase, insert, organisation, participant, repoRoot } from './helpers/db.js';
import { installed, pvlibEngine } from './helpers/engines.js';

const pvlib = await installed(pvlibEngine);

// PVWatts v5's temperature coefficient of a standard crystalline module (NREL's manual, 2014).
const GAMMA_STANDARD_MODULE = -0.0037;

let db: PGlite;
let system: string;

async function recorded(name: string): Promise<unknown> {
  return JSON.parse(gunzipSync(await readFile(`${repoRoot}/tests/fixtures/compared/${name}.json.gz`)).toString('utf8'));
}

function serving(answer: unknown, asked: string[]): Fetch {
  return async (url) => {
    asked.push(url);
    return { ok: true, status: 200, json: async () => answer };
  };
}

beforeAll(async () => {
  db = await freshDatabase(['solar']);
  const org = await organisation(db, 'A roof in Brussels', USER_A);
  const home = await participant(db, { organisation_id: org, name: 'Roof', country: 'BE', time_zone: 'Europe/Brussels', geometry: { type: 'Point', coordinates: [4.35, 50.85] } });
  system = await insert(db, 'devices', { organisation_id: org, participant_id: home, name: 'Roof PV', device_type: 'solar', rated_power_kw: 1 });
  await db.query('insert into solar.devices (id, kwp_dc) values ($1, 1)', [system]);
  await db.query(`insert into solar.pv_arrays (organisation_id, device_id, azimuth_deg, tilt_deg, name, mounting, kwp_dc) values ($1, $2, 180, 35, 'South', 'roof_parallel', 1)`, [org, system]);
});

afterAll(async () => {
  await db.close();
});

describe('a compared yield, PVGIS against the module\'s PVWatts', () => {
  let comparison: Comparison;
  const askedPvgis: string[] = [];
  const askedWeather: string[] = [];

  beforeAll(async () => {
    comparison = await compareYields(db, system, 2023, {
      gammaPdc: GAMMA_STANDARD_MODULE,
      clients: {
        pvgis: pvgis({ fetch: serving(await recorded('pvgis-seriescalc-brussels-2023-south35'), askedPvgis) }),
        weather: openMeteo({ fetch: serving(await recorded('open-meteo-era5-brussels-2023-south35'), askedWeather) }),
      },
    });
  });

  it('asks each source for the same array and year as the recorded answers', () => {
    const p = Object.fromEntries(new URL(askedPvgis[0]).searchParams);
    expect(askedPvgis).toHaveLength(1);
    expect([p.peakpower, p.aspect, p.angle, p.loss, p.startyear, p.endyear]).toEqual(['1', '0', '35', '14', '2023', '2023']);
    const w = Object.fromEntries(new URL(askedWeather[0]).searchParams);
    expect(askedWeather).toHaveLength(1);
    expect([w.tilt, w.azimuth, w.models, w.start_date, w.end_date]).toEqual(['35', '0', 'era5', '2022-12-31', '2024-01-02']);
  });

  it('records each method as an estimate and reads its twelve months back', async () => {
    expect(comparison.yields.map((y) => y.name)).toEqual(['PVGIS', 'PVWatts']);
    expect(comparison).toMatchObject({ year: 2023, kwp: 1, timeZone: 'Europe/Brussels', reference: 'PVGIS' });
    const { rows } = await db.query<{ id: string; profile: string }>(
      `select id, inputs->>'profile' profile from solar.estimates where id = any($1) order by created_at`,
      [comparison.yields.map((y) => y.estimateId)],
    );
    expect(rows.map((r) => r.profile).sort()).toEqual(['pvgis_like', 'pvwatts']);
    for (const y of comparison.yields) {
      expect(y.monthlyKwh).toHaveLength(12);
      expect(y.annualKwh).toBeCloseTo(y.monthlyKwh.reduce((s, v) => s + v, 0), 0);
    }
  });

  it('gives PVGIS the year it answered, whole', async () => {
    const answer = (await recorded('pvgis-seriescalc-brussels-2023-south35')) as { outputs: { hourly: { P: number }[] } };
    const kwh = answer.outputs.hourly.reduce((s, h) => s + h.P, 0) / 1000;
    expect(comparison.yields[0].annualKwh).toBeCloseTo(kwh, 0);
  });

  it('keeps the two within the gaps docs/demo/README.md announces: 12 % on the year, 20 % in a month from April to September', () => {
    const [gap] = comparison.gaps;
    expect(gap.name).toBe('PVWatts');
    expect(Math.abs(gap.annual)).toBeLessThan(0.12);
    for (let m = 3; m <= 8; m++) expect(Math.abs(gap.monthly[m] as number)).toBeLessThan(0.2);
  });

  it('reads nearly the same light from both sources: the gap is the models\', not the weather\'s', async () => {
    const answer = (await recorded('pvgis-seriescalc-brussels-2023-south35')) as { outputs: { hourly: { 'G(i)': number }[] } };
    const weather = (await recorded('open-meteo-era5-brussels-2023-south35')) as { hourly: { time: number[]; global_tilted_irradiance: number[] } };
    const pvgisPoa = answer.outputs.hourly.reduce((s, h) => s + h['G(i)'], 0) / 1000;
    // Open-Meteo stamps an hour's mean at its end.
    const [from, to] = [Date.parse('2023-01-01T00:00:00Z'), Date.parse('2024-01-01T00:00:00Z')];
    const era5Poa = weather.hourly.time.reduce((s, t, i) => {
      const at = t * 1000 - 3_600_000;
      return at >= from && at < to ? s + weather.hourly.global_tilted_irradiance[i] : s;
    }, 0) / 1000;
    expect(Math.round(pvgisPoa)).toBe(1287);
    expect(Math.round(era5Poa)).toBe(1267);
    expect(Math.abs(era5Poa / pvgisPoa - 1)).toBeLessThan(0.03);
    // Performance ratios: energy over light in the plane of the array.
    const [byPvgis, byPvwatts] = comparison.yields;
    expect(byPvgis.kwhPerKwp / pvgisPoa).toBeCloseTo(0.76, 2);
    expect(byPvwatts.kwhPerKwp / era5Poa).toBeCloseTo(0.854, 2);
  });

  it('prints the table the README shows', () => {
    expect(comparisonTable(comparison)).toMatchSnapshot();
  });
});

describe('a compared yield, the module\'s PVWatts against pvlib\'s', () => {
  it.skipIf(!pvlib)(`gives the same months by both programs, to a tenth of a kWh${pvlib ? '' : ` (skipped: the pvlib engine is not installed; ${pvlibEngine.install})`}`, async () => {
    const weather = await recorded('open-meteo-era5-brussels-2023-south35');
    const c = await compareYields(db, system, 2023, {
      gammaPdc: GAMMA_STANDARD_MODULE,
      methods: [{ name: 'PVWatts', profileCode: 'pvwatts' }, { name: 'PVWatts by pvlib', profileCode: 'pvwatts', engine: { ...pvlibEngine, timeoutMs: 120_000 } }],
      clients: { weather: openMeteo({ fetch: serving(weather, []) }) },
    });
    const [ours, theirs] = c.yields;
    theirs.monthlyKwh.forEach((kwh, m) => expect(Math.abs(kwh - ours.monthlyKwh[m])).toBeLessThanOrEqual(0.1));
    expect(Math.abs(c.gaps[0].annual)).toBeLessThan(0.001);
  }, 180_000);
});

describe('a compared yield against another tool\'s report', () => {
  it('takes the gaps against the report, and refuses a report without its source or its twelve months', async () => {
    const clients = {
      pvgis: pvgis({ fetch: serving(await recorded('pvgis-seriescalc-brussels-2023-south35'), []) }),
    };
    // Not a published report: twelve figures that make the gaps easy to read.
    const report = { name: 'Report', source: 'a test figure, 80 kWh a month', monthly_kwh: new Array(12).fill(80) };
    const c = await compareYields(db, system, 2023, { methods: [{ name: 'PVGIS', profileCode: 'pvgis_like' }], reference: report, clients });
    expect(c.reference).toBe('Report');
    expect(c.yields.map((y) => [y.name, y.estimateId === null])).toEqual([['Report', true], ['PVGIS', false]]);
    expect(c.gaps[0].annual).toBeCloseTo(c.yields[1].annualKwh / 960 - 1, 4);

    await expect(compareYields(db, system, 2023, { reference: { ...report, source: '' }, clients })).rejects.toThrow(/reference_unsourced/);
    await expect(compareYields(db, system, 2023, { reference: { ...report, monthly_kwh: [80] }, clients })).rejects.toThrow(/reference_months_required/);
  });
});
