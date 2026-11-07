// What a project is and who a participant is, as vocabularies: the kind of
// a project (generic in the core, a legal frame of a country in its pack)
// and the customer segment every participant has, each refused by name
// outside its vocabulary; and the quantities of a place that produces and
// stores, and of a price, kept in a currency no function names.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, asUser, freshDatabase, insert, one, organisation } from './helpers/db.js';

let db: PGlite;
let org: string;

const at = (from: string, n: number, stepMinutes: number) =>
  Array.from({ length: n }, (_, i) => new Date(Date.parse(from) + i * stepMinutes * 60_000).toISOString());

beforeAll(async () => {
  db = await freshDatabase();
  org = await organisation(db, 'A cooperative', USER_A);
  // Two countries of test packs, with currencies of their own and a frame of projects.
  // A currency of no country, as a pack would add it.
  await db.query(`insert into currencies (code, name) values ('ZZD', 'Testland currency'), ('ZYD', 'Testland currency') on conflict do nothing`);
  await db.query(`insert into countries (code, name, currency, region_level, published_by) values
                    ('ZZ', 'Testland', 'ZZD', 'region', 'pack:zz'), ('ZY', 'Otherland', 'ZYD', 'region', 'pack:zy')`);
  await db.query(`insert into sources (code, name, kind, published_by) values ('zz_energy_act', 'Testland energy act', 'text', 'pack:zz')`);
  await db.query(`insert into project_kinds (code, name, parent_code, country, source_code, reference, published_by) values
                    ('zz_sharing', 'Testland energy sharing', 'collective_self_consumption', 'ZZ', 'zz_energy_act', 'art. 7', 'pack:zz')`);
});

afterAll(async () => {
  await db.close();
});

describe('the kind of a project', () => {
  it('is a row of project_kinds, a frame of a country is used in that country, and a frame refines a generic kind', async () => {
    const project = await insert(db, 'projects', { organisation_id: org, name: 'Street sharing', kind: 'zz_sharing', country: 'ZZ' });
    expect(await one(db, `select is_a('project_kinds', kind, 'self_consumption') a from projects where id = $1`, [project])).toEqual({ a: true });
    await expect(insert(db, 'projects', { organisation_id: org, name: 'Elsewhere', kind: 'zz_sharing', country: 'ZY' }))
      .rejects.toThrow(/project_kind_foreign: zz_sharing is a frame of ZZ, the project is in ZY/);
    await expect(insert(db, 'projects', { organisation_id: org, name: 'Free text', kind: 'solar farm', country: 'ZZ' }))
      .rejects.toThrow(/project_kind_unknown: solar farm/);
    await expect(db.query(`insert into project_kinds (code, name, country, published_by) values ('zz_uncited', 'Uncited', 'ZZ', 'pack:zz')`))
      .rejects.toThrow(/project_kinds_frame_cited/);
    // A project with no particular frame has no kind; the generic kinds nothing reads are gone.
    expect(await one(db, `select kind from projects where id = $1`, [await insert(db, 'projects', { organisation_id: org, name: 'Plain', country: 'ZZ' })]))
      .toEqual({ kind: null });
    expect(await one(db, `select kind from projects where id = $1`, [(await one<{ id: string }>(db, `select create_project($1, 'Plain too', 'ZZ') id`, [org])).id]))
      .toEqual({ kind: null });
    for (const gone of ['study', 'other', 'buildings', 'construction', 'district_plan']) {
      await expect(insert(db, 'projects', { organisation_id: org, name: gone, kind: gone, country: 'ZZ' })).rejects.toThrow(/project_kind_unknown/);
    }
  });
});

