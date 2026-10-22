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

// The validated list of the core: the six objects and what they need, and
// nothing else (decision 0006). A new table of the core is a decision.
const CORE_TABLES = [
  'attribute_types', 'attributes', 'connectors', 'contacts', 'countries', 'defaults', 'device_types',
  'devices', 'documents', 'external_ids', 'forecast_values', 'id_schemes', 'meters', 'modules',
  'organisation_members', 'organisations', 'participants', 'products', 'projects', 'quantities', 'regions',
  'schema_migrations', 'series', 'series_rollups', 'series_values', 'sources', 'units',
];

describe('the nexgen schema', () => {
  it('holds exactly the validated tables of the core, and series_latest as a view', async () => {
    const tables = await db.query<{ t: string }>(
      `select c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'nexgen' and c.relkind in ('r', 'p') and not c.relispartition order by 1`,
    );
    expect(tables.rows.map((r) => r.t)).toEqual(CORE_TABLES);
    const views = await db.query<{ t: string }>(
      `select c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'nexgen' and c.relkind = 'v' order by 1`,
    );
    expect(views.rows.map((r) => r.t)).toEqual(['series_latest']);
  });

  it('attaches to the six objects of the core, and refuses a seventh kind by its check', async () => {
    const org = await organisation(db, 'Six kinds', USER_A);
    for (const table of ['attributes', 'external_ids', 'documents', 'series']) {
      const check = await one<{ def: string }>(
        db,
        `select pg_get_constraintdef(c.oid) def from pg_constraint c where c.conrelid = $1::regclass and c.conname = $2`,
        [`nexgen.${table}`, `${table}_object_kind`],
      );
      for (const kind of ['organisation', 'project', 'participant', 'meter', 'device', 'series']) expect(check.def).toContain(`'${kind}'`);
    }
    await expect(db.query(
      `insert into attributes (organisation_id, object_kind, object_id, attribute_type, value, source) values ($1, 'building', $1, 'efficiency', '0.9', 'test')`,
      [org],
    )).rejects.toThrow(/attributes_object_kind|kind_unknown/);
    await expect(db.query(`select set_attribute('surface', $1, 'efficiency', '0.9')`, [org])).rejects.toThrow(/kind_unknown: surface/);
    await expect(db.query(
      `insert into documents (organisation_id, object_kind, object_id, name, uri) values ($1, 'figure', $1, 'Report', 's3://x')`,
      [org],
    )).rejects.toThrow(/documents_object_kind|kind_unknown/);
  });

  it('holds every core table and function, and public holds none of them', async () => {
    const tables = await db.query<{ table_schema: string; n: number }>(
      `select table_schema, count(*)::int n from information_schema.tables
        where table_name in ('organisations', 'participants', 'meters', 'devices', 'series', 'series_values', 'documents', 'modules')
        group by 1 order by 1`,
    );
    expect(tables.rows).toEqual([{ table_schema: 'nexgen', n: 8 }]);
    const fns = await db.query<{ schema: string; name: string }>(
      `select n.nspname schema, p.proname name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.proname in ('participant_of', 'resample', 'object_organisation', 'drop_attachments', 'secure_table') order by 2, 1`,
    );
    expect(fns.rows.map((r) => r.schema)).toEqual(['nexgen', 'nexgen', 'nexgen', 'nexgen', 'nexgen']);
  });

  it('works from a session whose search path is public only', async () => {
    const org = await organisation(db, 'Elsewhere', USER_A);
    await db.exec('set search_path = public');
    try {
      const project = await one<{ id: string }>(db, `insert into nexgen.projects (organisation_id, name, country) values ($1, 'Sheds', 'FR') returning id`, [org]);
      const home = await one<{ id: string }>(
        db,
        `insert into nexgen.participants (organisation_id, project_id, name, country, time_zone) values ($1, $2, 'Shed', 'FR', 'Europe/Paris') returning id`,
        [org, project.id],
      );
      const found = await one<{ organisation: string; country: string }>(
        db,
        `select nexgen.object_organisation('participant', $1) organisation, nexgen.country_of('participant', $1) country`,
        [home.id],
      );
      expect(found).toEqual({ organisation: org, country: 'FR' });
      await expect(db.query('select 1 from participants')).rejects.toThrow(/relation "participants" does not exist/);
    } finally {
      await db.exec('set search_path = nexgen, public');
    }
  });
});

describe('participant_of across modules', () => {
  it('finds the participant of the core objects, and the building module answers for its own', async () => {
    const both = await freshDatabase(['building', 'solar']);
    try {
      const org = await organisation(both, 'Both', USER_A);
      const project = await one<{ id: string }>(both, `insert into projects (organisation_id, name, country) values ($1, 'Campus', 'BE') returning id`, [org]);
      const campus = await one<{ id: string }>(both, `select join_project($1, 'Campus', '{"country": "BE"}') id`, [project.id]);
      const building = await one<{ id: string }>(both, `insert into building.buildings (organisation_id, participant_id, name) values ($1, $2, 'Lab') returning id`, [org, campus.id]);
      const floor = await one<{ id: string }>(both, `select building.add_space($1, 'floor', 'Ground', null, 0) id`, [building.id]);
      const space = await one<{ id: string }>(both, `select building.add_space($1, 'room', 'Room 1', $2) id`, [building.id, floor.id]);
      const probe = await one<{ id: string }>(both, `select install_device($1, 'sensor', 'Thermometer') id`, [campus.id]);
      const series = await one<{ id: string }>(both, `select series_ensure('device', $1, 'temperature', 'measured', 'instant', '10 minutes', $1) id`, [probe.id]);
      const r = await both.query<{ what: string; participant: string; building: string | null }>(
        `select 'space' what, building.participant_of('space', $1) participant, building.building_of('space', $1) building
         union all select 'device', participant_of('device', $2), null
         union all select 'floor', building.participant_of('space', $3), building.building_of('space', $3)
         union all select 'series', participant_of('series', $4), null`,
        [space.id, probe.id, floor.id, series.id],
      );
      expect(r.rows.map((x) => [x.what, x.participant === campus.id, x.building === null ? null : x.building === building.id])).toEqual([
        ['space', true, true], ['device', true, null], ['floor', true, true], ['series', true, null],
      ]);
      await expect(both.query(`select participant_of('space', $1)`, [space.id])).rejects.toThrow(/kind_unknown: space/);
    } finally {
      await both.close();
    }
  });
});
