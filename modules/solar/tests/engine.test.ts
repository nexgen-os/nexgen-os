// A yield estimate computed by an external engine (decision 0013), with a fake
// engine in Node so that it runs without Python: the profile chooses the
// weather, the models and the losses, the engine computes, and what it
// answers lands as simulated series on the system and its arrays, with the
// engine's version on the estimate.
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { openMeteo } from '@nexgen-os/open-meteo';
import { sandiaFromOnd } from '../src/inverter.js';
import { estimateYield } from '../src/yield.js';
import { USER_A, freshDatabase, insert, one, organisation, repoRoot, participant } from '../../../tests/helpers/db.js';
import { syntheticArchive } from '../../../tests/helpers/weather.js';

const fake = { name: 'fake', command: [process.execPath, `${repoRoot}/tests/fixtures/connectors/fake.mjs`, 'pv_yield'] };

let db: PGlite;
let org: string;
let system: string;

beforeAll(async () => {
  db = await freshDatabase(['solar']);
  org = await organisation(db, 'A cooperative', USER_A);
  const home = await participant(db, { organisation_id: org, name: 'Hall', country: 'BE', time_zone: 'Europe/Brussels', geometry: { type: 'Point', coordinates: [4.35, 50.85] } });
  system = await insert(db, 'devices', { organisation_id: org, participant_id: home, name: 'Roof PV', device_type: 'solar', rated_power_kw: 30 });
  await db.query('insert into solar.devices (id, kwp_dc) values ($1, 30)', [system]);
  await db.query(`insert into solar.pv_arrays (organisation_id, device_id, azimuth_deg, tilt_deg, name, mounting, kwp_dc) values ($1, $2, 180, 30, 'South', 'roof_parallel', 20)`, [org, system]);
  await db.query(`insert into solar.pv_arrays (organisation_id, device_id, azimuth_deg, tilt_deg, name, mounting, kwp_dc) values ($1, $2, 90, 30, 'East', 'roof_parallel', 10)`, [org, system]);
});

afterAll(async () => {
  await db.close();
});

