// The `solar` module: a house with a PV system on two roof faces, the
// physics of its module and inverter products, a far horizon on the site,
// the four yield profiles, and who sees what.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_B, asUser, freshDatabase, insert, one, organisation, square, participant } from './helpers/db.js';

let db: PGlite;
let org: string;
let site: string;
let house: string;
let south: string;
let west: string;
let pv: string;
let moduleProduct: string;
let inverterProduct: string;

beforeAll(async () => {
  db = await freshDatabase(['building', 'solar']);
  org = await organisation(db, 'A family');
  site = await participant(db, { organisation_id: org, name: 'Garden plot', country: 'ES', city: 'Sevilla' });
  house = await insert(db, 'building.buildings', {
    organisation_id: org, participant_id: site, name: 'House', footprint: square(-5.98, 37.39, 10, 8), height_m: 7.5,
  });
  south = await insert(db, 'building.surfaces', {
    organisation_id: org, building_id: house, name: 'South roof face', kind: 'roof', azimuth_deg: 180, tilt_deg: 30,
  });
  west = await insert(db, 'building.surfaces', {
    organisation_id: org, building_id: house, name: 'West roof face', kind: 'roof', azimuth_deg: 270, tilt_deg: 25,
  });
  pv = await insert(db, 'devices', {
    organisation_id: org, participant_id: site, name: 'PV system', device_type: 'solar', rated_power_kw: 5,
  });
  await db.query('select building.place_device($1, $2)', [pv, house]);
  moduleProduct = await insert(db, 'device_directory', {
    device_type: 'solar', manufacturer: 'Acme', model_ref: 'Sun 425', unit_power_kw: 0.425, published_by: 'solar',
  });
  inverterProduct = await insert(db, 'device_directory', {
    device_type: 'inverter', manufacturer: 'Acme', model_ref: 'Wave 5', unit_power_kw: 5, published_by: 'solar',
  });
});

afterAll(async () => {
  await db.close();
});

