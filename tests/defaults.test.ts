// One resolution of a parameter, in one order for every attribute type: the
// object's own attribute, its parents' nearest first, its organisation's
// (an attribute, since an organisation is an object), its region's, the
// regions it is part of nearest first, its country's — and nothing else: a value nobody decided is
// refused by name, never guessed. Pack values are dated and cited.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, USER_B, asUser, freshDatabase, insert, one, organisation, participant } from './helpers/db.js';

let db: PGlite;
let org: string;
let home: string;
let device: string;

interface Parameter {
  value: unknown;
  level: string;
  object_id?: string;
  region?: string;
  country?: string;
  source_code: string | null;
  reference: string | null;
  valid_from: string | null;
}

const parameterOf = async (kind: string, object: string, attributeType: string, at = '2026-06-01') =>
  (await one<{ p: Parameter }>(db, 'select parameter_of($1, $2, $3, $4) p', [kind, object, attributeType, at])).p;

beforeAll(async () => {
  db = await freshDatabase();
  org = await organisation(db, 'A developer', USER_A);
  await organisation(db, 'A neighbour', USER_B);
  // A pack: a country, a region, its statistics office, two properties it decides.
  // A currency of no country, as a pack would add it.
  await db.query(`insert into currencies (code, name) values ('ZZZ', 'Testland currency') on conflict do nothing`);
  await db.query(`insert into countries (code, name, currency, time_zones, region_level, pack_version, published_by) values ('ZZ', 'Testland', 'ZZZ', '{UTC}', 'region', '0.1.0', 'pack:zz')`);
  await db.query(`insert into regions (code, country, name, published_by) values ('ZZ-NO', 'ZZ', 'North', 'pack:zz'), ('ZZ-SO', 'ZZ', 'South', 'pack:zz')`);
  await db.query(`insert into sources (code, name, kind, base_url, published_by) values ('zz_statistics', 'Testland statistics office', 'text', 'https://statistics.example/', 'pack:zz')`);
  // The properties come from the core vocabulary: what a pack cites is defined there.
  await db.query(`insert into defaults (attribute_type, country, region, value, valid_from, valid_to, source_code, reference, published_by) values
                    ('pv_specific_yield_fallback', 'ZZ', null, '950', '2020-01-01', '2026-01-01', 'zz_statistics', 'yearbook 2019, table 4', 'pack:zz'),
                    ('pv_specific_yield_fallback', 'ZZ', null, '980', '2026-01-01', null, 'zz_statistics', 'yearbook 2025, table 4', 'pack:zz'),
                    ('pv_specific_yield_fallback', 'ZZ', 'ZZ-SO', '1150', '2020-01-01', null, 'zz_statistics', 'yearbook 2025, table 5', 'pack:zz'),
                    ('offpeak_hours', 'ZZ', null, null, null, null, 'zz_statistics', 'depends on the supply contract', 'pack:zz')`);
  home = await participant(db, { organisation_id: org, name: 'Farm', country: 'ZZ', region: 'ZZ-NO' });
  device = await insert(db, 'devices', { organisation_id: org, participant_id: home, name: 'Array', device_type: 'solar' });
});

afterAll(async () => {
  await db.close();
});

