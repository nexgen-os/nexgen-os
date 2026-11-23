// The figures of a PV system and a battery say their unit on their column,
// an array's tilt goes from flat to vertical, and solar.power_warnings()
// names what does not add up in the power of a system: its arrays against
// their modules, its participant's systems against the roof.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase, insert, one, organisation, participant } from '../../../tests/helpers/db.js';

let db: PGlite;
let org: string;
let home: string;
let pv: string;
let panel: string;

const warnings = async (device: string) =>
  (await db.query<{ code: string; message: string; figures: Record<string, unknown> }>('select code, message, figures from solar.power_warnings($1)', [device])).rows;
const comment = async (table: string, column: string) =>
  (await one<{ c: string | null }>(db, `select col_description($1::regclass, (select attnum from pg_attribute where attrelid = $1::regclass and attname = $2)) c`, [table, column])).c;

beforeAll(async () => {
  db = await freshDatabase(['solar', 'battery', 'building']);
  org = await organisation(db, 'An installer');
  const project = await insert(db, 'projects', { organisation_id: org, name: 'Roofs', country: 'NL' });
  home = await participant(db, { organisation_id: org, project_id: project, name: 'House', country: 'NL', city: 'Utrecht' });
  pv = (await one<{ id: string }>(db, `select install_device($1, 'solar', 'Roof PV') id`, [home])).id;
  await db.query(`insert into solar.devices (id, grid_connection) values ($1, 'self_consumption')`, [pv]);
  panel = await insert(db, 'products', { organisation_id: org, device_type: 'solar', manufacturer: 'Example Solar', model: 'ES-400', unit_power_kw: 0.4 });
});

afterAll(async () => {
  await db.close();
});

describe('the unit of each figure', () => {
  it('is said on the column: a name ending in _pct a percent, a share without it a ratio from 0 to 1', async () => {
    expect(await comment('solar.devices', 'degradation_pct_per_year')).toMatch(/percent a year, 0 to 5/);
    expect(await comment('solar.devices', 'first_year_loss_pct')).toMatch(/in percent/);
    expect(await comment('solar.pv_arrays', 'soiling_loss')).toMatch(/ratio from 0 to 1/);
    expect(await comment('solar.pv_arrays', 'albedo')).toMatch(/ratio from 0 to 1/);
    expect(await comment('solar.pv_arrays', 'tilt_deg')).toMatch(/0 \(flat\) to 90 \(vertical\)/);
    expect(await comment('battery.devices', 'round_trip_efficiency')).toMatch(/ratio from 0 to 1/);
    expect(await comment('battery.products', 'end_of_life_capacity')).toMatch(/ratio from 0 to 1/);
    expect(await comment('battery.devices', 'min_charge_level')).toMatch(/in percent of its usable capacity, 0 to 100/);
    expect(await comment('battery.devices', 'max_charge_level')).toMatch(/in percent of its usable capacity, 0 to 100/);
  });
});

describe('the tilt of an array', () => {
  it('goes from flat to vertical, a façade included, and no further', async () => {
    await insert(db, 'solar.pv_arrays', { organisation_id: org, device_id: pv, name: 'Façade', azimuth_deg: 180, tilt_deg: 90, kwp_dc: 1 });
    await expect(insert(db, 'solar.pv_arrays', { organisation_id: org, device_id: pv, name: 'Upside down', azimuth_deg: 180, tilt_deg: 120, kwp_dc: 1 }))
      .rejects.toThrow(/pv_arrays_tilt_range/);
    await db.query(`delete from solar.pv_arrays where device_id = $1`, [pv]);
  });
});

describe('solar.power_warnings()', () => {
  it('names an array whose power is not its modules times their unit power', async () => {
    // 20 modules of 0.4 kW make 8 kWp; the array says 10.
    const south = await insert(db, 'solar.pv_arrays', {
      organisation_id: org, device_id: pv, name: 'South', azimuth_deg: 180, tilt_deg: 35, module_product_id: panel, module_count: 20, kwp_dc: 10,
    });
    expect(await warnings(pv)).toEqual([expect.objectContaining({
      code: 'kwp_not_modules', figures: { array_id: south, kwp_dc: 10, module_count: 20, unit_power_kw: 0.4, modules_kwp: 8 },
    })]);
    // Within 1 %, a rounding of the datasheet: nothing to say.
    await db.query('update solar.pv_arrays set kwp_dc = 8.05 where id = $1', [south]);
    expect(await warnings(pv)).toEqual([]);
    // Not given, it is computed from the modules.
    await db.query('update solar.pv_arrays set kwp_dc = null where id = $1', [south]);
    expect(Number((await one<{ k: string }>(db, 'select kwp_dc k from solar.pv_arrays where id = $1', [south])).k)).toBe(8);
  });

  it('names a participant whose PV systems carry more than its roof, once the power of a square metre is said', async () => {
    const building = await insert(db, 'building.buildings', { organisation_id: org, participant_id: home, name: 'House' });
    await insert(db, 'building.surfaces', { organisation_id: org, building_id: building, name: 'South roof', kind: 'roof', area_m2: 30 });
    // Nobody says what a square metre carries: nothing to read the roof against.
    expect(await warnings(pv)).toEqual([]);
    await db.query(`select set_attribute('organisation', $1, 'pv_power_per_area', '0.2'::jsonb, null, null, 'installer datasheets')`, [org]);
    // 30 m² at 0.2 kWp/m² carry 6 kWp; the system has 8.
    expect(await warnings(pv)).toEqual([expect.objectContaining({
      code: 'kwp_over_roof', figures: expect.objectContaining({ participant_id: home, installed_kwp: 8, roof_m2: 30, roof_kwp: 6 }),
    })]);
    await insert(db, 'building.surfaces', { organisation_id: org, building_id: building, name: 'North roof', kind: 'roof', area_m2: 15 });
    expect(await warnings(pv)).toEqual([]);
  });
});
