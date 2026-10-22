// A key for a machine: issued by an owner, shown once, kept as its hash; it
// acts as its issuer within its organisation, read only unless it writes,
// and stops at once when revoked, expired or when its issuer leaves.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, USER_B, asUser, freshDatabase, insert, one, organisation } from './helpers/db.js';

let db: PGlite;
let org: string;
let other: string;
let otherProject: string;

const as = <T>(user: string, sql: string, params: unknown[] = []) => asUser(db, user, async () => (await db.query<T>(sql, params)).rows);

/** One transaction that presents `secret`, then runs `sql` as the key. */
async function withKey<T>(secret: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('begin');
  try {
    await db.query('select use_api_key($1)', [secret]);
    await db.exec('set local role authenticated');
    const rows = (await db.query<T>(sql, params)).rows;
    await db.exec('commit');
    return rows;
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}

async function issue(capabilities: string[], expires: string | null = null): Promise<{ api_key_id: string; secret: string; prefix: string }> {
  const [row] = await as<{ api_key_id: string; secret: string; prefix: string }>(USER_A,
    'select * from create_api_key($1, $2, $3::text[], $4)', [org, 'Nightly import', `{${capabilities.join(',')}}`, expires]);
  return row!;
}

beforeAll(async () => {
  db = await freshDatabase();
  org = await organisation(db, 'A cooperative', USER_A);
  other = await organisation(db, 'Another organisation', USER_A);
  await insert(db, 'projects', { organisation_id: org, name: 'Rooftops', country: 'BE' });
  otherProject = await insert(db, 'projects', { organisation_id: other, name: 'Elsewhere', country: 'BE' });
  await db.query(`insert into auth.users (id) values ($1) on conflict do nothing`, [USER_B]);
  await db.query(`insert into organisation_members (organisation_id, user_id, role) values ($1, $2, 'editor')`, [org, USER_B]);
});

afterAll(async () => {
  await db.close();
});

describe('api keys', () => {
  it('is issued by an owner, shown once and kept as its hash', async () => {
    const key = await issue(['data.read']);
    expect(key.secret).toMatch(new RegExp(`^ngk_${key.prefix}_[0-9a-f]{64}$`));
    const stored = await one<{ key_hash: string }>(db, 'select key_hash from api_keys where id = $1', [key.api_key_id]);
    expect(stored.key_hash).not.toContain(key.secret);
    const listed = await as<{ prefix: string; capabilities: string[] }>(USER_A, 'select prefix, capabilities from list_api_keys($1)', [org]);
    expect(listed).toContainEqual({ prefix: key.prefix, capabilities: ['data.read'] });
    await expect(as(USER_A, 'select key_hash from api_keys')).rejects.toThrow(/permission denied/);
  });

  it('is refused to anybody but an owner, and without a known capability', async () => {
    await expect(as(USER_B, `select * from create_api_key($1, 'Mine', array['data.read'])`, [org])).rejects.toThrow(/^not_allowed:/);
    await expect(as(USER_A, `select * from create_api_key($1, 'Mine', array['admin'])`, [org])).rejects.toThrow(/^unknown_capability:/);
    await expect(as(USER_A, `select * from create_api_key($1, 'Mine', array[]::text[])`, [org])).rejects.toThrow(/^api_key_without_capability:/);
    expect(await as(USER_B, 'select id from list_api_keys($1)', [org])).toEqual([]);
  });

  it('acts as its issuer, within its organisation only, read only without write', async () => {
    const key = await issue(['data.read']);
    expect(await withKey(key.secret, 'select name from projects order by name')).toEqual([{ name: 'Rooftops' }]);
    expect(await withKey(key.secret, 'select auth.uid() as uid')).toEqual([{ uid: USER_A }]);
    expect(await withKey(key.secret, 'select id from projects where id = $1', [otherProject])).toEqual([]);
    await expect(withKey(key.secret, `insert into projects (organisation_id, name, country) values ($1, 'New', 'BE')`, [org]))
      .rejects.toThrow(/read-only transaction/);
    const used = await one<{ last_used_at: string | null }>(db, 'select last_used_at from api_keys where id = $1', [key.api_key_id]);
    expect(used.last_used_at).not.toBeNull();
  });

  it('writes with write, as its issuer would', async () => {
    const key = await issue(['data.read', 'data.write']);
    const [row] = await withKey<{ name: string }>(key.secret,
      `insert into projects (organisation_id, name, country) values ($1, 'Written by a key', 'BE') returning name`, [org]);
    expect(row).toEqual({ name: 'Written by a key' });
    await expect(withKey(key.secret, `insert into projects (organisation_id, name, country) values ($1, 'Elsewhere too', 'BE')`, [other]))
      .rejects.toThrow(/row-level security/);
    await expect(withKey(key.secret, `select * from create_api_key($1, 'Child', array['data.read'])`, [org])).rejects.toThrow(/^not_allowed:/);
    // The key holds what is on its list, never all its issuer holds: its owner may rename the organisation, it may not.
    expect(await withKey(key.secret, `update organisations set name = 'Renamed by a key' where id = $1 returning id`, [org])).toEqual([]);
    expect(await withKey(key.secret, `select has_capability('organisation', $1, 'members.manage') held`, [org])).toEqual([{ held: false }]);
  });


  it('stops when revoked, expired, unknown, or when its issuer leaves', async () => {
    const key = await issue(['data.read']);
    await as(USER_A, 'select revoke_api_key($1)', [key.api_key_id]);
    await expect(withKey(key.secret, 'select 1')).rejects.toThrow(/^api_key_revoked:/);
    await expect(withKey('ngk_nothing_0000', 'select 1')).rejects.toThrow(/^api_key_unknown:/);
    const soon = await issue(['data.read'], new Date(Date.now() + 60_000).toISOString());
    await db.query(`update api_keys set expires_at = created_at + interval '1 millisecond' where id = $1`, [soon.api_key_id]);
    await expect(withKey(soon.secret, 'select 1')).rejects.toThrow(/^api_key_expired:/);
    await expect(as(USER_B, 'select revoke_api_key($1)', [key.api_key_id])).rejects.toThrow(/^api_key_unknown:/);

    const keyOfB = await one<{ secret: string }>(db,
      `insert into api_keys (organisation_id, name, prefix, key_hash, capabilities, created_by)
       values ($1, 'Of B', 'b', invitation_token_hash('ngk_b_secret'), array['data.read'], $2) returning 'ngk_b_secret' secret`, [org, USER_B]);
    expect(await withKey(keyOfB.secret, 'select count(*)::int n from projects')).not.toEqual([]);
    await db.query('delete from organisation_members where organisation_id = $1 and user_id = $2', [org, USER_B]);
    await expect(withKey(keyOfB.secret, 'select 1')).rejects.toThrow(/^api_key_issuer_left:/);
  });
});
