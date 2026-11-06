// The rights of the core, pinned row by row before the rules that grant them
// change (decision 0059). Every way a person reaches a row — a member of the
// organisation by its preset, a person a project is shared with, the account
// of a participant or of a group, a key — reads and writes exactly the rows
// listed here. A rule rewritten to be evaluated by set keeps this file green
// without touching its expectations.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase, insert, one, organisation } from './helpers/db.js';

const user = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
const OWNER = user(1);
const EDITOR = user(2);
const VIEWER = user(3);
const SHARED_VIEWER = user(4);
const SHARED_EDITOR = user(5);
const HOUSEHOLD = user(6);
const BUSINESS = user(7);
const STRANGER = user(8);
const ELSEWHERE = user(9);

/** The tables of the core whose rows hang under an organisation, a project or a participant, by the column that names a row. */
const TABLES: Record<string, string> = {
  projects: 'id', participants: 'id', meters: 'id', devices: 'id', series: 'id',
  attributes: 'id', identifiers: 'value', documents: 'id', contacts: 'id', connectors: 'id',
};

let db: PGlite;
let readKey: string;
let writeKey: string;
/** A readable name for every row of the fixture, by table and id. */
const labels = new Map<string, string>();

const join = async (project: string, name: string, parent: string | null = null) =>
  (await one<{ id: string }>(db, `select join_project($1, $2, '{"country": "BE"}', p_parent_id => $3) id`, [project, name, parent])).id;

/** A participant with a meter, a series on it, a device and an attribute: one of everything a person may reach. */
async function equip(participant: string, ean: string) {
  const meter = (await one<{ id: string }>(db, `select declare_meter($1, $2, 'gs1_gsrn') id`, [participant, ean])).id;
  await db.query(`select add_identifier('meter', $1, 'gs1_gsrn', $2)`, [meter, ean]);
  await db.query(`select store(null, array['2026-01-01T00:00:00Z']::timestamptz[], array[1.5]::float8[], p_series => $1::jsonb)`,
    [JSON.stringify({ object_kind: 'meter', object_id: meter, quantity_code: 'offtake_energy', step: '1 hour' })]);
  const type = (await one<{ code: string }>(db, 'select code from device_types order by code limit 1')).code;
  await db.query('select install_device($1, $2, $3)', [participant, type, `Device ${ean.slice(-2)}`]);
  await db.query(`select set_attribute('participant', $1, 'annual_consumption', '3500'::jsonb, null, null, 'bills')`, [participant]);
  await db.query(`insert into documents (organisation_id, object_kind, object_id, name, uri)
                  select organisation_id, 'participant', id, 'Bill of ' || name, 'bills/' || id from participants where id = $1`, [participant]);
}

/** Runs `sql` as `userId` (or as a key) in a transaction that is rolled back: what it shows, nothing it leaves. */
async function rows(who: { user?: string; key?: string }, sql: string): Promise<string[]> {
  await db.exec('begin');
  try {
    if (who.key) await db.query('select use_api_key($1)', [who.key]);
    else await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who.user, role: 'authenticated' })]);
    await db.exec('set local role authenticated');
    return (await db.query<{ id: string }>(sql)).rows.map((r) => r.id);
  } finally {
    await db.exec('rollback');
  }
}

/** The rows of every table of the core a person reads, by their names, sorted. */
async function reads(who: { user?: string; key?: string }): Promise<string[]> {
  const seen: string[] = [];
  for (const [t, key] of Object.entries(TABLES)) for (const id of await rows(who, `select ${key} id from ${t}`)) seen.push(labels.get(id) ?? `${t}:?`);
  return seen.sort();
}

/** The rows of every table of the core a person may change: an update that changes nothing, under the write rules. */
async function writes(who: { user?: string; key?: string }): Promise<string[]> {
  const seen: string[] = [];
  for (const [t, key] of Object.entries(TABLES)) for (const id of await rows(who, `update ${t} set ${key} = ${key} returning ${key} id`)) seen.push(labels.get(id) ?? `${t}:?`);
  return seen.sort();
}

