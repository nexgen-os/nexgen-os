// A project shared with a person outside its organisation, and invitations
// by email: a viewer of a project reads it and everything under it, an
// editor writes it too, nothing else of the organisation shows; an
// invitation becomes a membership when the person it was sent to signs in.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, USER_B, asUser, freshDatabase, insert, one, organisation } from './helpers/db.js';

const USER_C = '00000000-0000-4000-8000-00000000000c';
let db: PGlite;
let org: string;
let shared: string;
let hidden: string;
let member: string;
let meter: string;

const as = <T>(user: string, sql: string, params: unknown[] = []) => asUser(db, user, async () => (await db.query<T>(sql, params)).rows);

beforeAll(async () => {
  db = await freshDatabase();
  org = await organisation(db, 'A cooperative', USER_A);
  await db.query(`insert into auth.users (id, email) values ($1, 'b@example.org'), ($2, 'c@example.org') on conflict do nothing`, [USER_B, USER_C]);
  shared = await insert(db, 'projects', { organisation_id: org, name: 'Shared study', country: 'BE' });
  hidden = await insert(db, 'projects', { organisation_id: org, name: 'Other project', country: 'BE' });
  member = (await one<{ id: string }>(db, `select join_project($1, 'School', '{"country": "BE"}') id`, [shared])).id;
  await one(db, `select join_project($1, 'Elsewhere', '{"country": "BE"}') id`, [hidden]);
  meter = (await one<{ id: string }>(db, `select declare_meter($1, '541448000000000001', 'gs1_gsrn') id`, [member])).id;
  await db.query(`select set_attribute('participant', $1, 'annual_consumption', '12000'::jsonb, null, null, 'bills')`, [member]);
  await db.query(`select store(null, array['2026-01-01T00:00:00Z']::timestamptz[], array[1.5]::float8[], p_series => $1::jsonb)`,
    [JSON.stringify({ object_kind: 'meter', object_id: meter, quantity_code: 'offtake_energy', step: '1 hour' })]);
});

afterAll(async () => {
  await db.close();
});

describe('a project shared with a person', () => {
  it('shows nothing before it is shared', async () => {
    expect(await as(USER_B, 'select name from projects')).toEqual([]);
  });

  it('lets a viewer read the project and everything under it, and nothing else of the organisation', async () => {
    await db.query(`insert into project_shares (project_id, user_id, role) values ($1, $2, 'viewer')`, [shared, USER_B]);
    expect(await as(USER_B, 'select name from projects')).toEqual([{ name: 'Shared study' }]);
    expect(await as(USER_B, 'select name from participants')).toEqual([{ name: 'School' }]);
    expect(await as(USER_B, 'select identifier from meters')).toEqual([{ identifier: '541448000000000001' }]);
    expect(await as(USER_B, `select value from attributes where attribute_type = 'annual_consumption'`)).toEqual([{ value: 12000 }]);
    const values = await as<{ value: number }>(USER_B, `select value from resample((select id from series where object_id = $1), '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z', '1 hour')`, [meter]);
    expect(values).toEqual([{ value: 1.5 }]);
    expect(await as(USER_B, 'select name from organisations')).toEqual([]);
    // A viewer writes nothing.
    expect(await as(USER_B, `update participants set name = 'Renamed' where id = $1 returning id`, [member])).toEqual([]);
  });

  it('lets an editor write what is under the project, never another project', async () => {
    await db.query(`update project_shares set role = 'editor' where project_id = $1 and user_id = $2`, [shared, USER_B]);
    expect(await as(USER_B, `update participants set name = 'School (main)' where id = $1 returning name`, [member])).toEqual([{ name: 'School (main)' }]);
    await expect(asUser(db, USER_B, () => db.query(`insert into projects (organisation_id, name, country) values ($1, 'Mine now', 'BE')`, [org])))
      .rejects.toThrow(/row-level security/);
    await expect(asUser(db, USER_B, () => db.query(`insert into project_shares (project_id, user_id, role) values ($1, $2, 'editor')`, [hidden, USER_B])))
      .rejects.toThrow(/^project_not_found/);
  });
});

