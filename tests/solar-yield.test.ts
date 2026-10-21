// A yield run of the `pvgis_like` profile on a system of two arrays: the
// energies of the arrays add up hour by hour, the series lands as simulated
// production of the system, and the run records the weather, the years, the
// arrays, the losses and the conventions it was computed with.
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { pvgis } from '@nexgen-os/pvgis';
import type { Fetch } from '@nexgen-os/core';
import { runYield } from '../modules/solar/src/yield.js';
import { USER_A, freshDatabase, insert, one, organisation, repoRoot, participant } from './helpers/db.js';

let db: PGlite;
let org: string;
let site: string;
let system: string;
const asked: string[] = [];

beforeAll(async () => {
  db = await freshDatabase(['solar']);
  org = await organisation(db, 'A cooperative', USER_A);
  site = await participant(db, { organisation_id: org, name: 'Hall', country: 'BE', time_zone: 'Europe/Brussels', geometry: { type: 'Point', coordinates: [4.35, 50.85] } });
  system = await insert(db, 'devices', { organisation_id: org, participant_id: site, name: 'Roof PV', device_type: 'solar', rated_power_kw: 30 });
  await db.query('insert into solar.pv_systems (id, kwp_dc) values ($1, 30)', [system]);
  // One statement each: arrays are read in the order they were created, and one statement gives both the same time.
  await db.query(`insert into solar.pv_arrays (organisation_id, pv_system_id, azimuth_deg, tilt_deg, name, mounting, kwp_dc) values ($1, $2, 180, 30, 'South', 'roof_parallel', 20)`, [org, system]);
  await db.query(`insert into solar.pv_arrays (organisation_id, pv_system_id, azimuth_deg, tilt_deg, name, mounting, kwp_dc) values ($1, $2, 90, 30, 'East', 'roof_parallel', 10)`, [org, system]);
});

afterAll(async () => {
  await db.close();
});

describe('a pvgis_like yield run', () => {
  it('asks PVGIS once per array, adds the energies, stores them as simulated production and records the run', async () => {
    const recorded = JSON.parse(await readFile(`${repoRoot}/tests/fixtures/pvgis-seriescalc-brussels-2023-48h.json`, 'utf8')) as { outputs: { hourly: { P: number }[] } };
    const fetch: Fetch = async (url) => {
      asked.push(url);
      return { ok: true, status: 200, json: async () => recorded };
    };
    const result = await runYield(db, { pvSystemId: system, years: { from: 2023, to: 2023 } }, pvgis({ fetch }));

    expect(asked).toHaveLength(2);
    const params = asked.map((u) => Object.fromEntries(new URL(u).searchParams)).sort((a, b) => Number(b.peakpower) - Number(a.peakpower));
    expect(params.map((p) => [p.peakpower, p.aspect, p.angle, p.loss, p.mountingplace])).toEqual([['20', '0', '30', '14', 'building'], ['10', '-90', '30', '14', 'building']]);

    // The recorded answer is the 1 kWp one and is served to both arrays: the run adds the two answers.
    const recordedKwh = recorded.outputs.hourly.reduce((s, h) => s + h.P, 0) / 1000;
    expect(result.kwp).toBe(30);
    expect(result.annualKwh).toBeCloseTo(recordedKwh * 2, 3);
    expect(result.kwhPerKwp).toBeCloseTo((recordedKwh * 2) / 30, 3);
    expect(result.radiationDb).toBe('PVGIS-SARAH3');

    const series = await one<{ kind: string; source: string; n: number; max: number }>(
      db,
      `select s.kind, s.source_code source, count(v.*)::int n, max(v.value)::float max
         from series s join series_values v on v.series_id = s.id
        where s.id = $1 group by s.kind, s.source_code`,
      [result.seriesId],
    );
    expect(series).toEqual({ kind: 'simulated', source: 'pvgis', n: 48, max: Math.round(0.35008 * 2 * 1e6) / 1e6 });

    const run = await one<{ module_code: string; status: string; inputs: Record<string, unknown>; results: Record<string, unknown> }>(db, 'select module_code, status, inputs, results from runs where id = $1', [result.runId]);
    expect(run.module_code).toBe('solar');
    expect(run.status).toBe('succeeded');
    expect(run.inputs).toMatchObject({
      profile: 'pvgis_like',
      weather: { source: 'pvgis', radiation_db: 'PVGIS-SARAH3', years: { from: 2023, to: 2023 } },
      conventions: { time: 'interval start, UTC' },
    });
    const arrays = (run.inputs.arrays as { kwp: number; azimuth_deg: number; tilt_deg: number }[]).sort((a, b) => b.kwp - a.kwp);
    expect(arrays).toMatchObject([{ kwp: 20, azimuth_deg: 180, tilt_deg: 30 }, { kwp: 10, azimuth_deg: 90, tilt_deg: 30 }]);
    expect(run.results).toMatchObject({ series_id: result.seriesId, kwp: 30 });
  });

  it('throws named errors for a profile PVGIS cannot run and a system whose site has no position', async () => {
    await expect(runYield(db, { pvSystemId: system, years: { from: 2023, to: 2023 }, profileCode: 'pvsyst_like' })).rejects.toThrow(/profile_not_runnable_here/);
    const nowhere = await participant(db, { organisation_id: org, name: 'Nowhere', country: 'BE' });
    const device = await insert(db, 'devices', { organisation_id: org, participant_id: nowhere, name: 'PV', device_type: 'solar', rated_power_kw: 5 });
    await db.query('insert into solar.pv_systems (id, kwp_dc) values ($1, 5)', [device]);
    await expect(runYield(db, { pvSystemId: device, years: { from: 2023, to: 2023 } })).rejects.toThrow(/site_without_position/);
  });
});
