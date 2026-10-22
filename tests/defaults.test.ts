// One resolution of a parameter, in one order for every property: the
// object's own attribute, its parents' nearest first, its organisation's
// (an attribute, since an organisation is an object), its region's, the
// regions it is part of nearest first, its country's — and nothing else: a value nobody decided is
// refused by name, never guessed. Pack values are dated and cited.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, USER_B, asUser, freshDatabase, insert, one, organisation, participant } from './helpers/db.js';

let db: PGlite;
let org: string;
let site: string;
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

const parameterOf = async (kind: string, object: string, property: string, at = '2026-06-01') =>
  (await one<{ p: Parameter }>(db, 'select parameter_of($1, $2, $3, $4) p', [kind, object, property, at])).p;

beforeAll(async () => {
  db = await freshDatabase();
  org = await organisation(db, 'A developer', USER_A);
  await organisation(db, 'A neighbour', USER_B);
  // A pack: a country, a region, its statistics office, two properties it decides.
  await db.query(`insert into countries (code, name, currency, time_zones, region_level, pack_version, published_by) values ('ZZ', 'Testland', 'ZZZ', '{UTC}', 'region', '0.1.0', 'pack:zz')`);
  await db.query(`insert into regions (code, country, name, published_by) values ('ZZ-NO', 'ZZ', 'North', 'pack:zz'), ('ZZ-SO', 'ZZ', 'South', 'pack:zz')`);
  await db.query(`insert into sources (code, name, kind, base_url, published_by) values ('zz_statistics', 'Testland statistics office', 'text', 'https://statistics.example/', 'pack:zz')`);
  // The properties come from the core vocabulary: what a pack cites is defined there.
  await db.query(`insert into defaults (property_code, country, region, value, valid_from, valid_to, source_code, reference, published_by) values
                    ('pv_specific_yield_fallback', 'ZZ', null, '950', '2020-01-01', '2026-01-01', 'zz_statistics', 'yearbook 2019, table 4', 'pack:zz'),
                    ('pv_specific_yield_fallback', 'ZZ', null, '980', '2026-01-01', null, 'zz_statistics', 'yearbook 2025, table 4', 'pack:zz'),
                    ('pv_specific_yield_fallback', 'ZZ', 'ZZ-SO', '1150', '2020-01-01', null, 'zz_statistics', 'yearbook 2025, table 5', 'pack:zz'),
                    ('offpeak_hours', 'ZZ', null, null, null, null, 'zz_statistics', 'depends on the supply contract', 'pack:zz')`);
  site = await participant(db, { organisation_id: org, name: 'Farm', country: 'ZZ', region: 'ZZ-NO' });
  device = await insert(db, 'devices', { organisation_id: org, participant_id: site, name: 'Array', device_type: 'solar' });
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

  it('climbs from the region to the region it is part of before the country: a value decided above holds below without a copy', async () => {
    // Two levels, as a pack listing departments under their regions does.
    await db.query(`insert into regions (code, country, name, published_by) values ('ZZ-E', 'ZZ', 'East', 'pack:zz')`);
    await db.query(`insert into regions (code, country, name, parent, published_by) values ('ZZ-E1', 'ZZ', 'East One', 'ZZ-E', 'pack:zz'), ('ZZ-E2', 'ZZ', 'East Two', 'ZZ-E', 'pack:zz')`);
    await db.query(`insert into defaults (property_code, country, region, value, valid_from, source_code, reference, published_by) values
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
    await db.query(`insert into regions (code, country, name, parent, published_by) values ('ZZ-W1', 'ZZ', 'West One', 'ZZ-W', 'pack:zz')`);
    await db.query(`update regions set parent = 'ZZ-W1' where code = 'ZZ-W'`);
    const west = await participant(db, { organisation_id: org, name: 'Dairy', country: 'ZZ', region: 'ZZ-W1' });
    expect(await parameterOf('participant', west, 'pv_specific_yield_fallback')).toMatchObject({ value: 980, level: 'country', country: 'ZZ' });
  });

  it('reads the organisation before its region: an attribute of the organisation, which is an object', async () => {
    await asUser(db, USER_A, () => db.query(`select set_attribute('organisation', $1, 'pv_specific_yield_fallback', '1010', null, null, 'board decision')`, [org]));
    expect(await parameterOf('device', device, 'pv_specific_yield_fallback')).toMatchObject({ value: 1010, level: 'organisation', object_id: org, reference: 'board decision' });
    expect(await parameterOf('organisation', org, 'pv_specific_yield_fallback')).toMatchObject({ value: 1010, level: 'object' });
  });

  it('reads the parents of the object nearest first, then the object itself', async () => {
    await db.query(`select set_attribute('participant', $1, 'pv_specific_yield_fallback', '1020', null, 'zz_statistics', 'site survey')`, [site]);
    expect(await parameterOf('device', device, 'pv_specific_yield_fallback')).toMatchObject({ value: 1020, level: 'participant', object_id: site, source_code: 'zz_statistics' });
    await db.query(`select set_attribute('device', $1, 'pv_specific_yield_fallback', '1040', null, null, 'monitoring')`, [device]);
    expect(await parameterOf('device', device, 'pv_specific_yield_fallback')).toMatchObject({ value: 1040, level: 'object', object_id: device });
  });

  it('refuses by name what nobody decided, saying the level it reached; and gives the reference of a country that decides no single value', async () => {
    await expect(parameterOf('device', device, 'vat_rate_electricity')).rejects.toThrow(/parameter_missing: vat_rate_electricity for .*, reached country ZZ/);
    await expect(parameterOf('organisation', org, 'vat_rate_electricity')).rejects.toThrow(/parameter_missing: vat_rate_electricity for .*, reached organisation/);
    await expect(parameterOf('device', device, 'offpeak_hours')).rejects.toThrow(/parameter_not_decided: offpeak_hours in ZZ: depends on the supply contract/);
    await expect(parameterOf('device', device, 'no_such_property')).rejects.toThrow(/property_unknown/);
  });
});

describe('the defaults of a pack', () => {
  it('check their value and their period, cite a source, and hold in a region of their country', async () => {
    await expect(db.query(`insert into defaults (property_code, country, value, source_code, published_by) values ('vat_rate_electricity', 'ZZ', '"high"', 'zz_statistics', 'pack:zz')`))
      .rejects.toThrow(/invalid_value/);
    await expect(db.query(`insert into defaults (property_code, country, value, valid_from, source_code, published_by) values ('pv_specific_yield_fallback', 'ZZ', '990', '2025-06-01', 'zz_statistics', 'pack:zz')`))
      .rejects.toThrow(/overlapping_value/);
    await expect(db.query(`insert into defaults (property_code, country, value, published_by) values ('vat_rate_electricity', 'ZZ', '0.2', 'pack:zz')`))
      .rejects.toThrow(/source_code/);
    await expect(db.query(`insert into defaults (property_code, country, region, value, source_code, published_by) values ('vat_rate_electricity', 'ZZ', 'ZZ-XX', '0.2', 'zz_statistics', 'pack:zz')`))
      .rejects.toThrow(/foreign key/);
    await expect(db.query(`insert into defaults (property_code, value, source_code, published_by) values ('vat_rate_electricity', '0.2', 'zz_statistics', 'pack:zz')`))
      .rejects.toThrow(/country/);
  });

  it('are never edited: a period is closed and a new row added', async () => {
    await expect(db.query(`update defaults set value = '990' where property_code = 'pv_specific_yield_fallback' and region is null and valid_from = '2026-01-01'`))
      .rejects.toThrow(/value_edited: pv_specific_yield_fallback from 2026-01-01 holds 980/);
    await db.query(`update defaults set valid_to = '2027-01-01', reference = 'yearbook 2025, table 4, revised' where property_code = 'pv_specific_yield_fallback' and region is null and valid_from = '2026-01-01'`);
    await db.query(`insert into defaults (property_code, country, value, valid_from, source_code, reference, published_by) values ('pv_specific_yield_fallback', 'ZZ', '990', '2027-01-01', 'zz_statistics', 'yearbook 2026, table 4', 'pack:zz')`);
    const rows = await db.query<{ value: number; valid_to: string | null }>(
      `select value, valid_to::text from defaults where property_code = 'pv_specific_yield_fallback' and region is null order by valid_from`);
    expect(rows.rows).toEqual([{ value: 950, valid_to: '2026-01-01' }, { value: 980, valid_to: '2027-01-01' }, { value: 990, valid_to: null }]);
  });

  it('record which version of the pack the installation holds, and its checksum', async () => {
    await expect(db.query(`update countries set pack_checksum = 'md5:abc' where code = 'ZZ'`)).rejects.toThrow(/countries_checksum_format/);
    await db.query(`update countries set pack_checksum = $1 where code = 'ZZ'`, ['sha256:' + 'a'.repeat(64)]);
    const c = await one<{ pack_checksum: string; pack_version: string }>(db, `select pack_checksum, pack_version from countries where code = 'ZZ'`);
    expect(c).toEqual({ pack_checksum: 'sha256:' + 'a'.repeat(64), pack_version: '0.1.0' });
  });
});
