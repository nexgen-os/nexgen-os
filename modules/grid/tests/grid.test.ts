// The `grid` module: which operator runs a connection point, resolved from
// the most precise level up (decision 0009) — the operator named on the
// point, the prefix of its identifier, the municipality of its
// participant's place, the one distribution operator of its region.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase, insert, one, organisation } from '../../../tests/helpers/db.js';

let db: PGlite;
let org: string;
let project: string;

const meterOf = async (name: string, identifier: string, place: Record<string, unknown>, municipality?: string) => {
  const p = (await one<{ id: string }>(db, `select join_project($1, $2, $3) id`, [project, name, JSON.stringify(place)])).id;
  if (municipality) await db.query(`update participants set municipality = $2 where id = $1`, [p, municipality]);
  return (await one<{ id: string }>(db, `select declare_meter($1, $2, 'gs1_gsrn') id`, [p, identifier])).id;
};
const operatorOf = async (meter: string) => (await one<{ o: Record<string, string> }>(db, 'select grid.operator_of($1) o', [meter])).o;

beforeAll(async () => {
  db = await freshDatabase(['grid']);
  org = await organisation(db, 'A cooperative');
  // A test pack: two regions, one municipality of the West, four operators.
  await db.query(`insert into identifier_schemes (code, name, pattern, published_by) values ('zz_municipality', 'Testland municipality code', '^[0-9]{4}$', 'pack:zz')`);
  // A currency of no country, as a pack would add it.
  await db.query(`insert into currencies (code, name) values ('ZZD', 'Testland currency') on conflict do nothing`);
  await db.query(`insert into countries (code, name, currency, region_level, municipality_scheme, published_by) values ('ZZ', 'Testland', 'ZZD', 'region', 'zz_municipality', 'pack:zz')`);
  await db.query(`insert into regions (code, country, name, published_by) values ('ZZ-EA', 'ZZ', 'East', 'pack:zz'), ('ZZ-WE', 'ZZ', 'West', 'pack:zz')`);
  await db.query(`insert into regions (code, country, name, kind, parent, published_by) values ('ZZ-0042', 'ZZ', 'Millbrook', 'municipality', 'ZZ-WE', 'pack:zz')`);
  await db.query(`insert into grid.operators (code, name, kind, country, regions, municipalities, identifier_prefixes, identifier_scheme, published_by) values
                    ('zz_tso', 'Transmission', 'tso', 'ZZ', '{}', '{}', '{}', null, 'pack:zz'),
                    ('east_grid', 'East Grid', 'dso', 'ZZ', '{ZZ-EA}', '{}', '{54140, 541401}', 'gs1_gsrn', 'pack:zz'),
                    ('east_city', 'East City Grid', 'dso', 'ZZ', '{ZZ-EA}', '{}', '{5414012}', 'gs1_gsrn', 'pack:zz'),
                    ('west_grid', 'West Grid', 'dso', 'ZZ', '{ZZ-WE}', '{}', '{}', null, 'pack:zz'),
                    ('millbrook_power', 'Millbrook Power', 'dso', 'ZZ', '{}', '{ZZ-0042}', '{}', null, 'pack:zz')`);
  project = await insert(db, 'projects', { organisation_id: org, name: 'Testland community', kind: 'energy_community', country: 'ZZ' });
});

afterAll(async () => {
  await db.close();
});