beforeAll(async () => {
  db = await freshDatabase();
  const org = await organisation(db, 'A cooperative', OWNER);
  const other = await organisation(db, 'Another cooperative', ELSEWHERE);
  for (const u of [EDITOR, VIEWER, SHARED_VIEWER, SHARED_EDITOR, HOUSEHOLD, BUSINESS, STRANGER]) {
    await db.query('insert into auth.users (id) values ($1) on conflict do nothing', [u]);
  }
  await db.query(`insert into organisation_members (organisation_id, user_id, role) values ($1, $2, 'editor'), ($1, $3, 'viewer')`, [org, EDITOR, VIEWER]);

  const community = await insert(db, 'projects', { organisation_id: org, name: 'Community', country: 'BE' });
  const campus = await insert(db, 'projects', { organisation_id: org, name: 'Campus', country: 'BE' });
  const abroad = await insert(db, 'projects', { organisation_id: other, name: 'Abroad', country: 'BE' });
  const home = await join(community, 'Home');
  const neighbour = await join(community, 'Neighbour');
  const group = await insert(db, 'participants', { organisation_id: org, project_id: campus, name: 'Business' });
  const siteA = await join(campus, 'Site A', group);
  const siteB = await join(campus, 'Site B', group);
  const far = await join(abroad, 'Far');
  await equip(home, '541448000000000001');
  await equip(neighbour, '541448000000000002');
  await equip(siteA, '541448000000000003');
  await equip(siteB, '541448000000000004');
  await equip(far, '541448000000000009');
  await db.query(`insert into contacts (organisation_id, name) values ($1, 'Installer'), ($2, 'Installer abroad')`, [org, other]);
  const source = (await one<{ code: string }>(db, 'select code from sources order by code limit 1')).code;
  await db.query(`insert into connectors (organisation_id, source_code, name) values ($1, $3, 'Readings'), ($2, $3, 'Readings abroad')`, [org, other, source]);

  await db.query(`insert into project_shares (project_id, user_id, role) values ($1, $2, 'viewer'), ($1, $3, 'editor')`, [community, SHARED_VIEWER, SHARED_EDITOR]);
  await db.query('update participants set user_id = $2 where id = $1', [home, HOUSEHOLD]);
  await db.query('update participants set user_id = $2 where id = $1', [group, BUSINESS]);

  // Every row by a name a reader can check: the participant or meter it hangs on.
  const named = await db.query<{ id: string; label: string }>(`
    select id::text, 'project ' || name label from projects
    union all select id::text, 'participant ' || name from participants
    union all select m.id::text, 'meter of ' || p.name from meters m join participants p on p.id = m.participant_id
    union all select d.id::text, 'device of ' || p.name from devices d join participants p on p.id = d.participant_id
    union all select s.id::text, 'series of ' || p.name from series s join meters m on m.id = s.object_id join participants p on p.id = m.participant_id
    union all select a.id::text, 'attribute of ' || p.name from attributes a join participants p on p.id = a.object_id
    union all select i.value, 'identifier of ' || p.name from identifiers i join meters m on m.id = i.object_id join participants p on p.id = m.participant_id
    union all select d.id::text, 'document of ' || p.name from documents d join participants p on p.id = d.object_id
    union all select id::text, 'contact ' || name from contacts
    union all select id::text, 'connector ' || name from connectors`);
  for (const r of named.rows) labels.set(r.id, r.label);

  const key = async (capabilities: string) => (await one<{ secret: string }>(db, `
    select secret from (select set_config('request.jwt.claims', $3, false)) c, create_api_key($1, 'Nightly', $2::text[])`,
    [org, capabilities, JSON.stringify({ sub: OWNER, role: 'authenticated' })])).secret;
  readKey = await key('{data.read}');
  writeKey = await key('{data.read,data.write}');
  await db.query(`select set_config('request.jwt.claims', '', false)`);
});

afterAll(async () => {
  await db.close();
});

/** What hangs under one participant: the rows its account reaches. */
const under = (name: string) => [
  `participant ${name}`, `meter of ${name}`, `device of ${name}`, `series of ${name}`,
  `attribute of ${name}`, `identifier of ${name}`, `document of ${name}`,
];
const HOME = under('Home');
const COMMUNITY = ['project Community', ...HOME, ...under('Neighbour')];
const BUSINESS_ROWS = ['participant Business', ...under('Site A'), ...under('Site B')];
const CAMPUS = ['project Campus', ...BUSINESS_ROWS];
const ORGANISATION = [...COMMUNITY, ...CAMPUS, 'contact Installer', 'connector Readings'];
const ABROAD = ['project Abroad', ...under('Far'), 'contact Installer abroad', 'connector Readings abroad'];
const sorted = (labels: string[]) => [...labels].sort();

describe('who reads what', () => {
  it('lets every member of the organisation read all of it, whatever the preset', async () => {
    for (const member of [OWNER, EDITOR, VIEWER]) expect(await reads({ user: member })).toEqual(sorted(ORGANISATION));
  });

  it('lets a person a project is shared with read that project and what hangs under it', async () => {
    for (const shared of [SHARED_VIEWER, SHARED_EDITOR]) expect(await reads({ user: shared })).toEqual(sorted(COMMUNITY));
  });

  it('lets the account of a participant read its own participant and what hangs under it', async () => {
    expect(await reads({ user: HOUSEHOLD })).toEqual(sorted(HOME));
  });

  it('lets the account of a group read the group, its members and what hangs under them, not the project', async () => {
    expect(await reads({ user: BUSINESS })).toEqual(sorted(BUSINESS_ROWS));
  });

  it('shows a key what its issuer reads in its organisation', async () => {
    expect(await reads({ key: readKey })).toEqual(sorted(ORGANISATION));
  });

  it('shows nothing to a person without a right, and nothing of another organisation to anyone', async () => {
    expect(await reads({ user: STRANGER })).toEqual([]);
    expect(await reads({ user: ELSEWHERE })).toEqual(sorted(ABROAD));
  });
});

describe('who writes what', () => {
  it('lets an owner and an editor write all of the organisation', async () => {
    for (const member of [OWNER, EDITOR]) expect(await writes({ user: member })).toEqual(sorted(ORGANISATION));
  });

  it('lets a person a project is shared with as editor write that project and what hangs under it', async () => {
    expect(await writes({ user: SHARED_EDITOR })).toEqual(sorted(COMMUNITY));
  });

  it('lets a key that writes write its organisation', async () => {
    expect(await writes({ key: writeKey })).toEqual(sorted(ORGANISATION));
  });

  it('lets a viewer, a shared viewer, an account and a stranger write nothing, and a reading key not even try', async () => {
    for (const reader of [VIEWER, SHARED_VIEWER, HOUSEHOLD, BUSINESS, STRANGER]) expect(await writes({ user: reader })).toEqual([]);
    await expect(writes({ key: readKey })).rejects.toThrow(/read-only transaction/);
  });
});