describe('parameter_of', () => {
  it('reads the country of the pack, with its source and reference, as it was on the day asked', async () => {
    expect(await parameterOf('device', device, 'pv_specific_yield_fallback')).toMatchObject({
      value: 980, level: 'country', country: 'ZZ', source_code: 'zz_statistics', reference: 'yearbook 2025, table 4', valid_from: '2026-01-01',
    });
    expect(await parameterOf('device', device, 'pv_specific_yield_fallback', '2024-06-01')).toMatchObject({ value: 950, reference: 'yearbook 2019, table 4' });
  });

  it('reads the region before the country', async () => {
    const south = await participant(db, { organisation_id: org, name: 'Vineyard', country: 'ZZ', region: 'ZZ-SO' });
    expect(await parameterOf('participant', south, 'pv_specific_yield_fallback')).toMatchObject({ value: 1150, level: 'region', region: 'ZZ-SO' });
  });

  it('reads the country of a project for the project itself, which has no place of its own', async () => {
    const project = await insert(db, 'projects', { organisation_id: org, name: 'Testland sharing', country: 'ZZ' });
    expect(await parameterOf('project', project, 'pv_specific_yield_fallback')).toMatchObject({
      value: 980, level: 'country', country: 'ZZ', source_code: 'zz_statistics', reference: 'yearbook 2025, table 4',
    });
    await expect(parameterOf('project', project, 'vat_rate_electricity')).rejects.toThrow(/parameter_missing: vat_rate_electricity for .*, reached country ZZ/);
  });

  it('climbs from the region to the region it is part of before the country: a value decided above holds below without a copy', async () => {
    // Two levels, as a pack listing departments under their regions does.
    await db.query(`insert into regions (code, country, name, published_by) values ('ZZ-E', 'ZZ', 'East', 'pack:zz')`);
    await db.query(`insert into regions (code, country, name, parent_code, published_by) values ('ZZ-E1', 'ZZ', 'East One', 'ZZ-E', 'pack:zz'), ('ZZ-E2', 'ZZ', 'East Two', 'ZZ-E', 'pack:zz')`);
    await db.query(`insert into defaults (attribute_type, country, region, value, valid_from, source_code, reference, published_by) values
                      ('pv_specific_yield_fallback', 'ZZ', 'ZZ-E', '1200', '2020-01-01', 'zz_statistics', 'yearbook 2025, table 6', 'pack:zz'),
                      ('pv_specific_yield_fallback', 'ZZ', 'ZZ-E2', '1250', '2020-01-01', 'zz_statistics', 'yearbook 2025, table 7', 'pack:zz'),
                      ('offpeak_hours', 'ZZ', 'ZZ-E', null, null, 'zz_statistics', 'decided by each operator of the East', 'pack:zz')`);
    const east1 = await participant(db, { organisation_id: org, name: 'Orchard', country: 'ZZ', region: 'ZZ-E1' });
    const two = await participant(db, { organisation_id: org, name: 'Mill', country: 'ZZ', region: 'ZZ-E2' });
    expect(await parameterOf('participant', east1, 'pv_specific_yield_fallback')).toMatchObject({ value: 1200, level: 'region', region: 'ZZ-E', reference: 'yearbook 2025, table 6' });
    expect(await parameterOf('participant', two, 'pv_specific_yield_fallback')).toMatchObject({ value: 1250, level: 'region', region: 'ZZ-E2' });
    await expect(parameterOf('participant', east1, 'offpeak_hours')).rejects.toThrow(/parameter_not_decided: offpeak_hours in ZZ-E: decided by each operator/);
    // A region whose parents nobody decided for reads the country, even when its pack lists a loop.
    await db.query(`insert into regions (code, country, name, published_by) values ('ZZ-W', 'ZZ', 'West', 'pack:zz')`);
    await db.query(`insert into regions (code, country, name, parent_code, published_by) values ('ZZ-W1', 'ZZ', 'West One', 'ZZ-W', 'pack:zz')`);
    await db.query(`update regions set parent_code = 'ZZ-W1' where code = 'ZZ-W'`);
    const west = await participant(db, { organisation_id: org, name: 'Dairy', country: 'ZZ', region: 'ZZ-W1' });
    expect(await parameterOf('participant', west, 'pv_specific_yield_fallback')).toMatchObject({ value: 980, level: 'country', country: 'ZZ' });
  });

  it('reads the organisation before its region: an attribute of the organisation, which is an object', async () => {
    await asUser(db, USER_A, () => db.query(`select set_attribute('organisation', $1, 'pv_specific_yield_fallback', '1010', null, null, 'board decision')`, [org]));
    expect(await parameterOf('device', device, 'pv_specific_yield_fallback')).toMatchObject({ value: 1010, level: 'organisation', object_id: org, reference: 'board decision' });
    expect(await parameterOf('organisation', org, 'pv_specific_yield_fallback')).toMatchObject({ value: 1010, level: 'object' });
  });

  it('reads the parents of the object nearest first, then the object itself', async () => {
    await db.query(`select set_attribute('participant', $1, 'pv_specific_yield_fallback', '1020', null, 'zz_statistics', 'site survey')`, [home]);
    expect(await parameterOf('device', device, 'pv_specific_yield_fallback')).toMatchObject({ value: 1020, level: 'participant', object_id: home, source_code: 'zz_statistics' });
    await db.query(`select set_attribute('device', $1, 'pv_specific_yield_fallback', '1040', null, null, 'monitoring')`, [device]);
    expect(await parameterOf('device', device, 'pv_specific_yield_fallback')).toMatchObject({ value: 1040, level: 'object', object_id: device });
  });

  it('refuses by name what nobody decided, saying the level it reached; and gives the reference of a country that decides no single value', async () => {
    await expect(parameterOf('device', device, 'vat_rate_electricity')).rejects.toThrow(/parameter_missing: vat_rate_electricity for .*, reached country ZZ/);
    await expect(parameterOf('organisation', org, 'vat_rate_electricity')).rejects.toThrow(/parameter_missing: vat_rate_electricity for .*, reached organisation/);
    await expect(parameterOf('device', device, 'offpeak_hours')).rejects.toThrow(/parameter_not_decided: offpeak_hours in ZZ: depends on the supply contract/);
    await expect(parameterOf('device', device, 'no_such_property')).rejects.toThrow(/attribute_type_unknown/);
  });
});

