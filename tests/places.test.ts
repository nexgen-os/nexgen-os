// The one standard shape of a place: a site is created from it, placed
// again from it and read back as it; its time zone comes from the country
// pack when it names none; a building, a roof face and its orientation are
// described by the gestures of the core, each refusal by its name.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, asUser, freshDatabase, one, organisation } from './helpers/db.js';

let db: PGlite;
let org: string;

const place = {
  street: 'Harbour Street 12',
  address_extra: 'Unit 3',
  postal_code: '1000',
  city: 'Port Town',
  region: 'ZZ-NO',
  country: 'ZZ',
  geometry: { type: 'Point', coordinates: [4.35247, 50.84673, 0] },
  location_precision: 'rooftop',
  location_source_code: 'nominatim',
  identifiers: [{ scheme: 'osm', value: 'node/42' }],
};

beforeAll(async () => {
  db = await freshDatabase(['building']);
  org = await organisation(db, 'A firm', USER_A);
  // What a country pack publishes: a country, two regions, one of them in
  // another time zone.
  await db.query(`insert into countries (code, name, currency, languages, time_zones, region_level, pack_version, published_by)
                  values ('ZZ', 'Testland', 'ZZZ', '{en}', '{Europe/Brussels,Atlantic/Azores}', 'region', '0.1.0', 'pack:zz')`);
  await db.query(`insert into regions (code, country, name, time_zone, published_by) values
                    ('ZZ-NO', 'ZZ', 'North', null, 'pack:zz'), ('ZZ-IS', 'ZZ', 'Islands', 'Atlantic/Azores', 'pack:zz')`);
});

afterAll(async () => {
  await db.close();
});

describe('a site from the standard shape of a place', () => {
  let site: string;

  it('is created with its address, its point, its precision, its source and its identifiers, under row level security', async () => {
    site = (await asUser(db, USER_A, () => one<{ id: string }>(db, `select create_site($1, 'Office', $2) id`, [org, place]))).id;
    const back = await one<{ p: typeof place }>(db, 'select place_of($1) p', [site]);
    expect(back.p).toEqual(place);
  });

  it('takes the first time zone of its country, or its region\'s, when it names none', async () => {
    await db.query(`select create_site($1, 'North', $2)`, [org, { country: 'ZZ', region: 'ZZ-NO' }]);
    await db.query(`select create_site($1, 'Island', $2)`, [org, { country: 'ZZ', region: 'ZZ-IS' }]);
    const r = await db.query<{ name: string; time_zone: string }>(`select name, time_zone from sites where name in ('North', 'Island') order by name`);
    expect(r.rows).toEqual([{ name: 'Island', time_zone: 'Atlantic/Azores' }, { name: 'North', time_zone: 'Europe/Brussels' }]);
    const nowhere = await one<{ id: string }>(db, `select create_site($1, 'Nowhere known', '{"country": "QQ"}') id`, [org]);
    const elsewhere = await one<{ time_zone: string | null }>(db, 'select time_zone from sites where id = $1', [nowhere.id]);
    expect(elsewhere.time_zone).toBeNull();
  });

  it('refuses a place without a country, a country that is not a code, a zone or a region nobody knows, and a key of another shape', async () => {
    await expect(db.query(`select create_site($1, 'X', '{"city": "Port Town"}')`, [org])).rejects.toThrow(/country_required/);
    await expect(db.query(`select create_site($1, 'X', '{"country": "Testland"}')`, [org])).rejects.toThrow(/country_invalid/);
    await expect(db.query(`select create_site($1, 'X', '{"country": "ZZ"}', 'Europe/Atlantis')`, [org])).rejects.toThrow(/time_zone_unknown/);
    await expect(db.query(`select create_site($1, 'X', '{"country": "ZZ", "region": "ZZ-SO"}')`, [org])).rejects.toThrow(/region_unknown/);
    await expect(db.query(`select create_site($1, 'X', '{"country": "ZZ", "municipality_code": "123"}')`, [org])).rejects.toThrow(/place_key_unknown: municipality_code/);
    await expect(db.query(`select create_site($1, 'X', '{"country": "ZZ", "region": "QQ-NO"}')`, [org])).rejects.toThrow(/sites_region_format/);
  });

  it('is placed again by a geocoder: the keys given replace, the others stay, the country never moves', async () => {
    await db.query(`select locate_site($1, $2)`, [site, {
      geometry: { type: 'Point', coordinates: [4.3525, 50.8468, 0] }, location_precision: 'parcel', location_source_code: 'photon',
      identifiers: [{ scheme: 'osm', value: 'way/7' }],
    }]);
    const p = (await one<{ p: typeof place }>(db, 'select place_of($1) p', [site])).p;
    expect(p).toMatchObject({ street: 'Harbour Street 12', location_precision: 'parcel', location_source_code: 'photon' });
    expect(p.identifiers).toEqual([{ scheme: 'osm', value: 'node/42' }, { scheme: 'osm', value: 'way/7' }]);
    await expect(db.query(`select locate_site($1, '{"country": "QQ"}')`, [site])).rejects.toThrow(/country_is_final/);
  });
});

