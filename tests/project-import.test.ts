// A project described as data becomes rows through the gestures of the core,
// and the same description written again finds what is there.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, USER_B, asUser, freshDatabase, one, organisation } from './helpers/db.js';
import { importProject, type ProjectDescription } from '@nexgen-os/core';

let db: PGlite;
let org: string;

const PLACE = {
  address_line1: '12 rue Garibaldi', postal_code: '69003', city: 'Lyon', country: 'FR',
  geometry: { type: 'Point', coordinates: [4.8522, 45.7597, 0] }, location_precision: 'rooftop',
};

const description = (): ProjectDescription => ({
  name: 'Garibaldi community',
  country: 'FR',
  identifiers: [{ scheme: 'wikidata', value: 'Q90' }],
  participants: [
    {
      name: 'School',
      category: 'prosumer',
      time_zone: 'Europe/Paris',
      place: PLACE,
      identifiers: [{ scheme: 'osm', value: 'way/123456' }],
      meters: [{ identifier: '541448000000000017', scheme: 'gs1_gsrn', direction: 'both' }],
      devices: [{ device_type: 'inverter', name: 'Roof inverter', rated_power_kw: 36 }],
    },
    {
      name: 'Bakery',
      time_zone: 'Europe/Paris',
      place: { ...PLACE, address_line1: '14 rue Garibaldi' },
      meters: [{ identifier: '541448000000000024', scheme: 'gs1_gsrn', direction: 'offtake' }],
    },
  ],
});

const count = async (table: string) => (await one<{ n: number }>(db, `select count(*)::int n from ${table}`)).n;

beforeAll(async () => {
  db = await freshDatabase();
  org = await organisation(db, 'Community operator');
});

afterAll(async () => {
  await db.close();
});

describe('a project imported from its description', () => {
  it('writes nothing on a dry run, and says what it would create', async () => {
    const plan = await asUser(db, USER_A, () => importProject(db, org, description(), { dryRun: true }));
    expect(plan.dry_run).toBe(true);
    expect(plan.project_id).toBeNull();
    expect(plan.counts).toEqual({
      project: { found: 0, created: 1 }, participant: { found: 0, created: 2 },
      meter: { found: 0, created: 2 }, device: { found: 0, created: 1 },
    });
    expect(plan.objects.every((o) => o.outcome === 'to_create' && o.id === null)).toBe(true);
    expect(await count('projects')).toBe(0);
  });

  it('creates the project, its participants, meters, devices and identifiers through the gestures', async () => {
    const done = await asUser(db, USER_A, () => importProject(db, org, description()));
    expect(done.counts.participant).toEqual({ found: 0, created: 2 });
    const school = done.objects.find((o) => o.path === 'participants[0]')!;
    expect(await one(db, 'select name, category, time_zone, country, project_id from participants where id = $1', [school.id]))
      .toEqual({ name: 'School', category: 'prosumer', time_zone: 'Europe/Paris', country: 'FR', project_id: done.project_id });
    expect(await one(db, 'select participant_id, direction from meters where identifier = $1', ['541448000000000017']))
      .toEqual({ participant_id: school.id, direction: 'both' });
    expect(await one(db, `select participant_id, device_type, rated_power_kw::float8 kw from devices where name = 'Roof inverter'`))
      .toEqual({ participant_id: school.id, device_type: 'inverter', kw: 36 });
    expect((await db.query(`select object_kind, scheme, value from identifiers order by scheme`)).rows).toEqual([
      { object_kind: 'participant', scheme: 'osm', value: 'way/123456' },
      { object_kind: 'project', scheme: 'wikidata', value: 'Q90' },
    ]);
  });

  it('written again, finds every object and creates none', async () => {
    const again = await asUser(db, USER_A, () => importProject(db, org, description()));
    expect(Object.values(again.counts).every((c) => c.created === 0)).toBe(true);
    expect([await count('projects'), await count('participants'), await count('meters'), await count('devices')]).toEqual([1, 2, 2, 1]);
  });

  it('finds a renamed project by its identifier, and adds what is new under it', async () => {
    const renamed = description();
    renamed.name = 'Garibaldi energy community';
    renamed.participants![1]!.devices = [{ device_type: 'battery', name: 'Cellar battery', rated_power_kw: 5 }];
    renamed.participants![1]!.identifiers = [{ scheme: 'osm', value: 'way/654321' }];
    const r = await asUser(db, USER_A, () => importProject(db, org, renamed));
    expect(r.counts).toEqual({
      project: { found: 1, created: 0 }, participant: { found: 2, created: 0 },
      meter: { found: 2, created: 0 }, device: { found: 1, created: 1 },
    });
    expect(r.objects.find((o) => o.path === 'participants[1]')!.identifiers_added).toEqual([{ scheme: 'osm', value: 'way/654321' }]);
    expect(await count('projects')).toBe(1);
    expect(await count('identifiers')).toBe(3);
  });

  it('refuses a description without a country or a meter without its scheme, before writing anything', async () => {
    await expect(importProject(db, org, { ...description(), country: '' })).rejects.toThrow(/^country_required: project/);
    const noScheme = description();
    noScheme.name = 'Another';
    noScheme.participants![0]!.meters = [{ identifier: '541448000000000031', scheme: '' }];
    await expect(asUser(db, USER_A, () => importProject(db, org, noScheme))).rejects.toThrow(/^scheme_required: participants\[0\]\.meters\[0\]/);
    expect(await count('projects')).toBe(1);
  });

  it('refuses identifiers that name two different objects', async () => {
    const mixed = description();
    mixed.participants![0]!.identifiers = [{ scheme: 'osm', value: 'way/123456' }, { scheme: 'osm', value: 'way/654321' }];
    await expect(asUser(db, USER_A, () => importProject(db, org, mixed))).rejects.toThrow(/^identifiers_disagree: the identifiers of participants\[0\]/);
  });

  it('refuses a meter another participant of the project carries', async () => {
    const moved = description();
    moved.participants![1]!.meters = [{ identifier: '541448000000000017', scheme: 'gs1_gsrn' }];
    await expect(asUser(db, USER_A, () => importProject(db, org, moved))).rejects.toThrow(/^meter_carried_elsewhere: gs1_gsrn 541448000000000017 of participants\[1\]/);
  });

  it('writes only where the person may: row level security decides', async () => {
    await db.query('insert into auth.users (id) values ($1) on conflict do nothing', [USER_B]);
    await expect(asUser(db, USER_B, () => importProject(db, org, { name: 'Elsewhere', country: 'FR' }))).rejects.toThrow();
    expect(await count('projects')).toBe(1);
  });
});
