// The soiling of a place (`soiling_loss`): a column of a PV array, an
// attribute of its system or its participant, read the nearest first, that
// takes the place of a yield profile's own soiling loss. A profile that
// folds soiling into one aggregate loss keeps it, and the estimate says so.
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { Fetch } from '@nexgen-os/core';
import { openMeteo } from '@nexgen-os/open-meteo';
import { pvgis } from '@nexgen-os/pvgis';
import { remainingAfterLosses, withSoiling } from '../modules/solar/src/pvwatts.js';
import { estimateYield } from '../modules/solar/src/yield.js';
import { USER_A, freshDatabase, insert, one, organisation, repoRoot, participant } from './helpers/db.js';
import { syntheticArchive } from './helpers/weather.js';

const fake = { name: 'fake', command: [process.execPath, `${repoRoot}/tests/fixtures/connectors/fake.mjs`, 'pv_yield'] };

describe('withSoiling', () => {
  const pvsyst = [{ code: 'iam', pct: null }, { code: 'soiling', pct: 2 }, { code: 'lid', pct: 2 }];

  it('puts the place\'s soiling in place of the profile\'s, at its rank, as a percentage', () => {
    expect(withSoiling(pvsyst, 0.05)).toEqual({ losses: [{ code: 'iam', pct: null }, { code: 'soiling', pct: 5 }, { code: 'lid', pct: 2 }], applied: true });
    expect(remainingAfterLosses(withSoiling([{ code: 'soiling', pct: null }, { code: 'mismatch', pct: 1 }], 0.03).losses)).toBeCloseTo(0.97 * 0.99, 12);
  });

  it('leaves an aggregate loss alone, and the losses as they are when the place says nothing', () => {
    const aggregate = [{ code: 'system', pct: 14 }];
    expect(withSoiling(aggregate, 0.05)).toEqual({ losses: aggregate, applied: false });
    expect(withSoiling(pvsyst, null)).toEqual({ losses: pvsyst, applied: false });
  });

  it('refuses a soiling that is not a fraction', () => {
    expect(() => withSoiling(pvsyst, 5)).toThrow(/soiling_out_of_range/);
    expect(() => withSoiling(pvsyst, -0.01)).toThrow(/soiling_out_of_range/);
  });
});

let db: PGlite;
let org: string;
let home: string;
let system: string;
let south: string;
let east: string;

async function soiling(kind: string, objectId: string, value: number, source: string): Promise<void> {
  // An array says its own in its column; a system or a participant as an attribute, with its source.
  if (kind === 'pv_array') await db.query('update solar.pv_arrays set soiling_loss = $2 where id = $1', [objectId, value]);
  else await db.query(`insert into attributes (organisation_id, object_kind, object_id, property_code, value, source) values ($1, $2, $3, 'soiling_loss', $4::jsonb, $5)`, [org, kind, objectId, JSON.stringify(value), source]);
}

beforeAll(async () => {
  db = await freshDatabase(['solar']);
  org = await organisation(db, 'A cooperative', USER_A);
  home = await participant(db, { organisation_id: org, name: 'Farm', country: 'BE', time_zone: 'Europe/Brussels', geometry: { type: 'Point', coordinates: [4.35, 50.85] } });
  system = await insert(db, 'devices', { organisation_id: org, participant_id: home, name: 'Barn PV', device_type: 'solar', rated_power_kw: 30 });
  await db.query('insert into solar.pv_systems (id, kwp_dc) values ($1, 30)', [system]);
  south = (await db.query<{ id: string }>(`insert into solar.pv_arrays (organisation_id, pv_system_id, azimuth_deg, tilt_deg, name, mounting, kwp_dc) values ($1, $2, 180, 30, 'South', 'roof_parallel', 20) returning id`, [org, system])).rows[0].id;
  east = (await db.query<{ id: string }>(`insert into solar.pv_arrays (organisation_id, pv_system_id, azimuth_deg, tilt_deg, name, mounting, kwp_dc) values ($1, $2, 90, 30, 'East', 'roof_parallel', 10) returning id`, [org, system])).rows[0].id;
});

afterAll(async () => {
  await db.close();
});