describe('the segment of a participant', () => {
  it('every participant has one, a household unless said otherwise, and nothing outside the vocabulary', async () => {
    const project = await insert(db, 'projects', { organisation_id: org, name: 'Members', kind: 'energy_community', country: 'ZZ' });
    const home = await insert(db, 'participants', { organisation_id: org, project_id: project, name: 'Home', country: 'ZZ' });
    expect(await one(db, `select segment, is_a('segments', segment, 'residential') residential from participants where id = $1`, [home]))
      .toEqual({ segment: 'individual', residential: true });
    const school = await insert(db, 'participants', { organisation_id: org, project_id: project, name: 'School', country: 'ZZ', segment: 'public_entity' });
    expect(await one(db, `select is_a('segments', segment, 'professional') p from participants where id = $1`, [school])).toEqual({ p: true });
    await expect(insert(db, 'participants', { organisation_id: org, project_id: project, name: 'Shop', country: 'ZZ', segment: 'shopkeeper' }))
      .rejects.toThrow(/segment_unknown: shopkeeper is not a segments code/);
    await expect(asUser(db, USER_A, () => db.query(`update participants set segment = 'vip' where id = $1`, [home])))
      .rejects.toThrow(/segment_unknown: vip/);
    await expect(db.query(`select is_a('participants', 'a', 'b')`)).rejects.toThrow(/vocabulary_unknown/);
  });
});

describe('the quantities of self-consumption and storage', () => {
  it('are energies in the unit of energy, each positive, the surplus and the residual derived', async () => {
    const rows = (await db.query<{ code: string; unit: string; aggregation: string }>(
      `select code, unit, aggregation from quantities where code in ('self_consumption_energy', 'battery_charge_energy', 'battery_discharge_energy', 'battery_grid_charge_energy') order by code`)).rows;
    expect(rows).toEqual([
      { code: 'battery_charge_energy', unit: 'KiloW-HR', aggregation: 'sum' },
      { code: 'battery_discharge_energy', unit: 'KiloW-HR', aggregation: 'sum' },
      { code: 'battery_grid_charge_energy', unit: 'KiloW-HR', aggregation: 'sum' },
      { code: 'self_consumption_energy', unit: 'KiloW-HR', aggregation: 'sum' },
    ]);
  });
});

describe('the quantities a meter measures at its connection point', () => {
  it('are active power by direction, reactive power and energy by quadrant pair and voltage, in units that convert', async () => {
    const rows = (await db.query<{ code: string; unit: string; aggregation: string }>(
      `select code, unit, aggregation from quantities where code in ('offtake_power', 'injection_power', 'reactive_power_inductive',
         'reactive_power_capacitive', 'reactive_energy_inductive', 'reactive_energy_capacitive', 'voltage') order by code`)).rows;
    expect(rows).toEqual([
      { code: 'injection_power', unit: 'KiloW', aggregation: 'mean' },
      { code: 'offtake_power', unit: 'KiloW', aggregation: 'mean' },
      { code: 'reactive_energy_capacitive', unit: 'KiloV-A_Reactive-HR', aggregation: 'sum' },
      { code: 'reactive_energy_inductive', unit: 'KiloV-A_Reactive-HR', aggregation: 'sum' },
      { code: 'reactive_power_capacitive', unit: 'KiloV-A_Reactive', aggregation: 'mean' },
      { code: 'reactive_power_inductive', unit: 'KiloV-A_Reactive', aggregation: 'mean' },
      { code: 'voltage', unit: 'V', aggregation: 'mean' },
    ]);
    expect(await one(db, `select convert_unit(1500, 'var', 'kvar') kvar, convert_unit(2, 'kvarh', 'varh') varh, convert_unit(0.4, 'kV', 'V') v`))
      .toEqual({ kvar: 1.5, varh: 2000, v: 400 });
    await expect(db.query(`select convert_unit(1, 'var', 'W')`)).rejects.toThrow(/unit_incompatible/);
  });
});