describe('the solar module', () => {
  it('registers itself and its quantities', async () => {
    const m = await one<{ schema_name: string }>(db, `select schema_name from modules where code = 'solar'`);
    expect(m.schema_name).toBe('solar');
    const q = await db.query<{ code: string; unit: string }>(
      `select code, unit from quantities where published_by = 'solar' order by code`,
    );
    expect(q.rows).toEqual([
      { code: 'dhi', unit: 'W-PER-M2' }, { code: 'dni', unit: 'W-PER-M2' }, { code: 'ghi', unit: 'W-PER-M2' },
      { code: 'module_temperature', unit: 'DEG_C' }, { code: 'poa_irradiance', unit: 'W-PER-M2' },
      { code: 'wind_speed', unit: 'M-PER-SEC' },
    ]);
  });

  it('derives a PV system from a device of type solar, and refuses any other type', async () => {
    await db.query(
      `insert into solar.pv_systems (id, kwp_dc, kva_ac, grid_connection, commissioned_on, degradation_pct_per_year)
       values ($1, 5, 4.6, 'self_consumption', '2026-04-01', 0.4)`,
      [pv],
    );
    const r = await one<{ name: string; organisation_id: string; grid_connection: string }>(
      db,
      `select d.name, p.organisation_id, p.grid_connection from devices d join solar.pv_systems p using (id) where d.id = $1`,
      [pv],
    );
    expect(r).toEqual({ name: 'PV system', organisation_id: org, grid_connection: 'self_consumption' });
    const battery = await insert(db, 'devices', { organisation_id: org, participant_id: site, name: 'Battery', device_type: 'battery' });
    await expect(db.query('insert into solar.pv_systems (id) values ($1)', [battery])).rejects.toThrow(/device_type_mismatch/);
    await expect(
      db.query(`update solar.pv_systems set grid_connection = 'sometimes' where id = $1`, [pv]),
    ).rejects.toThrow(/pv_systems_grid_connection/);
  });

  it('gives the system its own DC power while it has no array', async () => {
    const r = await one<{ kwp: string }>(db, 'select solar.system_kwp($1) kwp', [pv]);
    expect(Number(r.kwp)).toBe(5);
  });

  it('places two arrays on two roof faces of the building module, with the orientation of each face', async () => {
    const southArray = await insert(db, 'solar.pv_arrays', {
      organisation_id: org, pv_system_id: pv, name: 'South', mounting: 'roof_parallel',
      module_product_id: moduleProduct, module_count: 8, modules_per_string: 8, strings: 1,
      inverter_product_id: inverterProduct, inverter_count: 1,
    });
    const westArray = await insert(db, 'solar.pv_arrays', {
      organisation_id: org, pv_system_id: pv, name: 'West', mounting: 'roof_parallel',
      module_product_id: moduleProduct, module_count: 4, kwp_dc: 1.7,
    });
    await db.query('select building.place_array($1, $2)', [southArray, south]);
    await db.query('select building.place_array($1, $2)', [westArray, west]);
    const r = await db.query<{ name: string; azimuth_deg: string; tilt_deg: string; kwp_dc: string }>(
      `select name, azimuth_deg, tilt_deg, kwp_dc from solar.pv_arrays where pv_system_id = $1 order by name`,
      [pv],
    );
    expect(r.rows).toEqual([
      { name: 'South', azimuth_deg: '180.00', tilt_deg: '30.00', kwp_dc: '3.400' },
      { name: 'West', azimuth_deg: '270.00', tilt_deg: '25.00', kwp_dc: '1.700' },
    ]);
    const kind = await one<{ table_name: string; site: string }>(db, `select table_name, site_of('pv_array', $1) site from kinds where kind = 'pv_array'`, [southArray]);
    expect(kind).toEqual({ table_name: 'solar.pv_arrays', site });
  });

  it('keeps an orientation given for a rack, over the surface it stands on', async () => {
    const flat = await insert(db, 'building.surfaces', {
      organisation_id: org, building_id: house, name: 'Flat roof', kind: 'roof', azimuth_deg: 0, tilt_deg: 0,
    });
    const rack = await insert(db, 'solar.pv_arrays', {
      organisation_id: org, pv_system_id: pv, name: 'Rack', mounting: 'open_rack',
      azimuth_deg: 180, tilt_deg: 15, scenario_id: null,
    });
    await db.query('select building.place_array($1, $2)', [rack, flat]);
    const r = await one<{ azimuth_deg: string; tilt_deg: string }>(
      db, 'select azimuth_deg, tilt_deg from solar.pv_arrays where id = $1', [rack],
    );
    expect(r).toEqual({ azimuth_deg: '180.00', tilt_deg: '15.00' });
    await db.query('delete from solar.pv_arrays where id = $1', [rack]);
  });

  it('sums the arrays into the DC power of the system', async () => {
    const r = await one<{ kwp: string }>(db, 'select solar.system_kwp($1) kwp', [pv]);
    expect(Number(r.kwp)).toBeCloseTo(5.1, 3);
  });

  it('throws a named error (`array_outside_system_site`) for an array on a surface of another site', async () => {
    const other = await participant(db, { organisation_id: org, name: 'Barn', country: 'ES' });
    const ground = await insert(db, 'building.surfaces', {
      organisation_id: org, participant_id: other, name: 'Field', kind: 'ground', azimuth_deg: 180, tilt_deg: 0,
    });
    const stray = await insert(db, 'solar.pv_arrays', { organisation_id: org, pv_system_id: pv, name: 'Stray', azimuth_deg: 180, tilt_deg: 10 });
    await expect(db.query('select building.place_array($1, $2)', [stray, ground])).rejects.toThrow(/array_outside_system_site/);
    await db.query('delete from solar.pv_arrays where id = $1', [stray]);
  });

  it('refuses a string layout that does not add up', async () => {
    await expect(
      insert(db, 'solar.pv_arrays', {
        organisation_id: org, pv_system_id: pv, name: 'Odd', module_count: 9, modules_per_string: 4, strings: 2,
      }),
    ).rejects.toThrow(/pv_arrays_strings_add_up/);
  });
});