describe('the quality of a value', () => {
  it('says with every value whether it is published, measured, estimated or assumed, a word of one domain', async () => {
    const words = await one<{ check: string }>(db, `select pg_get_constraintdef(c.oid) "check" from pg_constraint c
      join pg_type t on t.oid = c.contypid join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'nexgen' and t.typname = 'value_quality'`);
    expect(words.check).toMatch(/'published'.*'measured'.*'estimated'.*'assumed'/);
    // A pack value is published unless the pack says otherwise; a statistic applied to a place is estimated.
    await db.query(`insert into defaults (attribute_type, country, value, valid_from, source_code, reference, quality, published_by)
                      values ('energy_price_household', 'ZZ', '180', '2020-01-01', 'zz_statistics', 'survey 2024, table 2', 'estimated', 'pack:zz'),
                             ('energy_price_business', 'ZZ', '150', '2020-01-01', 'zz_statistics', 'regulated tariff 2024', 'published', 'pack:zz')`);
    const shed = await participant(db, { organisation_id: org, name: 'Shed', country: 'ZZ', region: 'ZZ-SO' });
    expect(await parameterOf('participant', shed, 'energy_price_business')).toMatchObject({ value: 150, level: 'country', quality: 'published' });
    expect(await parameterOf('participant', shed, 'energy_price_household')).toMatchObject({ value: 180, quality: 'estimated' });
    // An attribute nobody qualified is estimated; a reading says measured; a conventional value is assumed.
    await db.query(`select set_attribute('participant', $1, 'annual_consumption', '4200', null, null, 'an estimate of the owner')`, [shed]);
    expect(await parameterOf('participant', shed, 'annual_consumption')).toMatchObject({ value: 4200, quality: 'estimated' });
    await db.query(`select set_attribute('participant', $1, 'annual_consumption', '4350', '2026-01-01', null, 'meter readings of 2025', 'measured')`, [shed]);
    expect(await parameterOf('participant', shed, 'annual_consumption')).toMatchObject({ value: 4350, quality: 'measured', reference: 'meter readings of 2025' });
    await db.query(`select set_attribute('participant', $1, 'annual_consumption', '4000', '2026-02-01', null, 'a typical household', p_quality => 'assumed')`, [shed]);
    expect(await parameterOf('participant', shed, 'annual_consumption')).toMatchObject({ value: 4000, quality: 'assumed' });
    expect((await parameterOf('participant', shed, 'annual_consumption')) as unknown as Record<string, unknown>).not.toHaveProperty('status');
    for (const word of ['guessed', 'default']) {
      await expect(db.query(`select set_attribute('participant', $1, 'annual_consumption', '1', '2026-03-01', null, null, $2)`, [shed, word])).rejects.toThrow(/value_quality_word/);
    }
  });
});