describe('grid.operator_of', () => {
  it('finds the operator by the longest prefix of the identifier it issued', async () => {
    const city = await meterOf('Flat', '541401200000000001', { country: 'ZZ', region: 'ZZ-EA' });
    expect(await operatorOf(city)).toEqual({ operator: 'east_city', by: 'prefix', prefix: '5414012' });
    const suburb = await meterOf('House', '541409900000000001', { country: 'ZZ', region: 'ZZ-EA' });
    expect(await operatorOf(suburb)).toEqual({ operator: 'east_grid', by: 'prefix', prefix: '54140' });
  });

  it('then by the municipality of the place, then by the one distribution operator of its region', async () => {
    const mill = await meterOf('Mill', '871000000000000002', { country: 'ZZ', region: 'ZZ-WE' }, '0042');
    expect(await operatorOf(mill)).toEqual({ operator: 'millbrook_power', by: 'municipality', municipality: 'ZZ-0042' });
    const farm = await meterOf('Farm', '871000000000000003', { country: 'ZZ', region: 'ZZ-WE' });
    expect(await operatorOf(farm)).toEqual({ operator: 'west_grid', by: 'region', region: 'ZZ-WE' });
  });

  it('reads first what the point says itself, and refuses by name when two operators share a region and nothing else decides', async () => {
    const shed = await meterOf('Shed', '871000000000000004', { country: 'ZZ', region: 'ZZ-EA' });
    await expect(operatorOf(shed)).rejects.toThrow(/grid_operator_not_found: no operator of ZZ says it runs meter/);
    await db.query(`select grid.connect_to_operator($1, 'east_grid')`, [shed]);
    expect(await operatorOf(shed)).toEqual({ operator: 'east_grid', by: 'meter' });
  });
});

describe('grid.substations', () => {
  it('says whether participants sit downstream of one substation, and null when one does not say', async () => {
    await db.query(`insert into sources (code, name, kind, published_by) values ('zz_capacity_map', 'Testland hosting capacity map', 'file', 'pack:zz') on conflict do nothing`);
    const [a, b] = (await db.query<{ id: string }>(
      `insert into grid.substations (operator, code, name, geometry, voltage_levels, hosting_capacity_mw, reserved_capacity_mw, capacity_on, source_code, reference, published_by)
       values ('west_grid', 'WG-01', 'West One', ST_SetSRID(ST_MakePoint(4.35, 50.85), 4326), '{hv, lv}', 12.5, 3, '2026-06-30', 'zz_capacity_map', 'Row WG-01', 'pack:zz'),
              ('west_grid', 'WG-02', 'West Two', null, '{hv, lv}', null, null, null, null, null, 'pack:zz')
       returning id`)).rows.map((r) => r.id);
    const m1 = await meterOf('Bakery', '871000000000000011', { country: 'ZZ', region: 'ZZ-WE' });
    const m2 = await meterOf('School', '871000000000000012', { country: 'ZZ', region: 'ZZ-WE' });
    const m3 = await meterOf('Garage', '871000000000000013', { country: 'ZZ', region: 'ZZ-WE' });
    await db.query(`select grid.connect_to_operator($1, 'west_grid', null, $2)`, [m1, a]);
    await db.query(`select grid.connect_to_operator($1, null, null, $2)`, [m2, a]);
    const owner = async (m: string) => (await one<{ p: string }>(db, 'select participant_id p from meters where id = $1', [m])).p;
    const [p1, p2, p3] = [await owner(m1), await owner(m2), await owner(m3)];
    expect((await one<{ o: string }>(db, 'select grid_operator o from grid.meters where id = $1', [m2])).o).toBe('west_grid');

    const same = async (ids: string[]) => (await one<{ s: { same: boolean | null; unknown: string[] } }>(db, 'select grid.same_substation($1::uuid[]) s', [ids])).s;
    expect((await same([p1, p2])).same).toBe(true);
    expect(await same([p1, p3])).toMatchObject({ same: null, unknown: [p3] });
    await db.query(`select grid.connect_to_operator($1, 'west_grid', null, $2)`, [m3, b]);
    expect((await same([p1, p2, p3])).same).toBe(false);

    await expect(db.query(`select grid.connect_to_operator($1, 'east_grid', null, $2)`, [m3, a])).rejects.toThrow(/substation_of_other_operator/);
    await expect(db.query(
      `insert into grid.substations (operator, code, name, hosting_capacity_mw, published_by) values ('west_grid', 'WG-03', 'Undated', 4, 'pack:zz')`,
    )).rejects.toThrow(/substations_capacity_dated/);
  });
});

