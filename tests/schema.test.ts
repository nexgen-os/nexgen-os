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
        where table_name in ('organisations', 'participants', 'meters', 'devices', 'series', 'series_values', 'kinds', 'modules')
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
      const site = await one<{ id: string }>(
        db,
        `insert into nexgen.participants (organisation_id, project_id, name, country, time_zone) values ($1, $2, 'Shed', 'FR', 'Europe/Paris') returning id`,
        [org, project.id],
      );
      const found = await one<{ organisation: string; country: string }>(
        db,
        `select nexgen.object_organisation('participant', $1) organisation, nexgen.country_of('participant', $1) country`,
        [site.id],
      );
      expect(found).toEqual({ organisation: org, country: 'FR' });
      await expect(db.query('select 1 from participants')).rejects.toThrow(/relation "participants" does not exist/);
    } finally {
      await db.exec('set search_path = nexgen, public');
    }
  });
});

describe('participant_of across modules', () => {
  it('finds the participant and the building of a room, a series in it and a PV array of the solar module, each module answering for its kinds', async () => {
    const both = await freshDatabase(['building', 'solar']);
    try {
      const org = await organisation(both, 'Both', USER_A);
      const project = await one<{ id: string }>(both, `insert into projects (organisation_id, name, country) values ($1, 'Campus', 'BE') returning id`, [org]);
      const campus = await one<{ id: string }>(both, `select join_project($1, 'Campus', '{"country": "BE"}') id`, [project.id]);
      const building = await one<{ id: string }>(both, `insert into building.buildings (organisation_id, participant_id, name) values ($1, $2, 'Lab') returning id`, [org, campus.id]);
      const floor = await one<{ id: string }>(both, `select building.add_space($1, 'floor', 'Ground', null, 0) id`, [building.id]);
      const space = await one<{ id: string }>(both, `select building.add_space($1, 'room', 'Room 1', $2) id`, [building.id, floor.id]);
      const device = await one<{ id: string }>(both, `insert into devices (organisation_id, participant_id, name, device_type) values ($1, $2, 'PV', 'solar') returning id`, [org, campus.id]);
      await both.query('insert into solar.pv_systems (id, kwp_dc) values ($1, 10)', [device.id]);
      const array = await one<{ id: string }>(both, `insert into solar.pv_arrays (organisation_id, pv_system_id, name, azimuth_deg, tilt_deg, mounting, kwp_dc) values ($1, $2, 'A', 180, 30, 'roof_parallel', 10) returning id`, [org, device.id]);
      const probe = await one<{ id: string }>(both, `select install_device($1, 'sensor', 'Thermometer') id`, [campus.id]);
      const series = await one<{ id: string }>(both, `select series_ensure('space', $1, 'temperature', 'measured', 'instant', '10 minutes', $2) id`, [space.id, probe.id]);
      const r = await both.query<{ what: string; participant: string; building: string | null }>(
        `select 'space' what, participant_of('space', $1) participant, building.building_of('space', $1) building
         union all select 'pv_array', participant_of('pv_array', $2), null
         union all select 'device', participant_of('device', $3), null
         union all select 'floor', participant_of('space', $4), building.building_of('space', $4)
         union all select 'series', participant_of('series', $5), building.building_of('space', $1)`,
        [space.id, array.id, probe.id, floor.id, series.id],
      );
      expect(r.rows.map((x) => [x.what, x.participant === campus.id, x.building === null ? null : x.building === building.id])).toEqual([
        ['space', true, true], ['pv_array', true, null], ['device', true, null], ['floor', true, true], ['series', true, true],
      ]);
      const kinds = await both.query<{ kind: string; published_by: string }>(`select kind, published_by from kinds where kind in ('site', 'space', 'pv_array', 'weather_point', 'device', 'participant') order by kind`);
      expect(kinds.rows).toEqual([
        { kind: 'device', published_by: 'core' }, { kind: 'participant', published_by: 'core' },
        { kind: 'pv_array', published_by: 'solar' }, { kind: 'site', published_by: 'building' }, { kind: 'space', published_by: 'building' },
      ]);
    } finally {
      await both.close();
    }
  });
});
