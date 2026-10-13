// A yield run computed by an external engine (decision 0013), with a fake
// engine in Node so that it runs without Python: the profile chooses the
// weather, the models and the losses, the engine computes, and what it
// answers lands as simulated series on the system and its arrays, with the
// engine's version on the run.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { openMeteo } from '../connectors/open-meteo/index.js';
import { runYield } from '../modules/solar/yield.js';
import { USER_A, freshDatabase, insert, one, organisation, repoRoot, square } from './helpers/db.js';
import { syntheticArchive } from './helpers/weather.js';

const fake = { name: 'fake', command: [process.execPath, `${repoRoot}/tests/fixtures/engines/fake.mjs`, 'pv_yield'] };

let db: PGlite;
let org: string;
let system: string;
let south: string;
let east: string;

beforeAll(async () => {
  db = await freshDatabase(['solar']);
  org = await organisation(db, 'A cooperative', USER_A);
  const site = await insert(db, 'sites', { organisation_id: org, name: 'Hall', country: 'BE', time_zone: 'Europe/Brussels', geometry: { type: 'Point', coordinates: [4.35, 50.85] } });
  const building = await insert(db, 'buildings', { organisation_id: org, site_id: site, name: 'Hall', footprint: square(4.35, 50.85, 30, 20), height_m: 8 });
  const southFace = await insert(db, 'surfaces', { organisation_id: org, building_id: building, name: 'South pitch', kind: 'roof', azimuth_deg: 180, tilt_deg: 30 });
  const eastFace = await insert(db, 'surfaces', { organisation_id: org, building_id: building, name: 'East pitch', kind: 'roof', azimuth_deg: 90, tilt_deg: 30 });
  system = await insert(db, 'devices', { organisation_id: org, site_id: site, building_id: building, name: 'Roof PV', device_type: 'solar', rated_power_kw: 30 });
  await db.query('insert into solar.pv_systems (id, kwp_dc) values ($1, 30)', [system]);
  south = (await db.query<{ id: string }>(`insert into solar.pv_arrays (organisation_id, pv_system_id, surface_id, name, mounting, kwp_dc) values ($1, $2, $3, 'South', 'roof_parallel', 20) returning id`, [org, system, southFace])).rows[0].id;
  east = (await db.query<{ id: string }>(`insert into solar.pv_arrays (organisation_id, pv_system_id, surface_id, name, mounting, kwp_dc) values ($1, $2, $3, 'East', 'roof_parallel', 10) returning id`, [org, system, eastFace])).rows[0].id;
});

afterAll(async () => {
  await db.close();
});

describe('a yield run computed by an engine', () => {
  it('sends the profile\'s choices and the weather read per array, stores the answer as it comes and records the engine', async () => {
    const asked: string[] = [];
    const result = await runYield(
      db,
      { pvSystemId: system, years: { from: 2023, to: 2023 }, profileCode: 'pvwatts', gammaPdc: -0.0035, engine: fake },
      { weather: openMeteo({ fetch: syntheticArchive(4.35, asked) }) },
    );

    // `pvwatts` names no transposition: the plane-of-array irradiance of the source, read per array.
    expect(asked.map((u) => [new URL(u).searchParams.get('hourly'), new URL(u).searchParams.get('azimuth')])).toEqual([
      ['global_tilted_irradiance,temperature_2m,wind_speed_10m', '0'],
      ['global_tilted_irradiance', '-90'],
    ]);
    // The fake engine answers 0.5 kWh for every hour it was sent: the local year 2023, 8,760 hours.
    expect(result.annualKwh).toBe(4380);
    expect(result.kwhPerKwp).toBe(146);

    const stored = await db.query<{ object_id: string; quantity_code: string; kind: string; source_code: string; name: string; n: number }>(
      `select s.object_id, s.quantity_code, s.kind, s.source_code, s.name, count(v.*)::int n
         from series s join series_values v on v.series_id = s.id
        where s.name = 'fake 2023-2023' group by s.id order by s.quantity_code, s.object_id = $1 desc`,
      [south],
    );
    expect(stored.rows).toEqual([
      { object_id: south, quantity_code: 'module_temperature', kind: 'simulated', source_code: 'open_meteo', name: 'fake 2023-2023', n: 8760 },
      { object_id: east, quantity_code: 'module_temperature', kind: 'simulated', source_code: 'open_meteo', name: 'fake 2023-2023', n: 8760 },
      { object_id: south, quantity_code: 'poa_irradiance', kind: 'simulated', source_code: 'open_meteo', name: 'fake 2023-2023', n: 8760 },
      { object_id: east, quantity_code: 'poa_irradiance', kind: 'simulated', source_code: 'open_meteo', name: 'fake 2023-2023', n: 8760 },
      { object_id: system, quantity_code: 'production_energy', kind: 'simulated', source_code: 'open_meteo', name: 'fake 2023-2023', n: 8760 },
    ]);

    const run = await one<{ engine_version: string; inputs: Record<string, any>; results: Record<string, any> }>(db, 'select engine_version, inputs, results from runs where id = $1', [result.runId]);
    expect(run.engine_version).toBe('fake 1.0.0');
    expect(run.inputs).toMatchObject({
      profile: 'pvwatts',
      engine: { name: 'fake', version: 'fake 1.0.0', contract: 1, dependencies: { node: process.versions.node } },
      weather: { source: 'open_meteo', model: 'era5', years: { from: 2023, to: 2023 }, time_zone: 'Europe/Brussels' },
      arrays: [{ name: 'South', kwp: 20, module_model: 'pvwatts' }, { name: 'East', kwp: 10, module_model: 'pvwatts' }],
      losses: [{ code: 'system', pct: 14 }],
    });
    // What the engine was told, as it echoes it: the profile's models.
    expect(run.inputs.model.models).toEqual({ decomposition: null, transposition: null, temperature: 'faiman', temperature_parameters: { u0: 25, u1: 6.84 }, aoi: 'no_loss', spectral: 'no_loss' });
    expect(run.results).toMatchObject({ series_id: result.seriesId, annual_kwh: 4380, years_covered: [2023] });
    expect(Object.keys(run.results.array_series).sort()).toEqual(['East', 'South']);
  });

  it('a profile that names a transposition sends the horizontal components once for the site', async () => {
    const asked: string[] = [];
    // `pvsol_like` decomposes (Hofmann): only ghi is read. Its losses have no values; the fake engine does not check them.
    await runYield(db, { pvSystemId: system, years: { from: 2023, to: 2023 }, profileCode: 'pvsol_like', gammaPdc: -0.0035, engine: fake }, { weather: openMeteo({ fetch: syntheticArchive(4.35, asked) }) });
    expect(asked.map((u) => [new URL(u).searchParams.get('hourly'), new URL(u).searchParams.has('tilt')])).toEqual([['shortwave_radiation,temperature_2m,wind_speed_10m', false]]);
  });

  it('names its refusals: no profile, an engine it cannot start', async () => {
    await expect(runYield(db, { pvSystemId: system, years: { from: 2023, to: 2023 }, engine: fake })).rejects.toThrow(/^profile_required/);
    await expect(
      runYield(db, { pvSystemId: system, years: { from: 2023, to: 2023 }, profileCode: 'pvwatts', gammaPdc: -0.0035, engine: { name: 'pvlib', command: ['/nonexistent/python'] } }, { weather: openMeteo({ fetch: syntheticArchive(4.35, []) }) }),
    ).rejects.toThrow(/^engine_not_found: pvlib could not be started .*pip install -e engines\/pvlib/);
  });
});
