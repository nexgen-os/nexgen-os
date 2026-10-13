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