describe('the defaults of a pack', () => {
  it('check their value and their period, cite a source, and hold in a region of their country', async () => {
    await expect(db.query(`insert into defaults (attribute_type, country, value, source_code, published_by) values ('vat_rate_electricity', 'ZZ', '"high"', 'zz_statistics', 'pack:zz')`))
      .rejects.toThrow(/invalid_value/);
    await expect(db.query(`insert into defaults (attribute_type, country, value, valid_from, source_code, published_by) values ('pv_specific_yield_fallback', 'ZZ', '990', '2025-06-01', 'zz_statistics', 'pack:zz')`))
      .rejects.toThrow(/overlapping_value/);
    await expect(db.query(`insert into defaults (attribute_type, country, value, published_by) values ('vat_rate_electricity', 'ZZ', '0.2', 'pack:zz')`))
      .rejects.toThrow(/source_code/);
    await expect(db.query(`insert into defaults (attribute_type, country, region, value, source_code, published_by) values ('vat_rate_electricity', 'ZZ', 'ZZ-XX', '0.2', 'zz_statistics', 'pack:zz')`))
      .rejects.toThrow(/foreign key/);
    await expect(db.query(`insert into defaults (attribute_type, value, source_code, published_by) values ('vat_rate_electricity', '0.2', 'zz_statistics', 'pack:zz')`))
      .rejects.toThrow(/country/);
  });

  it('are never edited: a period is closed and a new row added', async () => {
    await expect(db.query(`update defaults set value = '990' where attribute_type = 'pv_specific_yield_fallback' and region is null and valid_from = '2026-01-01'`))
      .rejects.toThrow(/value_edited: pv_specific_yield_fallback from 2026-01-01 holds 980/);
    await db.query(`update defaults set valid_to = '2027-01-01', reference = 'yearbook 2025, table 4, revised' where attribute_type = 'pv_specific_yield_fallback' and region is null and valid_from = '2026-01-01'`);
    await db.query(`insert into defaults (attribute_type, country, value, valid_from, source_code, reference, published_by) values ('pv_specific_yield_fallback', 'ZZ', '990', '2027-01-01', 'zz_statistics', 'yearbook 2026, table 4', 'pack:zz')`);
    const rows = await db.query<{ value: number; valid_to: string | null }>(
      `select value, valid_to::text from defaults where attribute_type = 'pv_specific_yield_fallback' and region is null order by valid_from`);
    expect(rows.rows).toEqual([{ value: 950, valid_to: '2026-01-01' }, { value: 980, valid_to: '2027-01-01' }, { value: 990, valid_to: null }]);
  });

  it('record which version of the pack the installation holds, and its checksum', async () => {
    await expect(db.query(`update countries set pack_checksum = 'md5:abc' where code = 'ZZ'`)).rejects.toThrow(/countries_checksum_format/);
    await db.query(`update countries set pack_checksum = $1 where code = 'ZZ'`, ['sha256:' + 'a'.repeat(64)]);
    const c = await one<{ pack_checksum: string; pack_version: string }>(db, `select pack_checksum, pack_version from countries where code = 'ZZ'`);
    expect(c).toEqual({ pack_checksum: 'sha256:' + 'a'.repeat(64), pack_version: '0.1.0' });
  });
});