describe('a price', () => {
  it('is a quantity whose units every currency a country declares gets, and two currencies never convert', async () => {
    expect((await db.query(`select code, symbol from units where currency = 'ZZD' and quantity_kind = 'EnergyPrice' order by factor`)).rows).toEqual([
      { code: 'ZZD-PER-MegaW-HR', symbol: 'ZZD/MWh' }, { code: 'ZZD-PER-KiloW-HR', symbol: 'ZZD/kWh' }, { code: 'ZZD-PER-W-HR', symbol: 'ZZD/Wh' },
    ]);
    expect(await one(db, `select convert_unit(0.15, 'ZZD/kWh', 'ZZD-PER-MegaW-HR') v`)).toEqual({ v: 150 });
    expect((await one<{ v: number }>(db, `select convert_unit(10, 'ZZD-PER-MO', 'ZZD-PER-YR') v`)).v).toBeCloseTo(120, 9);
    await expect(db.query(`select convert_unit(1, 'ZZD-PER-MegaW-HR', 'ZYD-PER-MegaW-HR')`)).rejects.toThrow(/unit_incompatible/);
    expect(await one(db, `select quantity_unit('energy_price', 'ZYD') u, quantity_unit('power_price', 'ZYD') p, quantity_unit('fixed_price', 'ZYD') f`))
      .toEqual({ u: 'ZYD-PER-MegaW-HR', p: 'ZYD-PER-KiloW-YR', f: 'ZYD-PER-MO' });
    await expect(db.query(`select quantity_unit('energy_price')`)).rejects.toThrow(/currency_required/);
    expect(await one(db, `select quantity_code q from attribute_types where code = 'energy_price_household'`)).toEqual({ q: 'energy_price' });
  });

  it('of a market is a series of the organisation, kept in the currency of the unit of its first write', async () => {
    const written = await one<{ series_id: string; changed: number }>(db,
      `select * from store(null, $1::timestamptz[], $2::float8[], null, 'ZZD/kWh', null, $3::jsonb)`,
      [at('2026-06-01T00:00:00Z', 2, 60), [0.08, 0.095], JSON.stringify({
        object_kind: 'organisation', object_id: org, quantity_code: 'energy_price', source_code: 'entsoe_transparency',
        name: '10YZZ-TEST-----Z', external_ref: '10YZZ-TEST-----Z', value_kind: 'interval', step: '1 hour' })]);
    expect(written.changed).toBe(2);
    expect(await one(db, `select currency, quantity_unit(quantity_code, currency) unit from series where id = $1`, [written.series_id]))
      .toEqual({ currency: 'ZZD', unit: 'ZZD-PER-MegaW-HR' });
    expect((await db.query(`select value from series_values where series_id = $1 order by at`, [written.series_id])).rows)
      .toEqual([{ value: 80 }, { value: 95 }]);
    await expect(db.query(`select store($1, array['2026-06-01T02:00:00Z']::timestamptz[], array[1]::float8[], null, 'ZYD/MWh')`, [written.series_id]))
      .rejects.toThrow(/series_unit_mismatch/);
    await expect(db.query(`update series set currency = 'ZYD' where id = $1`, [written.series_id])).rejects.toThrow(/currency_edited/);
    await expect(db.query(`select store(null, array['2026-06-01T00:00:00Z']::timestamptz[], array[1]::float8[], null, null, null, $1::jsonb)`,
      [JSON.stringify({ object_kind: 'organisation', object_id: org, quantity_code: 'energy_price', name: 'unnamed zone' })]))
      .rejects.toThrow(/currency_required/);
  });

  it('of a participant is kept in the currency of its country, and no other quantity has one', async () => {
    const project = await insert(db, 'projects', { organisation_id: org, name: 'Tariffs', country: 'ZY' });
    const member = await insert(db, 'participants', { organisation_id: org, project_id: project, name: 'Member', country: 'ZY' });
    const price = await one<{ id: string }>(db, `select series_ensure('participant', $1, 'fixed_price') id`, [member]);
    expect(await one(db, `select currency from series where id = $1`, [price.id])).toEqual({ currency: 'ZYD' });
    await expect(insert(db, 'series', { organisation_id: org, object_kind: 'participant', object_id: member, quantity_code: 'offtake_energy', currency: 'ZYD' }))
      .rejects.toThrow(/currency_not_priced/);
  });
});