describe('product physics', () => {
  it('attaches pvwatts parameters to a module and an inverter of the directory', async () => {
    await db.query(
      `insert into solar.module_products (id, model, parameters, source_code) values ($1, 'pvwatts', '{"pdc0": 425, "gamma_pdc": -0.0034}', 'pvgis')`,
      [moduleProduct],
    );
    await db.query(
      `insert into solar.inverter_products (id, model, parameters) values ($1, 'pvwatts', '{"pdc0": 5200, "eta_inv_nom": 0.96}')`,
      [inverterProduct],
    );
    const r = await one<{ pdc0: number; eta: number }>(
      db,
      `select m.parameters -> 'pdc0' pdc0, i.parameters -> 'eta_inv_nom' eta
         from solar.module_products m, solar.inverter_products i where m.id = $1 and i.id = $2`,
      [moduleProduct, inverterProduct],
    );
    expect(r).toEqual({ pdc0: 425, eta: 0.96 });
  });

  it('refuses pvwatts parameters without pdc0, parameters that are not an object, and the wrong kind of product', async () => {
    const other = await insert(db, 'device_directory', {
      device_type: 'solar', manufacturer: 'Acme', model_ref: 'Sun 430', unit_power_kw: 0.43, published_by: 'solar',
    });
    const otherInverter = await insert(db, 'device_directory', {
      device_type: 'inverter', manufacturer: 'Acme', model_ref: 'Wave 6', unit_power_kw: 6, published_by: 'solar',
    });
    await expect(
      db.query(`insert into solar.module_products (id, model, parameters) values ($1, 'pvwatts', '{"gamma_pdc": -0.0034}')`, [other]),
    ).rejects.toThrow(/module_products_pvwatts_keys/);
    await expect(
      db.query(`insert into solar.module_products (id, model, parameters) values ($1, 'cec', '[1, 2]')`, [other]),
    ).rejects.toThrow(/module_products_parameters_object/);
    await expect(
      db.query(`insert into solar.inverter_products (id, model, parameters) values ($1, 'pvwatts', '{"eta_inv_nom": 0.96}')`, [otherInverter]),
    ).rejects.toThrow(/inverter_products_pvwatts_keys/);
    await expect(
      db.query(`insert into solar.inverter_products (id, model, parameters) values ($1, 'pvwatts', '{"pdc0": 430, "eta_inv_nom": 0.96}')`, [other]),
    ).rejects.toThrow(/product_type_mismatch/);
  });
});

describe('horizons', () => {
  it('keeps a far horizon on the site, azimuth from north', async () => {
    await db.query(
      `insert into solar.horizons (object_kind, object_id, profile, source_code) values ('participant', $1, '[[0, 2], [90, 5.5], [180, 1], [270, 8]]', 'pvgis')`,
      [site],
    );
    const r = await one<{ organisation_id: string; n: number }>(
      db, 'select organisation_id, jsonb_array_length(profile) n from solar.horizons where object_id = $1', [site],
    );
    expect(r).toEqual({ organisation_id: org, n: 4 });
  });

  it('refuses an empty profile, a malformed pair and a horizon on a device', async () => {
    await expect(
      db.query(`insert into solar.horizons (object_kind, object_id, profile) values ('surface', $1, '[]')`, [south]),
    ).rejects.toThrow(/horizons_profile_not_empty/);
    await expect(
      db.query(`insert into solar.horizons (object_kind, object_id, profile) values ('surface', $1, '[[400, 2]]')`, [south]),
    ).rejects.toThrow(/horizons_profile_pairs/);
    await expect(
      db.query(`insert into solar.horizons (object_kind, object_id, profile) values ('device', $1, '[[0, 2]]')`, [pv]),
    ).rejects.toThrow(/horizon_on_site_or_surface_only/);
  });
});