describe('grid.mandates', () => {
  let meter: string;
  let connector: string;
  const authorise = (from: string, to: string, on = '2026-11-01') =>
    db.query('select grid.authorise_reading($1, $2, $3, $4, $5) id', [connector, meter, from, to, on]);

  beforeAll(async () => {
    meter = await meterOf('Dairy', '541401200000000099', { country: 'ZZ', region: 'ZZ-EA' });
    await db.query(`insert into sources (code, name, kind, auth, published_by) values ('zz_data_hub', 'Testland meter data hub', 'api', 'mandate', 'pack:zz')`);
    connector = await insert(db, 'connectors', { organisation_id: org, source_code: 'zz_data_hub', name: 'Meter data' });
  });

  it('is requested, approved with its signed copy, and then lets a connector read the meter over its data period', async () => {
    await expect(authorise('2026-01-01', '2026-02-01')).rejects.toThrow(/mandate_missing: zz_data_hub reads under mandate/);
    const id = (await one<{ id: string }>(db,
      `select grid.request_mandate($1, 'PT15M', '{load_curve, daily_index}', 'sharing_operation', '2026-10-01', '2027-10-01', '2025-10-01', '2026-12-31') id`,
      [meter])).id;
    expect(await one(db, 'select status, operator from grid.mandates where id = $1', [id])).toEqual({ status: 'sent', operator: 'east_city' });
    await expect(authorise('2026-01-01', '2026-02-01')).rejects.toThrow(/mandate_missing/);

    const signed = (await one<{ id: string }>(db,
      `select attach_document('meter', $1, 'Signed mandate', 'document', 'storage://mandates/dairy.pdf', 'application/pdf') id`, [meter])).id;
    await db.query(`select grid.decide_mandate($1, true, $2, 'HUB-123')`, [id, signed]);
    expect((await authorise('2026-01-01', '2026-02-01')).rows[0]).toEqual({ id });
    // Outside the data period, the scope or the step: refused as out of scope; after the validity, as expired.
    await expect(authorise('2025-01-01', '2025-02-01')).rejects.toThrow(/mandate_scope: .* load_curve from 2025-01-01 to 2025-02-01/);
    await expect(db.query(`select grid.authorise_reading($1, $2, '2026-01-01', '2026-02-01', '2026-11-01', 'technical_data') id`, [connector, meter]))
      .rejects.toThrow(/mandate_scope: .* technical_data/);
    await expect(db.query(`select grid.authorise_reading($1, $2, '2026-01-01', '2026-02-01', '2026-11-01', 'load_curve', 'PT5M') id`, [connector, meter]))
      .rejects.toThrow(/mandate_scope: .* at a step of PT5M/);
    expect((await db.query(`select grid.authorise_reading($1, $2, '2026-01-01', '2026-02-01', '2026-11-01', 'daily_index', 'PT30M') id`, [connector, meter])).rows[0])
      .toEqual({ id });
    await expect(db.query(`select grid.authorise_reading($1, $2, '2026-01-01', '2026-02-01', '2026-11-01', 'load_curve', 'half an hour') id`, [connector, meter]))
      .rejects.toThrow(/invalid_duration/);
    await expect(authorise('2026-01-01', '2026-02-01', '2027-11-01')).rejects.toThrow(/mandate_expired/);
    await expect(db.query(`select grid.decide_mandate($1, false)`, [id])).rejects.toThrow(/mandate_already_decided/);

    await db.query(`select grid.revoke_mandate($1, 'The member left the community')`, [id]);
    expect(await one(db, 'select status, reason from grid.mandates where id = $1', [id])).toEqual({ status: 'revoked', reason: 'The member left the community' });
    await expect(authorise('2026-01-01', '2026-02-01')).rejects.toThrow(/mandate_expired/);
    await expect(db.query(`select grid.revoke_mandate($1)`, [id])).rejects.toThrow(/mandate_not_approved/);
  });

  it('is refused with its reason, expires at the end of its validity, and asks nothing of a source that reads without mandate', async () => {
    const refused = (await one<{ id: string }>(db,
      `select grid.request_mandate($1, 'P1D', '{energy_history}', 'study', '2026-10-01') id`, [meter])).id;
    await db.query(`select grid.decide_mandate($1, false, null, null, 'No answer from the customer')`, [refused]);
    expect(await one(db, 'select status from grid.mandates where id = $1', [refused])).toEqual({ status: 'refused' });

    const short = (await one<{ id: string }>(db,
      `select grid.request_mandate($1, 'PT30M', '{load_curve}', 'study', '2026-10-01', '2026-12-01') id`, [meter])).id;
    await db.query(`select grid.decide_mandate($1, true)`, [short]);
    expect((await one<{ n: number }>(db, `select grid.expire_mandates('2026-12-01') n`)).n).toBe(1);
    expect(await one(db, 'select status from grid.mandates where id = $1', [short])).toEqual({ status: 'expired' });

    const elsewhere = await one<{ id: string }>(db, `select attach_document('project', $1, 'Notes', 'document', 'storage://x.pdf') id`, [project]);
    await expect(db.query(`select grid.decide_mandate($1, true, $2)`, [
      (await one<{ id: string }>(db, `select grid.request_mandate($1, 'P1D', '{daily_index}', 'study', '2026-10-01') id`, [meter])).id, elsewhere.id,
    ])).rejects.toThrow(/document_of_other_object/);
    await expect(db.query(`select grid.request_mandate($1, 'PT2M', '{load_curve}', 'study', '2026-10-01')`, [meter])).rejects.toThrow(/mandates_granularity/);

    await db.query(`insert into sources (code, name, kind, auth, published_by) values ('zz_open_data', 'Testland open data', 'api', 'none', 'pack:zz')`);
    const open = await insert(db, 'connectors', { organisation_id: org, source_code: 'zz_open_data', name: 'Open data' });
    expect((await one(db, `select grid.authorise_reading($1, $2, '2026-01-01', '2026-02-01') id`, [open, meter]))).toEqual({ id: null });
  });
});

