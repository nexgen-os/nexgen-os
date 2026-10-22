// `nexgen-os solar estimate`: a PV system at a point and its yield by month,
// in one command, as a person under row level security — the participant,
// its device, the system and its array of the `solar` module written in its
// place, then the module's estimate. PVGIS answers from a recorded response.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { Computations, Fetch } from '@nexgen-os/core';
import { pvgis } from '@nexgen-os/pvgis';
import { estimateYield } from '../../../modules/solar/src/yield.js';
import { main } from '../src/index.js';
import { USER_A, USER_B, freshDatabase, one, organisation, repoRoot, sqlClient } from '../../../tests/helpers/db.js';

const recorded = JSON.parse(
  await readFile(join(repoRoot, 'tests', 'fixtures', 'pvgis-seriescalc-brussels-2023-48h.json'), 'utf8'),
) as { outputs: { hourly: { P: number }[] } };

const asked: string[] = [];
const fetch: Fetch = async (url) => {
  asked.push(url);
  return { ok: true, status: 200, json: async () => recorded };
};
const computations: Computations = {
  'solar.yield': ((db, request) => estimateYield(db, request, { pvgis: pvgis({ fetch }) })) as Computations['solar.yield'],
};

let db: PGlite;
let project: string;

async function run(argv: string[], user = USER_A, given: Computations = computations) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, {
    out: (l) => out.push(l), err: (l) => err.push(l),
    env: { NEXGEN_DB_URL: 'pglite://', NEXGEN_ACT_AS_USER_ID: user }, open: async () => sqlClient(db),
    computations: given,
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const POINT = ['--project', '', '--name', 'Roof of the hall', '--country', 'ZZ', '--time-zone', 'Europe/Brussels',
  '--lon', '4.35', '--lat', '50.85', '--kwp', '6', '--azimuth', '135', '--tilt', '25', '--year', '2023'];
const at = (p: string) => POINT.map((v, i) => (i === 1 ? p : v));

beforeAll(async () => {
  db = await freshDatabase(['solar']);
  const org = await organisation(db, 'A cooperative', USER_A);
  await db.query(`insert into auth.users (id) values ($1) on conflict do nothing`, [USER_B]);
  project = (await one<{ id: string }>(db, `insert into projects (organisation_id, name, country) values ($1, 'Rooftops', 'ZZ') returning id`, [org])).id;
});

afterAll(async () => {
  await db.close();
});

describe('nexgen-os solar estimate', () => {
  it('writes the participant, its PV system and its array, and gives the yield by month with its provenance', async () => {
    const r = await run(['solar', 'estimate', ...at(project), '--json']);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    const answer = JSON.parse(r.out);

    // One array with the orientation asked, in PVGIS's convention (0 = south, east negative).
    const params = Object.fromEntries(new URL(asked.at(-1) as string).searchParams);
    expect([params.lat, params.lon, params.peakpower, params.aspect, params.angle]).toEqual(['50.85', '4.35', '6', '-45', '25']);

    const recordedKwh = recorded.outputs.hourly.reduce((s, h) => s + h.P, 0) / 1000;
    expect(answer.annual_kwh).toBeCloseTo(recordedKwh, 3);
    expect(answer.months).toEqual([{ month: '2023-01', kwh: Math.round(recordedKwh * 10) / 10 }]);
    expect(answer.provenance).toBe('pvgis-5.3+solar-0.3.0');

    const written = await one<Record<string, unknown>>(db, `
      select p.name, p.project_id, p.time_zone, p.location_precision, round(ST_X(p.geometry)::numeric, 2)::float8 lon,
             d.device_type, d.rated_power_kw::float8 kw, sd.kwp_dc::float8 kwp,
             a.azimuth_deg::float8 azimuth, a.tilt_deg::float8 tilt, a.kwp_dc::float8 array_kwp, e.device_id = d.id same_device
        from participants p join devices d on d.participant_id = p.id join solar.devices sd on sd.id = d.id
        join solar.pv_arrays a on a.device_id = d.id join solar.estimates e on e.id = $2
       where p.id = $1`, [answer.participant_id, answer.estimate_id]);
    expect(written).toEqual({
      name: 'Roof of the hall', project_id: project, time_zone: 'Europe/Brussels', location_precision: 'rooftop', lon: 4.35,
      device_type: 'solar', kw: 6, kwp: 6, azimuth: 135, tilt: 25, array_kwp: 6, same_device: true,
    });
  });

  it('acts as the person: someone outside the organisation writes nothing', async () => {
    const before = await one<{ n: number }>(db, 'select count(*)::int n from participants');
    const r = await run(['solar', 'estimate', ...at(project)], USER_B);
    expect(r.code).toBe(1);
    expect((await one<{ n: number }>(db, 'select count(*)::int n from participants')).n).toBe(before.n);
  });

  it('refuses by name without the code of the solar module, and keeps nothing of the attempt', async () => {
    const before = await one<{ n: number }>(db, 'select count(*)::int n from solar.devices');
    const r = await run(['solar', 'estimate', ...at(project)], USER_A, {});
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^computation_not_loaded: /);
    expect((await one<{ n: number }>(db, 'select count(*)::int n from solar.devices')).n).toBe(before.n);
  });

  it('asks for the country and the orientation rather than assuming them', async () => {
    const noCountry = await run(['solar', 'estimate', ...at(project).filter((_, i) => i !== 4 && i !== 5)]);
    expect(noCountry.code).toBe(2);
    expect(noCountry.err).toBe('usage: --country is required');
    const tilt = await run(['solar', 'estimate', ...at(project).map((v, i) => (i === 17 ? 'flat' : v))]);
    expect(tilt.code).toBe(2);
    expect(tilt.err).toBe('usage: --tilt takes a number');
  });
});