describe('a building and its roof, by the gestures of the core', () => {
  it('derives the orientation of a roof face from its 3D polygon: 30° tilted, facing south', async () => {
    const site = (await one<{ id: string }>(db, `select create_site($1, 'House', '{"country": "ZZ"}') id`, [org])).id;
    const house = (await one<{ id: string }>(db, `select building.add_building($1, 'House', null, 12, 7.5, 'residential') id`, [site])).id;
    // A 10 m wide face rising 5 m over 8.66 m towards the north: it faces south at 30°.
    const roof = (await one<{ id: string }>(
      db,
      `select building.add_surface($1, 'roof', 'South face', ST_Transform(ST_SetSRID(ST_GeomFromText(
         'POLYGON Z((600000 5600000 10, 600010 5600000 10, 600010 5600008.66 15, 600000 5600008.66 15, 600000 5600000 10))'), 32631), 4326)) id`,
      [house],
    )).id;
    const r = await one<{ azimuth: number; tilt: number; building: string }>(db, "select azimuth_deg::float azimuth, tilt_deg::float tilt, building.building_of('surface', id) building from building.surfaces where id = $1", [roof]);
    expect(r.tilt).toBeCloseTo(30, 0);
    expect(r.azimuth).toBeGreaterThan(178);
    expect(r.azimuth).toBeLessThan(182);
    expect(r.building).toBe(house);
  });

  it('refuses a roof face with neither orientation nor shape, and a surface on a device', async () => {
    const site = (await one<{ id: string }>(db, `select create_site($1, 'Barn', '{"country": "ZZ"}') id`, [org])).id;
    const barn = (await one<{ id: string }>(db, `select building.add_building($1, 'Barn') id`, [site])).id;
    await expect(db.query(`select building.add_surface($1, 'roof', 'Somewhere up')`, [barn])).rejects.toThrow(/orientation_unknown/);
    const flat = await one<{ id: string }>(db, `select building.add_surface($1, 'ground', 'Yard') id`, [site]);
    expect(flat.id).toBeTruthy();
    const device = (await one<{ id: string }>(db, `select install_device($1, 'battery', 'Battery') id`, [site])).id;
    await expect(db.query(`select building.add_surface($1, 'roof', 'On a battery', null, 180, 30)`, [device])).rejects.toThrow(/surface_host_kind/);
  });

  it('creates a variant on top of another, and refuses a parent of another organisation', async () => {
    const a = (await one<{ id: string }>(db, `select create_scenario($1, 'Insulate') id`, [org])).id;
    const b = (await one<{ id: string }>(db, `select create_scenario($1, 'Insulate and a heat pump', $2) id`, [org, a])).id;
    expect((await one<{ parent: string }>(db, 'select parent_id parent from scenarios where id = $1', [b])).parent).toBe(a);
    const other = await organisation(db, 'Another firm', USER_A);
    await expect(db.query(`select create_scenario($1, 'Borrowed', $2)`, [other, a])).rejects.toThrow(/scenario_not_found/);
  });
});
