// The core lives in its own schema, `nexgen`, so that `public` stays the
// installation's and another application can share the database. Every
// function finds its tables whatever the caller's search path.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, freshDatabase, one, organisation } from './helpers/db.js';

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase(['architecture']);
});

afterAll(async () => {
  await db.close();
});

describe('the nexgen schema', () => {
  it('holds every core table and function, and public holds none of them', async () => {
    const tables = await db.query<{ table_schema: string; n: number }>(
      `select table_schema, count(*)::int n from information_schema.tables
        where table_name in ('organisations', 'sites', 'buildings', 'devices', 'series', 'series_values', 'objects', 'modules')
        group by 1 order by 1`,
    );
    expect(tables.rows).toEqual([{ table_schema: 'nexgen', n: 8 }]);
    const fns = await db.query<{ schema: string; name: string }>(
      `select n.nspname schema, p.proname name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.proname in ('site_of', 'resample', 'register_object', 'building_volume', 'secure_table') order by 2, 1`,
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
  it('finds the site of a space and of a PV array when both modules are installed, without a module rewriting it', async () => {
    const both = await freshDatabase(['architecture', 'solar']);
    try {
      const org = await organisation(both, 'Both', USER_A);
      const site = await one<{ id: string }>(both, `insert into sites (organisation_id, name, country) values ($1, 'Campus', 'BE') returning id`, [org]);
      const building = await one<{ id: string }>(both, `insert into buildings (organisation_id, site_id, name) values ($1, $2, 'Lab') returning id`, [org, site.id]);
      const floor = await one<{ id: string }>(both, `insert into architecture.floors (organisation_id, building_id, name, level) values ($1, $2, 'Ground', 0) returning id`, [org, building.id]);
      const space = await one<{ id: string }>(both, `insert into architecture.spaces (organisation_id, floor_id, name, kind) values ($1, $2, 'Room 1', 'room') returning id`, [org, floor.id]);
      const device = await one<{ id: string }>(both, `insert into devices (organisation_id, site_id, building_id, name, device_type) values ($1, $2, $3, 'PV', 'solar') returning id`, [org, site.id, building.id]);
      await both.query('insert into solar.pv_systems (id, kwp_dc) values ($1, 10)', [device.id]);
      const array = await one<{ id: string }>(both, `insert into solar.pv_arrays (organisation_id, pv_system_id, name, azimuth_deg, tilt_deg, mounting, kwp_dc) values ($1, $2, 'A', 180, 30, 'roof_parallel', 10) returning id`, [org, device.id]);
      const sensor = await one<{ id: string }>(both, `insert into sensors (organisation_id, host_id, name, quantity_code, kind) values ($1, $2, 'T', 'temperature', 'sensor') returning id`, [org, space.id]);
      const r = await both.query<{ what: string; site: string }>(
        `select 'space' what, site_of($1) site union all select 'pv_array', site_of($2) union all select 'sensor in a room', site_of($3) union all select 'floor', site_of($4)`,
        [space.id, array.id, sensor.id, floor.id],
      );
      expect(r.rows.map((x) => [x.what, x.site === site.id])).toEqual([['space', true], ['pv_array', true], ['sensor in a room', true], ['floor', true]]);
      const kinds = await both.query<{ kind: string; published_by: string }>(`select kind, published_by from object_kinds where kind in ('space', 'pv_array', 'weather_point', 'device') order by kind`);
      expect(kinds.rows).toEqual([{ kind: 'device', published_by: 'core' }, { kind: 'pv_array', published_by: 'solar' }, { kind: 'space', published_by: 'architecture' }]);
    } finally {
      await both.close();
    }
  });
});