describe('the market', () => {
  it('names the market series of a bidding zone, and the parties that hold a role of the market', async () => {
    await db.query(`insert into sources (code, name, kind, published_by) values ('zz_exchange', 'Testland power exchange', 'api', 'pack:zz') on conflict do nothing`);
    const price = (await one<{ id: string }>(db, `select series_ensure('organisation', $1, 'energy_price', 'measured', 'interval', '1 hour', null, null, 'zz_exchange', 'Day-ahead price') id`, [org])).id;
    await db.query(`select set_attribute('series', $1, 'bidding_zone', '"10YZZ----------1"', null, 'zz_exchange', 'the zone of the auction', 'published')`, [price]);
    expect((await db.query<{ id: string }>(`select grid.zone_series($1, '10YZZ----------1', 'energy_price') id`, [org])).rows.map((r) => r.id)).toEqual([price]);
    expect((await db.query(`select grid.zone_series($1, '10YZZ----------9', 'energy_price') id`, [org])).rows).toEqual([]);

    const supplier = await insert(db, 'contacts', { organisation_id: org, name: 'A supplier', kind: 'company' });
    await insert(db, 'grid.market_parties', { organisation_id: org, contact_id: supplier, role: 'balance_responsible_party', eic_code: '11XZZ-SUPPLIER-1', bidding_zone: '10YZZ----------1', valid_from: '2026-01-01' });
    expect(await one(db, `select role, eic_code from grid.market_parties where contact_id = $1`, [supplier])).toEqual({ role: 'balance_responsible_party', eic_code: '11XZZ-SUPPLIER-1' });
    await expect(insert(db, 'grid.market_parties', { organisation_id: org, role: 'trader' })).rejects.toThrow(/foreign key/);
    await expect(insert(db, 'grid.market_parties', { organisation_id: org, role: 'supplier', eic_code: 'not an EIC' })).rejects.toThrow(/market_parties_eic_format/);
  });

  it('resolves the transmission operator of a place, the only one of its country', async () => {
    const p = (await one<{ id: string }>(db, `select join_project($1, 'Barn', $2) id`, [project, JSON.stringify({ country: 'ZZ', region: 'ZZ-WE' })])).id;
    const m = (await one<{ m: Record<string, unknown> }>(db, `select grid.market_of('participant', $1) m`, [p])).m;
    expect(m).toMatchObject({ transmission_operator: { operator: 'zz_tso', eic_code: null }, country: 'ZZ', bidding_zone: { value: null, refusal: 'parameter_missing' } });
  });
});