describe('a default that holds for a condition', () => {
  let project: string;
  let village: string;
  let town: string;

  beforeAll(async () => {
    // The pack numbers its municipalities, lists two under the North, and
    // says the class of one in its density grid.
    await db.query(`insert into identifier_schemes (code, name, pattern, published_by) values ('zz_municipality', 'Testland municipality code', '^[0-9]{4}$', 'pack:zz')`);
    await db.query(`update countries set municipality_scheme = 'zz_municipality' where code = 'ZZ'`);
    await db.query(`insert into regions (code, country, name, kind, parent_code, published_by) values
                      ('ZZ-0001', 'ZZ', 'Hamlet', 'municipality', 'ZZ-NO', 'pack:zz'),
                      ('ZZ-0002', 'ZZ', 'Harbour', 'municipality', 'ZZ-NO', 'pack:zz')`);
    await db.query(`insert into defaults (attribute_type, country, region, value, valid_from, source_code, reference, published_by) values
                      ('density_class', 'ZZ', 'ZZ-0001', '"rural"', '2025-01-01', 'zz_statistics', 'density grid 2025', 'pack:zz')`);
    // A sharing perimeter: 1 km for a collective operation, 5 km in a rural
    // municipality, 4 km around a wind turbine; an excise by segment.
    await db.query(`insert into defaults (attribute_type, country, condition, value, valid_from, source_code, reference, published_by) values
                      ('sharing_max_distance_m', 'ZZ', '{"project_kind": "collective_self_consumption"}', '1000', '2025-01-01', 'zz_statistics', 'sharing act, art. 1', 'pack:zz'),
                      ('sharing_max_distance_m', 'ZZ', '{"project_kind": "collective_self_consumption", "density_class": "rural"}', '5000', '2025-01-01', 'zz_statistics', 'sharing act, art. 2', 'pack:zz'),
                      ('sharing_max_distance_m', 'ZZ', '{"project_kind": "collective_self_consumption", "device_type": "wind"}', '4000', '2025-01-01', 'zz_statistics', 'sharing act, art. 3', 'pack:zz'),
                      ('electricity_excise', 'ZZ', '{"segment": "residential"}', '30', '2025-01-01', 'zz_statistics', 'excise act, households', 'pack:zz'),
                      ('electricity_excise', 'ZZ', '{"segment": "professional"}', '20', '2025-01-01', 'zz_statistics', 'excise act, businesses', 'pack:zz')`);
    project = await insert(db, 'projects', { organisation_id: org, name: 'Hamlet community', kind: 'energy_community', country: 'ZZ' });
    village = await insert(db, 'participants', { organisation_id: org, project_id: project, name: 'Barn', country: 'ZZ', region: 'ZZ-NO', segment: 'business' });
    town = await insert(db, 'participants', { organisation_id: org, project_id: project, name: 'Quay', country: 'ZZ', region: 'ZZ-NO' });
    await db.query(`update participants set municipality = '0001' where id = $1`, [village]);
    await db.query(`update participants set municipality = '0002' where id = $1`, [town]);
  });

  it('is the most specific row whose conditions the object meets, and says which condition answered', async () => {
    // An energy community is a collective self-consumption: the kind matches its refinements.
    expect(await parameterOf('participant', town, 'sharing_max_distance_m')).toMatchObject({
      value: 1000, level: 'country', conditions: { project_kind: 'collective_self_consumption' }, reference: 'sharing act, art. 1',
    });
    // The density class of the municipality is the municipality's default, and drives the perimeter.
    expect(await one(db, 'select municipality_of($1) m', [village])).toEqual({ m: 'ZZ-0001' });
    expect(await parameterOf('participant', village, 'density_class')).toMatchObject({ value: 'rural', level: 'municipality', region: 'ZZ-0001' });
    expect(await parameterOf('participant', village, 'sharing_max_distance_m')).toMatchObject({
      value: 5000, level: 'country', conditions: { project_kind: 'collective_self_consumption', density_class: 'rural' },
    });
    // A segment matches its refinements: a business is professional; a household (the default segment) residential.
    expect(await parameterOf('participant', village, 'electricity_excise')).toMatchObject({ value: 20, conditions: { segment: 'professional' } });
    expect(await parameterOf('participant', town, 'electricity_excise')).toMatchObject({ value: 30, conditions: { segment: 'residential' } });
  });

  it('reads the technology from the device it is asked for, and refuses two rows as specific as each other', async () => {
    const turbine = await insert(db, 'devices', { organisation_id: org, participant_id: town, name: 'Turbine', device_type: 'wind' });
    expect(await parameterOf('device', turbine, 'sharing_max_distance_m')).toMatchObject({ value: 4000, conditions: { project_kind: 'collective_self_consumption', device_type: 'wind' } });
    const rural = await insert(db, 'devices', { organisation_id: org, participant_id: village, name: 'Turbine', device_type: 'wind' });
    await expect(parameterOf('device', rural, 'sharing_max_distance_m')).rejects.toThrow(/parameter_ambiguous: sharing_max_distance_m in ZZ: two values as specific as each other/);
  });

  it('climbs from the municipality to its region before the country, and holds nothing for an object outside its condition', async () => {
    await db.query(`insert into defaults (attribute_type, country, region, condition, value, valid_from, source_code, reference, published_by) values
                      ('sharing_max_distance_m', 'ZZ', 'ZZ-NO', '{"project_kind": "collective_self_consumption"}', '1500', '2025-01-01', 'zz_statistics', 'northern act', 'pack:zz'),
                      ('sharing_max_distance_m', 'ZZ', 'ZZ-0002', '{"project_kind": "collective_self_consumption"}', '1200', '2025-01-01', 'zz_statistics', 'harbour by-law', 'pack:zz')`);
    expect(await parameterOf('participant', town, 'sharing_max_distance_m')).toMatchObject({ value: 1200, level: 'municipality', region: 'ZZ-0002' });
    // The region's value wins over the country's, however specific the country's.
    expect(await parameterOf('participant', village, 'sharing_max_distance_m')).toMatchObject({ value: 1500, level: 'region', region: 'ZZ-NO' });
    const study = await insert(db, 'projects', { organisation_id: org, name: 'A study', status: 'simulation', country: 'ZZ' });
    const alone = await insert(db, 'participants', { organisation_id: org, project_id: study, name: 'Alone', country: 'ZZ', region: 'ZZ-NO' });
    await expect(parameterOf('participant', alone, 'sharing_max_distance_m')).rejects.toThrow(/parameter_missing: sharing_max_distance_m for .*, reached country ZZ/);
  });

  it('is a row of its own for each condition, edited never', async () => {
    await expect(db.query(`insert into defaults (attribute_type, country, condition, value, valid_from, source_code, reference, published_by) values
                             ('electricity_excise', 'ZZ', '{"segment": "residential"}', '31', '2025-06-01', 'zz_statistics', 'excise act, revised', 'pack:zz')`))
      .rejects.toThrow(/overlapping_value/);
    await expect(db.query(`update defaults set condition = '{"segment": "professional"}' where attribute_type = 'electricity_excise' and condition = '{"segment": "residential"}'`))
      .rejects.toThrow(/value_edited/);
    await expect(db.query(`insert into defaults (attribute_type, country, condition, value, source_code, published_by) values ('electricity_excise', 'ZZ', '{"segment": "pensioner"}', '1', 'zz_statistics', 'pack:zz')`))
      .rejects.toThrow(/^condition_invalid: pensioner is not a segments code/);
  });

  it('holds for an attribute of the object compared with a number, in the same shape as an action template, and decides nothing without it', async () => {
    await db.query(`insert into defaults (attribute_type, country, condition, value, valid_from, source_code, reference, published_by) values
                      ('electricity_excise', 'ZZ', '{"segment": "professional", "attribute": {"attribute_type": "annual_consumption", "op": ">=", "value": 1000000}}', '10', '2025-01-01', 'zz_statistics', 'excise act, large consumers', 'pack:zz')`);
    expect(await parameterOf('participant', village, 'electricity_excise')).toMatchObject({ value: 20 });
    await db.query(`select set_attribute('participant', $1, 'annual_consumption', '2000000'::jsonb, null, null, 'bills')`, [village]);
    expect(await parameterOf('participant', village, 'electricity_excise')).toMatchObject({
      value: 10, conditions: { segment: 'professional', attribute: { attribute_type: 'annual_consumption', op: '>=', value: 1000000 } },
    });
    const facts = (await one<{ f: Record<string, unknown> }>(db, `select condition_facts('participant', $1, '2026-06-01') f`, [village])).f;
    expect(facts).toMatchObject({ object_kind: 'participant', project_kind: 'energy_community', segment: 'business', density_class: 'rural' });
    expect(await one(db, `select condition_matches('{"attribute": {"attribute_type": "annual_consumption", "op": ">", "value": 1}}', condition_facts('participant', $1)) m`, [town]))
      .toEqual({ m: null });
  });

  it('lists a municipality under its subdivision, coded by the scheme of its country', async () => {
    await expect(db.query(`insert into regions (code, country, name, kind, parent_code, published_by) values ('ZZ-12', 'ZZ', 'Short', 'municipality', 'ZZ-NO', 'pack:zz')`))
      .rejects.toThrow(/invalid_identifier: 12 is not a valid zz_municipality/);
    await expect(db.query(`insert into regions (code, country, name, kind, published_by) values ('ZZ-0003', 'ZZ', 'Orphan', 'municipality', 'pack:zz')`))
      .rejects.toThrow(/regions_code_format/);
    // A place names a subdivision as its region, never a municipality.
    await expect(participant(db, { organisation_id: org, name: 'Misplaced', country: 'ZZ', region: 'ZZ-0001' })).rejects.toThrow(/region_format|region_unknown/);
  });
});