describe('a yield estimate computed by an engine', () => {
  it('sends the profile\'s choices and the weather read per array, stores the answer as it comes and records the engine', async () => {
    const asked: string[] = [];
    const result = await estimateYield(
      db,
      { deviceId: system, years: { from: 2023, to: 2023 }, profileCode: 'pvwatts', gammaPdc: -0.0035, engine: fake },
      { weather: openMeteo({ fetch: syntheticArchive(4.35, asked) }) },
    );

    // `pvwatts` names no transposition: the plane-of-array irradiance of the source, read per array.
    expect(asked.map((u) => [new URL(u).searchParams.get('hourly'), new URL(u).searchParams.get('azimuth')])).toEqual([
      ['global_tilted_irradiance,temperature_2m,wind_speed_10m', '-90'],
      ['global_tilted_irradiance', '0'],
    ]);
    // The fake engine answers 0.5 kWh for every hour it was sent: the local year 2023, 8,760 hours.
    expect(result.annualKwh).toBe(4380);
    expect(result.kwhPerKwp).toBe(146);

    // The series of an array hang on its system, told apart by the array's name.
    const stored = await db.query<{ object_id: string; quantity_code: string; kind: string; source_code: string; name: string; n: number }>(
      `select s.object_id, s.quantity_code, s.kind, s.source_code, s.name, count(v.*)::int n
         from series s join series_values v on v.series_id = s.id
        where s.name like 'fake 2023-2023%' group by s.id order by s.quantity_code, s.name`,
    );
    expect(stored.rows).toEqual([
      { object_id: system, quantity_code: 'module_temperature', kind: 'simulated', source_code: 'open_meteo', name: 'fake 2023-2023 East', n: 8760 },
      { object_id: system, quantity_code: 'module_temperature', kind: 'simulated', source_code: 'open_meteo', name: 'fake 2023-2023 South', n: 8760 },
      { object_id: system, quantity_code: 'poa_irradiance', kind: 'simulated', source_code: 'open_meteo', name: 'fake 2023-2023 East', n: 8760 },
      { object_id: system, quantity_code: 'poa_irradiance', kind: 'simulated', source_code: 'open_meteo', name: 'fake 2023-2023 South', n: 8760 },
      { object_id: system, quantity_code: 'production_energy', kind: 'simulated', source_code: 'open_meteo', name: 'fake 2023-2023', n: 8760 },
    ]);

    const estimate = await one<{ provenance: string; inputs: Record<string, any>; results: Record<string, any> }>(db, 'select provenance, inputs, results from solar.estimates where id = $1', [result.estimateId]);
    expect(estimate.provenance).toBe('fake 1.0.0');
    expect(estimate.inputs).toMatchObject({
      profile: 'pvwatts',
      engine: { name: 'fake', version: 'fake 1.0.0', contract: 1, dependencies: { node: process.versions.node } },
      weather: { source: 'open_meteo', model: 'era5', years: { from: 2023, to: 2023 }, time_zone: 'Europe/Brussels' },
      arrays: [{ name: 'East', kwp: 10, module_model: 'pvwatts' }, { name: 'South', kwp: 20, module_model: 'pvwatts' }],
      losses: [{ code: 'system', pct: 14 }],
    });
    // What the engine was told, as it echoes it: the profile's models.
    expect(estimate.inputs.model.models).toEqual({ decomposition: null, transposition: null, temperature: 'faiman', temperature_parameters: { u0: 25, u1: 6.84 }, aoi: 'no_loss', spectral: 'no_loss' });
    expect(estimate.results).toMatchObject({ series_id: result.seriesId, annual_kwh: 4380, years_covered: [2023] });
    expect(Object.keys(estimate.results.array_series).sort()).toEqual(['East', 'South']);
  });

  it('a profile that names a transposition sends the horizontal components once for the participant', async () => {
    const asked: string[] = [];
    // `pvsol_like` decomposes (Hofmann): only ghi is read. Its losses have no values; the fake engine does not check them.
    await estimateYield(db, { deviceId: system, years: { from: 2023, to: 2023 }, profileCode: 'pvsol_like', gammaPdc: -0.0035, engine: fake }, { weather: openMeteo({ fetch: syntheticArchive(4.35, asked) }) });
    expect(asked.map((u) => [new URL(u).searchParams.get('hourly'), new URL(u).searchParams.has('tilt')])).toEqual([['shortwave_radiation,temperature_2m,wind_speed_10m', false]]);
  });

  it('sends an inverter known by its OND file as the Sandia model fitted on its curves, and records it with the estimate', async () => {
    const ond = JSON.parse(await readFile(`${repoRoot}/tests/fixtures/ond-inverter-10kw.json`, 'utf8'));
    const inverter = await insert(db, 'products', { organisation_id: org, device_type: 'inverter', manufacturer: 'Example Power', model: 'EP-10K', unit_power_kw: 10 });
    await db.query(`insert into solar.inverter_products (id, model, parameters) values ($1, 'ond', $2)`, [inverter, JSON.stringify(ond)]);
    const module = await insert(db, 'products', { organisation_id: org, device_type: 'solar', manufacturer: 'Example Solar', model: 'ES-M108-430', unit_power_kw: 0.43 });
    await db.query(`insert into solar.module_products (id, model, parameters) values ($1, 'pvsyst', $2)`, [module, JSON.stringify({ gamma_ref: 1, mu_gamma: -0.0002, I_L_ref: 13.90531675, I_o_ref: 9.1907963e-12, R_sh_ref: 400, R_sh_0: 1600, R_sh_exp: 5.5, R_s: 0.153, alpha_sc: 0.00695, cells_in_series: 54, EgRef: 1.121 })]);
    const compute = (over: { deviceId: string }) => estimateYield(db, { ...over, years: { from: 2023, to: 2023 }, profileCode: 'pvwatts', gammaPdc: -0.0035, engine: fake }, { weather: openMeteo({ fetch: syntheticArchive(4.35, []) }) });
    await db.query('update solar.pv_arrays set inverter_product_id = $1 where device_id = $2', [inverter, system]);
    try {
      // Sandia reads the DC voltage: the PVWatts module model of the arrays gives none.
      await expect(compute({ deviceId: system })).rejects.toThrow(/^inverter_needs_voltage: the ond inverter reads the DC voltage/);

      await db.query('update solar.pv_arrays set module_product_id = $1, modules_per_string = 23, strings = 1 where device_id = $2', [module, system]);
      const result = await compute({ deviceId: system });
      const recorded = await one<{ inputs: Record<string, any> }>(db, 'select inputs from solar.estimates where id = $1', [result.estimateId]);
      expect(recorded.inputs.inverter).toEqual({ model: 'sandia', fitted_from: 'ond', parameters: sandiaFromOnd(ond) });
      expect(recorded.inputs.arrays.map((a: { module_model: string }) => a.module_model)).toEqual(['pvsyst', 'pvsyst']);
    } finally {
      await db.query('update solar.pv_arrays set inverter_product_id = null, module_product_id = null, modules_per_string = null, strings = null where device_id = $1', [system]);
    }
  });

  it('names its refusals: no profile, an engine it cannot start', async () => {
    await expect(estimateYield(db, { deviceId: system, years: { from: 2023, to: 2023 }, engine: fake })).rejects.toThrow(/^profile_required/);
    await expect(
      estimateYield(db, { deviceId: system, years: { from: 2023, to: 2023 }, profileCode: 'pvwatts', gammaPdc: -0.0035, engine: { name: 'pvlib', command: ['/nonexistent/python'] } }, { weather: openMeteo({ fetch: syntheticArchive(4.35, []) }) }),
    ).rejects.toThrow(/^engine_not_found: pvlib could not be started .*pip install -e packages\/connectors\/pvlib/);
  });
});
