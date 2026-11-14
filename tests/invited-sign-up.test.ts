// An account is opened by an invitation: the Before User Created hook of
// Supabase Auth, `before_user_created(event)`, lets in the address an open
// invitation was sent to, the installation's first person while nobody is a
// member yet, and refuses everybody else as `invitation_required`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, asUser, freshDatabase, one, organisation } from './helpers/db.js';

let db: PGlite;
let org: string;

/** The event Supabase Auth sends the hook, reduced to what it reads. */
const event = (user: { email?: string; phone?: string; is_anonymous?: boolean }) => ({
  metadata: { name: 'before-user-created', time: '2026-11-03T00:00:00Z' },
  user: { id: '00000000-0000-4000-8000-0000000000f1', aud: 'authenticated', email: '', phone: '', is_anonymous: false, ...user },
});

/** Calls the hook as Supabase Auth does, under the role `supabase_auth_admin`. */
async function hook(user: Parameters<typeof event>[0]): Promise<Record<string, unknown>> {
  await db.exec('set role supabase_auth_admin');
  try {
    return (await one<{ r: Record<string, unknown> }>(db, 'select nexgen.before_user_created($1::jsonb) r', [JSON.stringify(event(user))])).r;
  } finally {
    await db.exec('reset role');
  }
}

const refused = { error: { http_code: 403, message: 'invitation_required: an account is opened by an invitation sent to its email address' } };

beforeAll(async () => {
  db = await freshDatabase();
});

afterAll(async () => {
  await db.close();
});

describe('an account opened by an invitation', () => {
  it('lets the first person of an installation in, while nobody is a member of any organisation', async () => {
    expect(await hook({ email: 'founder@example.org' })).toEqual({});
    expect(await hook({ phone: '10000000000' })).toEqual({});
  });

  it('then refuses an address nobody invited, a phone number and an anonymous sign-in', async () => {
    org = await organisation(db, 'A cooperative', USER_A);
    expect(await hook({ email: 'stranger@example.org' })).toEqual(refused);
    expect(await hook({ phone: '10000000000' })).toEqual(refused);
    expect(await hook({ is_anonymous: true })).toEqual(refused);
  });

  it('lets in the address an open invitation was sent to, whatever its case', async () => {
    await asUser(db, USER_A, () => db.query(`select invite_member($1, 'member@example.org', 'viewer')`, [org]));
    expect(await hook({ email: ' Member@Example.org' })).toEqual({});
  });

  it('refuses the address of an invitation expired, revoked or already taken', async () => {
    await asUser(db, USER_A, () => db.query(`select invite_member($1, 'late@example.org', 'viewer', null, interval '-1 day')`, [org]));
    const withdrawn = await asUser(db, USER_A, () =>
      one<{ invitation_id: string }>(db, `select * from invite_member($1, 'withdrawn@example.org', 'viewer')`, [org]));
    await asUser(db, USER_A, () => db.query('select revoke_invitation($1)', [withdrawn.invitation_id]));
    await db.query(`update invitations set accepted_at = now(), accepted_by = $1 where email = 'member@example.org'`, [USER_A]);
    expect(await hook({ email: 'late@example.org' })).toEqual(refused);
    expect(await hook({ email: 'withdrawn@example.org' })).toEqual(refused);
    expect(await hook({ email: 'member@example.org' })).toEqual(refused);
  });

  it('is called by Supabase Auth only: a signed-in person or the anonymous role cannot', async () => {
    const can = await db.query<{ role: string; allowed: boolean }>(
      `select r as role, has_function_privilege(r, 'nexgen.before_user_created(jsonb)', 'execute') allowed
         from unnest(array['anon', 'authenticated', 'service_role', 'supabase_auth_admin']) r order by r`);
    expect(can.rows).toEqual([
      { role: 'anon', allowed: false },
      { role: 'authenticated', allowed: false },
      { role: 'service_role', allowed: false },
      { role: 'supabase_auth_admin', allowed: true },
    ]);
  });
});