describe('an invitation by email', () => {
  it('becomes a membership of the project when the person it was sent to accepts it', async () => {
    const sent = await asUser(db, USER_A, () => one<{ invitation_id: string; token: string }>(db, `select * from invite_member($1, 'C@Example.org ', 'viewer', $2)`, [org, shared]));
    // Only the hash of the token is kept.
    expect(await one(db, 'select token_hash = encode(sha256(convert_to($2, \'UTF8\')), \'hex\') hashed from invitations where id = $1', [sent.invitation_id, sent.token])).toEqual({ hashed: true });
    await expect(asUser(db, USER_B, () => db.query('select accept_invitation($1)', [sent.token]))).rejects.toThrow(/^invitation_for_other_email/);
    const taken = await asUser(db, USER_C, () => one<{ r: Record<string, string> }>(db, 'select accept_invitation($1) r', [sent.token]));
    expect(taken.r).toEqual({ organisation_id: org, project_id: shared, role: 'viewer' });
    expect(await as(USER_C, 'select name from projects')).toEqual([{ name: 'Shared study' }]);
    await expect(asUser(db, USER_C, () => db.query('select accept_invitation($1)', [sent.token]))).rejects.toThrow(/^invitation_already_accepted/);
    await expect(asUser(db, USER_C, () => db.query(`select accept_invitation('nothing')`))).rejects.toThrow(/^invitation_not_found/);
  });

  it('becomes a membership of the organisation when the person signs in, and expires', async () => {
    await asUser(db, USER_A, () => db.query(`select invite_member($1, 'c@example.org', 'editor')`, [org]));
    const late = await asUser(db, USER_A, () => one<{ token: string }>(db, `select * from invite_member($1, 'c@example.org', 'viewer', $2, interval '-1 day')`, [org, hidden]));
    expect(await asUser(db, USER_C, () => one(db, 'select accept_invitations() n'))).toEqual({ n: 1 });
    expect(await as(USER_C, 'select name from projects order by name')).toEqual([{ name: 'Other project' }, { name: 'Shared study' }]);
    await expect(asUser(db, USER_C, () => db.query('select accept_invitation($1)', [late.token]))).rejects.toThrow(/^invitation_expired/);
  });

  it('is revoked, by hand or by inviting the same address again, as in Ekwo OS', async () => {
    const first = await asUser(db, USER_A, () => one<{ invitation_id: string; token: string }>(db, `select * from invite_member($1, 'd@example.org', 'viewer', $2)`, [org, shared]));
    const second = await asUser(db, USER_A, () => one<{ invitation_id: string; token: string }>(db, `select * from invite_member($1, 'd@example.org', 'editor', $2)`, [org, shared]));
    expect(await one(db, 'select revoked_at is not null revoked from invitations where id = $1', [first.invitation_id])).toEqual({ revoked: true });
    await expect(asUser(db, USER_C, () => db.query('select accept_invitation($1)', [first.token]))).rejects.toThrow(/^invitation_revoked/);
    const withdrawn = await asUser(db, USER_A, () => one<{ revoked: boolean }>(db, 'select (revoke_invitation($1)).revoked_at is not null revoked', [second.invitation_id]));
    expect(withdrawn).toEqual({ revoked: true });
    await expect(asUser(db, USER_C, () => db.query('select accept_invitation($1)', [second.token]))).rejects.toThrow(/^invitation_revoked/);
    await expect(asUser(db, USER_B, () => db.query('select revoke_invitation($1)', [second.invitation_id]))).rejects.toThrow(/^invitation_not_found/);
    const taken = (await one<{ id: string }>(db, `select id from invitations where accepted_at is not null limit 1`)).id;
    await expect(asUser(db, USER_A, () => db.query('select revoke_invitation($1)', [taken]))).rejects.toThrow(/^invitation_already_accepted/);
  });

  it('is offered by a member who writes the organisation, ownership by an owner only', async () => {
    await expect(asUser(db, USER_B, () => db.query(`select invite_member($1, 'x@example.org', 'viewer')`, [org]))).rejects.toThrow(/^organisation_not_found/);
    await expect(asUser(db, USER_C, () => db.query(`select invite_member($1, 'x@example.org', 'owner')`, [org]))).rejects.toThrow(/^owner_required/);
    await expect(asUser(db, USER_A, () => db.query(`select invite_member($1, 'x@example.org', 'owner', $2)`, [org, shared]))).rejects.toThrow(/invitations_role/);
  });
});
