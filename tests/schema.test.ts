// The core lives in its own schema, `nexgen`, so that `public` stays the
// installation's and another application can share the database. Every
// function finds its tables whatever the caller's search path.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, asUser, freshDatabase, one, organisation, shippedModules } from './helpers/db.js';

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
  'api_keys', 'attribute_types', 'attributes', 'capabilities', 'connectors', 'contacts', 'countries', 'currencies', 'defaults', 'device_types',
  'devices', 'documents', 'forecast_values', 'identifier_schemes', 'identifiers', 'invitations', 'meters', 'modules',
  'organisation_members', 'organisations', 'participants', 'products', 'project_kinds', 'project_shares', 'projects', 'quantities', 'regions', 'role_capabilities',
  'schema_migrations', 'segments', 'series', 'series_rollups', 'series_values', 'sizing_criteria', 'sources', 'units',
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
    for (const table of ['attributes', 'identifiers', 'documents', 'series']) {
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

  it('describes a document as Ekwo OS describes an attachment: its size, its checksum and who uploaded it', async () => {
    const org = await organisation(db, 'Attachments', USER_A);
    const id = await asUser(db, USER_A, async () =>
      (await one<{ id: string }>(db,
        `select attach_document('organisation', $1, 'Grid study', 'report', 's3://bucket/grid-study.pdf', 'application/pdf', null, null, null, 48213, 'sha256:9f2c') id`,
        [org])).id);
    expect(await one(db, 'select byte_size::int size, checksum, uploaded_by from documents where id = $1', [id]))
      .toEqual({ size: 48213, checksum: 'sha256:9f2c', uploaded_by: USER_A });
    await expect(db.query(`insert into documents (organisation_id, object_kind, object_id, name, uri, byte_size) values ($1, 'organisation', $1, 'Negative', 's3://y', -1)`, [org]))
      .rejects.toThrow(/documents_size/);
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
      await db.exec('set search_path = nexgen, extensions, public');
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

describe('public stays the installation\'s', () => {
  it('no function of the core or of a module resolves public, and the core grants nothing on it', async () => {
    const all = await freshDatabase(shippedModules);
    try {
      const reach = await all.query<{ f: string }>(
        `select n.nspname || '.' || p.proname f
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = any($1::text[])
            and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%' and c ~ '(^|[=, ])public($|,)')
          order by 1`, [['nexgen', ...shippedModules]]);
      // The functions of the billing module that read Ekwo OS's own tables, under Ekwo's own search path.
      expect(reach.rows.map((r) => r.f)).toEqual([
        'billing.ekwo_identifiers', 'billing.ekwo_line_taxes', 'billing.ekwo_reach', 'billing.ekwo_row_exists', 'billing.ekwo_tax', 'billing.unlinked_keys',
      ]);
      const acl = await one<{ acl: string }>(all, `select coalesce(nspacl::text, '') acl from pg_namespace where nspname = 'public'`);
      expect(acl.acl).not.toMatch(/(authenticated|service_role)=/);
    } finally {
      await all.close();
    }
  });

  it('a public.participants beside the core changes nothing a function reads', async () => {
    await db.exec(`create table public.participants (id uuid primary key, project_id uuid, name text, country char(2), segment text);
                   create table public.attribute_types (code text primary key);`);
    const org = await organisation(db, 'Beside another application');
    const project = await one<{ id: string }>(db, `insert into nexgen.projects (organisation_id, name, country) values ($1, 'Mine', 'BE') returning id`, [org]);
    const p = await one<{ id: string }>(db, `select nexgen.join_project($1, 'Ours', '{"country": "BE"}') id`, [project.id]);
    await db.query(`insert into public.participants (id, project_id, name, country, segment) values ($1, gen_random_uuid(), 'Theirs', 'FR', 'pirate')`, [p.id]);
    await db.exec('set search_path = public, nexgen, extensions');
    try {
      expect(await one(db, `select nexgen.participant_of('participant', $1) p, nexgen.country_of('participant', $1) c`, [p.id])).toEqual({ p: p.id, c: 'BE' });
      expect(await one(db, `select (nexgen.condition_facts('participant', $1))->>'segment' s`, [p.id])).toEqual({ s: 'individual' });
    } finally {
      await db.exec('set search_path = nexgen, extensions, public; drop table public.participants; drop table public.attribute_types');
    }
  });
});