describe('support schemes', () => {
  it('reads the negative-price obligation of a scheme from its pack by date, a threshold lowering over time, and prices injection hour by hour', async () => {
    await db.query(`insert into sources (code, name, kind, published_by) values ('zz_support_law', 'Testland support law', 'text', 'pack:zz') on conflict do nothing`);
    // A scheme of the pack: a feed-in tariff for PV up to 500 kW for 20 years; from 2026 a producer of
    // 400 kW or more stops at negative prices, from 2027 one of 100 kW or more.
    await db.query(`insert into grid.support_schemes (code, country, name, kind, device_types, max_power_kw, duration_years, negative_price_rules, source_code, reference, published_by)
                    values ('zz_tariff', 'ZZ', 'Testland feed-in tariff', 'feed_in_tariff', '{solar}', 500, 20,
                            '[{"threshold_kw": 400, "valid_from": "2026-01-01", "valid_to": "2027-01-01", "reference": "Article 3"},
                              {"threshold_kw": 100, "valid_from": "2027-01-01", "reference": "Article 3, as amended"}]', 'zz_support_law', 'Article 1', 'pack:zz')`);
    const roof = (await one<{ id: string }>(db, `select join_project($1, 'Roof', $2) id`, [project, JSON.stringify({ country: 'ZZ', region: 'ZZ-WE' })])).id;
    await db.query(`update participants set time_zone = 'UTC' where id = $1`, [roof]);
    const pv = await insert(db, 'devices', { organisation_id: org, participant_id: roof, name: 'Roof PV', device_type: 'solar', rated_power_kw: 250 });
    const big = await insert(db, 'devices', { organisation_id: org, participant_id: roof, name: 'Field PV', device_type: 'solar', rated_power_kw: 900 });
    const contract = await insert(db, 'grid.support_contracts', { device_id: pv, scheme: 'zz_tariff', reference: 'ZZ-2026-001', valid_from: '2026-03-01', tariff: 100 });
    await expect(insert(db, 'grid.support_contracts', { device_id: big, scheme: 'zz_tariff', valid_from: '2026-03-01', tariff: 100 })).rejects.toThrow(/support_not_eligible/);
    expect(await one(db, 'select valid_to::text valid_to from grid.support_contracts where id = $1', [contract])).toEqual({ valid_to: '2046-03-01' });

    const support = async (on: string) => (await one<{ s: Record<string, unknown> }>(db, 'select grid.support_of($1, $2) s', [pv, on])).s;
    expect(await support('2026-06-01')).toMatchObject({ scheme: 'zz_tariff', kind: 'feed_in_tariff', formula: 'fixed_price', tariff: 100, currency: 'ZZD',
      negative_price_stop: { required: false, threshold_kw: 400, reference: 'Article 3', source_code: 'zz_support_law' } });
    expect(await support('2027-06-01')).toMatchObject({ negative_price_stop: { required: true, threshold_kw: 100, reference: 'Article 3, as amended' } });
    expect(await support('2026-01-01')).toBeNull();

    // Three hours of injection; the second at a negative price.
    const meter = (await one<{ id: string }>(db, `select declare_meter($1, '871000000000000099', 'gs1_gsrn') id`, [roof])).id;
    const hours = ['2027-06-01 10:00+00', '2027-06-01 11:00+00', '2027-06-01 12:00+00'];
    const series = async (kind: string, id: string, quantity: string, values: number[], unit: string | null = null) =>
      (await one<{ id: string }>(db, `select series_id id from store(null, $1::timestamptz[], $2::float8[], null, $6, null,
         jsonb_build_object('object_kind', $3::text, 'object_id', $4::uuid, 'quantity_code', $5::text, 'step', '1 hour'))`, [hours, values, kind, id, quantity, unit])).id;
    const injection = await series('meter', meter, 'energy', [100, 150, 120]);
    const price = await series('organisation', org, 'energy_price', [40, -5, 30], 'ZZD-PER-MegaW-HR');
    const revenue = async (on: string, withPrice: boolean) => (await one<{ r: Record<string, unknown> }>(db,
      'select grid.injection_revenue($1, $2, $3, $4, $5) r', [pv, injection, on, '2027-06-01 13:00+00', withPrice ? price : null])).r;
    await expect(revenue('2027-06-01 10:00+00', false)).rejects.toThrow(/price_series_required/);
    expect(await revenue('2027-06-01 10:00+00', true)).toMatchObject({ injected_kwh: 370, paid_kwh: 220, stopped_kwh: 150, revenue: 22, currency: 'ZZD' });
  });
});
