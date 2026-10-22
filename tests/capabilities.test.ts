// Roles resolve into capabilities (decision 0051): each preset can do
// exactly what its role could before capabilities, gesture by gesture, and
// the account of a participant reads its own. A matrix: one row per person,
// one column per gesture.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, asUser, freshDatabase, insert, one, organisation } from './helpers/db.js';

const PEOPLE = {
  owner: USER_A,
  editor: '00000000-0000-4000-8000-0000000000e1',
  viewer: '00000000-0000-4000-8000-0000000000e2',
  shareEditor: '00000000-0000-4000-8000-0000000000e3',
  shareViewer: '00000000-0000-4000-8000-0000000000e4',
  participant: '00000000-0000-4000-8000-0000000000e5',
  stranger: '00000000-0000-4000-8000-0000000000e6',
} as const;
type Person = keyof typeof PEOPLE;

let db: PGlite;
let org: string;
let shared: string;
let other: string;
let member: string;

// Each gesture runs in a transaction rolled back, so that one person's
// success leaves nothing for the next; true when it went through.
async function can(person: Person, sql: string, params: unknown[] = []): Promise<boolean> {
  await db.exec('begin');
  try {
    return await asUser(db, PEOPLE[person], async () => {
      const r = await db.query(sql, params);
      return r.rows.length > 0 || (r.affectedRows ?? 0) > 0;
    });
  } catch {
    return false;
  } finally {
    await db.exec('rollback');
  }
}

const GESTURES: Record<string, () => [string, unknown[]]> = {
  'reads the organisation': () => ['select id from organisations where id = $1', [org]],
  'reads the shared project': () => ['select id from projects where id = $1', [shared]],
  'reads the other project': () => ['select id from projects where id = $1', [other]],
  'reads the participant': () => ['select id from participants where id = $1', [member]],
  'writes the participant': () => [`update participants set name = 'Renamed' where id = $1 returning id`, [member]],
  'creates a project': () => [`insert into projects (organisation_id, name, country) values ($1, 'New', 'BE') returning id`, [org]],
  'shares a project': () => [`insert into project_shares (project_id, user_id, role) values ($1, $2, 'viewer') returning project_id`, [other, PEOPLE.stranger]],
  'invites an editor': () => [`select * from invite_member($1, 'someone@example.org', 'editor')`, [org]],
  'invites an owner': () => [`select * from invite_member($1, 'someone@example.org', 'owner')`, [org]],
  'adds a member': () => [`insert into organisation_members (organisation_id, user_id, role) values ($1, $2, 'viewer') returning user_id`, [org, PEOPLE.stranger]],
  'renames the organisation': () => [`update organisations set name = 'Renamed' where id = $1 returning id`, [org]],
  'issues a key': () => [`select * from create_api_key($1, 'A key')`, [org]],
};

// What each role could do before capabilities, and the participant's account.
const EXPECTED: Record<Person, string[]> = {
  owner: Object.keys(GESTURES),
  editor: ['reads the organisation', 'reads the shared project', 'reads the other project', 'reads the participant', 'writes the participant',
    'creates a project', 'shares a project', 'invites an editor'],
  viewer: ['reads the organisation', 'reads the shared project', 'reads the other project', 'reads the participant'],
  shareEditor: ['reads the shared project', 'reads the participant', 'writes the participant'],
  shareViewer: ['reads the shared project', 'reads the participant'],
  participant: ['reads the participant'],
  stranger: [],
};

beforeAll(async () => {
  db = await freshDatabase();
  org = await organisation(db, 'A cooperative', PEOPLE.owner);
  for (const id of Object.values(PEOPLE)) await db.query('insert into auth.users (id) values ($1) on conflict do nothing', [id]);
  await db.query(`insert into organisation_members (organisation_id, user_id, role) values ($1, $2, 'editor'), ($1, $3, 'viewer')`,
    [org, PEOPLE.editor, PEOPLE.viewer]);
  shared = await insert(db, 'projects', { organisation_id: org, name: 'Shared', country: 'BE' });
  other = await insert(db, 'projects', { organisation_id: org, name: 'Other', country: 'BE' });
  member = (await one<{ id: string }>(db, `select join_project($1, 'School', '{"country": "BE"}') id`, [shared])).id;
  await db.query(`insert into project_shares (project_id, user_id, role) values ($1, $2, 'editor'), ($1, $3, 'viewer')`,
    [shared, PEOPLE.shareEditor, PEOPLE.shareViewer]);
  await db.query('update participants set user_id = $2 where id = $1', [member, PEOPLE.participant]);
});

afterAll(async () => {
  await db.close();
});

describe('each preset', () => {
  for (const person of Object.keys(PEOPLE) as Person[]) {
    it(`lets ${person} do exactly what its role could`, async () => {
      const done: string[] = [];
      for (const [name, gesture] of Object.entries(GESTURES)) {
        const [sql, params] = gesture();
        if (await can(person, sql, params)) done.push(name);
      }
      expect(done).toEqual(EXPECTED[person]);
    });
  }
});

describe('the presets', () => {
  it('are rows of role_capabilities, and every capability is held by the owner', async () => {
    const rows = await db.query<{ role: string; n: number }>('select role, count(*)::int n from role_capabilities group by role order by role');
    const total = (await one<{ n: number }>(db, 'select count(*)::int n from capabilities')).n;
    expect(Object.fromEntries(rows.rows.map((r) => [r.role, r.n]))).toEqual({ editor: total - 2, owner: total, participant: 5, viewer: 1 });
  });
});