describe('solar.soiling_of', () => {
  it('is null while nobody says it, then the nearest value with where it was found', async () => {
    expect((await one<{ s: unknown }>(db, 'select solar.soiling_of($1) s', [south])).s).toBeNull();
    await soiling('participant', home, 0.05, 'dust from the farmyard, survey of 2026-06');
    const fromHome = (await one<{ s: Record<string, unknown> }>(db, 'select solar.soiling_of($1) s', [south])).s;
    expect(fromHome).toMatchObject({ value: 0.05, level: 'participant', object_id: home, reference: 'dust from the farmyard, survey of 2026-06' });
    expect((await one<{ s: Record<string, unknown> }>(db, 'select solar.soiling_of($1) s', [system])).s).toMatchObject({ value: 0.05, level: 'participant' });
  });

  it('refuses a value outside 0 to 1 and an object the property does not apply to', async () => {
    await expect(soiling('pv_array', east, 2, 'a percentage by mistake')).rejects.toThrow();
    const project = await insert(db, 'projects', { organisation_id: org, name: 'Barn study', country: 'BE' });
    await expect(soiling('project', project, 0.02, 'a project')).rejects.toThrow(/property_not_applicable/);
  });
});

describe('a yield estimate with the soiling of the place', () => {
  it('keeps an aggregate loss whole (pvgis_like) and records the soiling it did not apply', async () => {
    const recorded = JSON.parse(await readFile(`${repoRoot}/tests/fixtures/pvgis-seriescalc-brussels-2023-48h.json`, 'utf8'));
    const asked: string[] = [];
    const fetch: Fetch = async (url) => {
      asked.push(url);
      return { ok: true, status: 200, json: async () => recorded };
    };
    const result = await estimateYield(db, { pvSystemId: system, years: { from: 2023, to: 2023 } }, pvgis({ fetch }));
    expect(asked.map((u) => new URL(u).searchParams.get('loss'))).toEqual(['14', '14']);
    const estimate = await one<{ inputs: { arrays: Record<string, unknown>[]; losses: unknown } }>(db, 'select inputs from solar.estimates where id = $1', [result.estimateId]);
    expect(estimate.inputs.losses).toEqual([{ code: 'system', pct: 14 }]);
    expect(estimate.inputs.arrays[0]).toMatchObject({ soiling: { fraction: 0.05, level: 'participant', applied: false, why: expect.stringMatching(/aggregate loss/) }, system_loss_pct: 14 });
  });

  it('sends the place\'s soiling to an engine in place of the profile\'s (pvsyst_like), and records it', async () => {
    const result = await estimateYield(
      db,
      { pvSystemId: system, years: { from: 2023, to: 2023 }, profileCode: 'pvsyst_like', gammaPdc: -0.0035, engine: fake },
      { weather: openMeteo({ fetch: syntheticArchive(4.35, []) }) },
    );
    const estimate = await one<{ inputs: { arrays: Record<string, unknown>[]; losses: { code: string; pct: number | null }[] } }>(db, 'select inputs from solar.estimates where id = $1', [result.estimateId]);
    expect(estimate.inputs.losses.find((l) => l.code === 'soiling')).toEqual({ code: 'soiling', pct: 5 });
    expect(estimate.inputs.losses.map((l) => l.code)).toEqual(['iam', 'soiling', 'lid', 'module_quality', 'mismatch', 'dc_wiring', 'ac_wiring', 'availability']);
    expect(estimate.inputs.arrays.map((a) => a.soiling)).toEqual([
      expect.objectContaining({ fraction: 0.05, level: 'participant', applied: true }),
      expect.objectContaining({ fraction: 0.05, level: 'participant', applied: true }),
    ]);
  });

  it('refuses an engine estimate whose arrays have different soiling: the request carries one list of losses', async () => {
    await soiling('pv_array', south, 0.01, 'cleaned every spring');
    await expect(estimateYield(
      db,
      { pvSystemId: system, years: { from: 2023, to: 2023 }, profileCode: 'pvsyst_like', gammaPdc: -0.0035, engine: fake },
      { weather: openMeteo({ fetch: syntheticArchive(4.35, []) }) },
    )).rejects.toThrow(/losses_differ_between_arrays: (South and East|East and South) have different soiling/);
  });
});