describe('yield profiles', () => {
  it('ships the four profiles, each with an ordered list of losses', async () => {
    const r = await db.query<{ code: string; kind: string; transposition_model: string | null; first: string }>(
      `select code, jsonb_typeof(losses) kind, transposition_model, losses -> 0 ->> 'code' first
         from solar.yield_profiles where published_by = 'solar' order by code`,
    );
    expect(r.rows).toEqual([
      { code: 'pvgis_like', kind: 'array', transposition_model: 'muneer', first: 'system' },
      { code: 'pvsol_like', kind: 'array', transposition_model: 'haydavies', first: 'soiling' },
      { code: 'pvsyst_like', kind: 'array', transposition_model: null, first: 'iam' },
      { code: 'pvwatts', kind: 'array', transposition_model: null, first: 'system' },
    ]);
    // The pvwatts row says what its engine runs: no model of its own for transposition, incidence or spectrum, no clipping.
    const pvwatts = await one<{ transposition_model: string | null; iam_model: string | null; spectral_model: string | null; clipping: boolean; description: string }>(
      db,
      `select transposition_model, iam_model, spectral_model, clipping, description from solar.yield_profiles where code = 'pvwatts'`,
    );
    expect(pvwatts).toMatchObject({ transposition_model: null, iam_model: null, spectral_model: null, clipping: false });
    expect(pvwatts.description).toContain('not modelled: inverter efficiency, clipping, incidence angle, spectrum, horizon in the hourly shape');
    const pvsyst = await one<{ codes: string[]; quality: number }>(
      db,
      `select array(select l ->> 'code' from jsonb_array_elements(losses) with ordinality e(l, i) order by i) codes,
              (select (l ->> 'pct')::numeric from jsonb_array_elements(losses) l where l ->> 'code' = 'module_quality') quality
         from solar.yield_profiles where code = 'pvsyst_like'`,
    );
    expect(pvsyst.codes).toEqual(['iam', 'soiling', 'lid', 'module_quality', 'mismatch', 'dc_wiring', 'ac_wiring', 'availability']);
    expect(Number(pvsyst.quality)).toBe(-0.75);
  });

  it('refuses losses given as one object instead of a list', async () => {
    await expect(
      db.query(`insert into solar.yield_profiles (code, name, losses, published_by) values ('flat', 'Flat', '{"system": 14}', 'test')`),
    ).rejects.toThrow(/yield_profiles_losses_ordered_list/);
  });
});

describe('row level security', () => {
  it("shows another organisation's member no array, and every member the shared product physics", async () => {
    await organisation(db, 'Neighbours', USER_B);
    const r = await asUser(db, USER_B, () =>
      one<{ arrays: number; systems: number; modules: number; inverters: number; profiles: number }>(
        db,
        `select (select count(*)::int from solar.pv_arrays) arrays,
                (select count(*)::int from solar.pv_systems) systems,
                (select count(*)::int from solar.module_products) modules,
                (select count(*)::int from solar.inverter_products) inverters,
                (select count(*)::int from solar.yield_profiles) profiles`,
      ),
    );
    expect(r).toEqual({ arrays: 0, systems: 0, modules: 1, inverters: 1, profiles: 4 });
  });

  it("keeps an organisation's own product physics to its members", async () => {
    const own = await insert(db, 'device_directory', {
      organisation_id: org, device_type: 'solar', manufacturer: 'Local', model_ref: 'Custom 400', unit_power_kw: 0.4,
    });
    await db.query(
      `insert into solar.module_products (id, model, parameters) values ($1, 'pvwatts', '{"pdc0": 400, "gamma_pdc": -0.0035}')`,
      [own],
    );
    const seen = await asUser(db, USER_B, () => db.query('select id from solar.module_products where id = $1', [own]));
    expect(seen.rows).toHaveLength(0);
    // Shared physics is written by migrations, modules and packs, not by a member.
    const shared = await insert(db, 'device_directory', {
      device_type: 'solar', manufacturer: 'Acme', model_ref: 'Sun 440', unit_power_kw: 0.44, published_by: 'solar',
    });
    await expect(
      asUser(db, USER_B, () =>
        db.query(`insert into solar.module_products (id, model, parameters) values ($1, 'pvwatts', '{"pdc0": 440, "gamma_pdc": -0.003}')`, [shared]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
