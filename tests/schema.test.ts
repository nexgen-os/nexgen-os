// The core lives in its own schema, `nexgen`, so that `public` stays the
// installation's and another application can share the database. Every
// function finds its tables whatever the caller's search path.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, freshDatabase, one, organisation } from './helpers/db.js';

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase();
});

afterAll(async () => {
  await db.close();
});

describe('the nexgen schema', () => {
  it('holds every core table and function, and public holds none of them', async () => {
    const tables = await db.query<{ table_schema: string; n: number }>(
      `select table_schema, count(*)::int n from information_schema.tables
        where table_name in ('organisations', 'sites', 'meters', 'devices', 'series', 'series_values', 'objects', 'modules')
        group by 1 order by 1`,
    );
    expect(tables.rows).toEqual([{ table_schema: 'nexgen', n: 8 }]);
    const fns = await db.query<{ schema: string; name: string }>(
      `select n.nspname schema, p.proname name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.proname in ('site_of', 'resample', 'register_object', 'declare_object', 'secure_table') order by 2, 1`,
    );
    expect(fns.rows.map((r) => r.schema)).toEqual(['nexgen', 'nexgen', 'nexgen', 'nexgen', 'nexgen']);
  });

  it('works from a session whose search path is public only', async () => {
    const org = await organisation(db, 'Elsewhere', USER_A);
    await db.exec('set search_path = public');
    try {
      const site = await one<{ id: string }>(
        db,
        `insert into nexgen.sites (organisation_id, name, country, time_zone) values ($1, 'Shed', 'FR', 'Europe/Paris') returning id`,
        [org],
      );
      const registered = await one<{ kind: string; country: string }>(
        db,
        `select o.kind, nexgen.country_of($1) country from nexgen.objects o where o.id = $1`,
        [site.id],
      );
      expect(registered).toEqual({ kind: 'site', country: 'FR' });
      await expect(db.query('select 1 from sites')).rejects.toThrow(/relation "sites" does not exist/);
    } finally {
      await db.exec('set search_path = nexgen, public');
    }
  });
});

describe('site_of across modules', () => {
  it('finds the site and the building of a room, a series in it and a PV array of the solar module, without a module rewriting it', async () => {
    const both = await freshDatabase(['3d', 'solar']);
    try {
      const org = await organisation(both, 'Both', USER_A);
      const site = await one<{ id: string }>(both, `insert into sites (organisation_id, name, country) values ($1, 'Campus', 'BE') returning id`, [org]);
      const building = await one<{ id: string }>(both, `insert into three_d.buildings (organisation_id, site_id, name) values ($1, $2, 'Lab') returning id`, [org, site.id]);
      const floor = await one<{ id: string }>(both, `select three_d.add_space($1, 'floor', 'Ground', null, 0) id`, [building.id]);
      const space = await one<{ id: string }>(both, `select three_d.add_space($1, 'room', 'Room 1', $2) id`, [building.id, floor.id]);
      const device = await one<{ id: string }>(both, `insert into devices (organisation_id, site_id, name, device_type) values ($1, $2, 'PV', 'solar') returning id`, [org, site.id]);
      await both.query('select three_d.place_device($1, $2)', [device.id, building.id]);
      await both.query('insert into solar.pv_systems (id, kwp_dc) values ($1, 10)', [device.id]);
      const array = await one<{ id: string }>(both, `insert into solar.pv_arrays (organisation_id, pv_system_id, name, azimuth_deg, tilt_deg, mounting, kwp_dc) values ($1, $2, 'A', 180, 30, 'roof_parallel', 10) returning id`, [org, device.id]);
      const probe = await one<{ id: string }>(both, `select install_device($1, 'sensor', 'Thermometer') id`, [site.id]);
      await both.query('select three_d.place_device($1, p_space_id => $2)', [probe.id, space.id]);
      const series = await one<{ id: string }>(both, `select series_ensure($1, 'temperature', 'measured', 'instant', '10 minutes', $2) id`, [space.id, probe.id]);
      const r = await both.query<{ what: string; site: string; building: string | null }>(
        `select 'space' what, site_of($1) site, three_d.building_of($1) building
         union all select 'pv_array', site_of($2), three_d.building_of($2)
         union all select 'device in a room', site_of($3), three_d.building_of($3)
         union all select 'floor', site_of($4), three_d.building_of($4)`,
        [space.id, array.id, probe.id, floor.id],
      );
      expect(r.rows.map((x) => [x.what, x.site === site.id, x.building === building.id])).toEqual([
        ['space', true, true], ['pv_array', true, true], ['device in a room', true, true], ['floor', true, true],
      ]);
      const observed = await one<{ site: string; building: string }>(
        both, `select site_of(object_id) site, (select building_id from three_d.devices where device_id = s.device_id) building from series s where id = $1`, [series.id]);
      expect(observed).toEqual({ site: site.id, building: building.id });
      const kinds = await both.query<{ kind: string; published_by: string }>(`select kind, published_by from object_kinds where kind in ('space', 'pv_array', 'weather_point', 'device', 'organisation') order by kind`);
      expect(kinds.rows).toEqual([
        { kind: 'device', published_by: 'core' }, { kind: 'organisation', published_by: 'core' },
        { kind: 'pv_array', published_by: 'solar' }, { kind: 'space', published_by: '3d' },
      ]);
    } finally {
      await both.close();
    }
  });
});
