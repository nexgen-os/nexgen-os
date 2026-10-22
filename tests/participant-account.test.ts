// The end customer is a participant (decision 0052): one account on
// `participants.user_id`, the preset `participant`, which reads its own
// participant, the participants it groups and everything under them, and
// makes the few choices that are its own — nothing of its neighbours, of
// the project or of the organisation.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, asUser, freshDatabase, insert, one, organisation } from './helpers/db.js';

const HOUSEHOLD = '00000000-0000-4000-8000-0000000000c1';
const BUSINESS = '00000000-0000-4000-8000-0000000000c2';
const NEWCOMER = '00000000-0000-4000-8000-0000000000c3';

let db: PGlite;
let org: string;
let project: string;
let home: string;
let neighbour: string;
let group: string;
let siteA: string;
let siteB: string;
let homeMeter: string;
let neighbourMeter: string;
let settlement: string;

const as = <T>(user: string, sql: string, params: unknown[] = []) => asUser(db, user, async () => (await db.query<T>(sql, params)).rows);
const join = async (name: string, parent: string | null = null) =>
  (await one<{ id: string }>(db, `select join_project($1, $2, '{"country": "BE"}', p_parent_id => $3) id`, [project, name, parent])).id;
const meterOf = async (participantId: string, identifier: string) =>
  (await one<{ id: string }>(db, `select declare_meter($1, $2, 'gs1_gsrn') id`, [participantId, identifier])).id;
const offtake = (meter: string, value: number) =>
  db.query(`select store(null, array['2026-01-01T00:00:00Z']::timestamptz[], array[$2]::float8[], p_series => $1::jsonb)`,
    [JSON.stringify({ object_kind: 'meter', object_id: meter, quantity_code: 'offtake_energy', step: '1 hour' }), value]);

beforeAll(async () => {
  db = await freshDatabase(['community', 'billing', 'actions']);
  org = await organisation(db, 'A supplier', USER_A);
  await db.query(`insert into auth.users (id, email) values ($1, 'home@example.org'), ($2, 'business@example.org'), ($3, 'new@example.org')
                  on conflict do nothing`, [HOUSEHOLD, BUSINESS, NEWCOMER]);
  project = await insert(db, 'projects', { organisation_id: org, name: 'A community', country: 'BE' });
  home = await join('Household');
  neighbour = await join('Neighbour');
  group = await insert(db, 'participants', { organisation_id: org, project_id: project, name: 'A business' });
  siteA = await join('Site A', group);
  siteB = await join('Site B', group);
  homeMeter = await meterOf(home, '541448000000000011');
  neighbourMeter = await meterOf(neighbour, '541448000000000012');
  await meterOf(siteA, '541448000000000013');
  await meterOf(siteB, '541448000000000014');
  await offtake(homeMeter, 1.5);
  await offtake(neighbourMeter, 2.5);
  settlement = (await one<{ id: string }>(db,
    `insert into community.settlements (organisation_id, project_id, provenance, inputs, results)
     values ($1, $2, 'sharing-engine 1.0', '{}', $3::jsonb) returning id`,
    [org, project, JSON.stringify({ totals: { shared_energy: 3 }, participants: [
      { id: home, totals: { shared_offtake_energy: 1 } }, { id: neighbour, totals: { shared_offtake_energy: 2 } }] })])).id;
  await db.query('update participants set user_id = $2 where id = $1', [home, HOUSEHOLD]);
  await db.query('update participants set user_id = $2 where id = $1', [group, BUSINESS]);
});

afterAll(async () => {
  await db.close();
});

describe('the account of a participant', () => {
  it('reads its participant, its meter and its series', async () => {
    expect(await as(HOUSEHOLD, 'select name from participants')).toEqual([{ name: 'Household' }]);
    expect(await as(HOUSEHOLD, 'select identifier from meters')).toEqual([{ identifier: '541448000000000011' }]);
    const values = await as<{ value: number }>(HOUSEHOLD,
      `select value from resample((select id from series where object_id = $1), '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z', '1 hour')`, [homeMeter]);
    expect(values).toEqual([{ value: 1.5 }]);
  });

  it('is refused on a neighbour, the project, the organisation and its settings', async () => {
    expect(await as(HOUSEHOLD, 'select id from meters where id = $1', [neighbourMeter])).toEqual([]);
    expect(await as(HOUSEHOLD, 'select id from series where object_id = $1', [neighbourMeter])).toEqual([]);
    await expect(as(HOUSEHOLD, `select * from resample((select id from series where object_id = $1 limit 1), '2026-01-01', '2026-01-02', '1 hour')`,
      [neighbourMeter])).rejects.toThrow();
    expect(await as(HOUSEHOLD, 'select id from participants where id = $1', [neighbour])).toEqual([]);
    expect(await as(HOUSEHOLD, 'select id from projects')).toEqual([]);
    expect(await as(HOUSEHOLD, 'select id from organisations')).toEqual([]);
    expect(await as(HOUSEHOLD, 'select user_id from organisation_members')).toEqual([]);
    expect(await as(HOUSEHOLD, 'select id from invitations')).toEqual([]);
    expect(await as(HOUSEHOLD, 'select id from community.settlements')).toEqual([]);
    expect(await as(HOUSEHOLD, `select has_capability('organisation', $1, 'data.read') held`, [org])).toEqual([{ held: false }]);
    expect(await as(HOUSEHOLD, `select has_capability('meter', $1, 'data.read') held`, [neighbourMeter])).toEqual([{ held: false }]);
  });

  it('writes nothing of the description', async () => {
    expect(await as(HOUSEHOLD, `update participants set name = 'Mine' where id = $1 returning id`, [home])).toEqual([]);
    await expect(asUser(db, HOUSEHOLD, () => db.query(`select declare_meter($1, '541448000000000019', 'gs1_gsrn')`, [home]))).rejects.toThrow();
    expect(await as(HOUSEHOLD, `select my_capabilities('participant', $1) c`, [home]))
      .toEqual(['account.consent', 'account.contact', 'account.decide', 'account.notifications', 'data.read'].map((c) => ({ c })));
  });

  it('sees its share of a community settlement, and only its share', async () => {
    const share = await as<{ s: { participant: { id: string; totals: Record<string, number> }; provenance: string } }>(HOUSEHOLD,
      'select community.settlement_share($1, $2) s', [settlement, home]);
    expect(share[0].s.participant).toEqual({ id: home, totals: { shared_offtake_energy: 1 } });
    expect(share[0].s.provenance).toBe('sharing-engine 1.0');
    expect(JSON.stringify(share[0].s)).not.toContain(neighbour);
    await expect(as(HOUSEHOLD, 'select community.settlement_share($1, $2)', [settlement, neighbour])).rejects.toThrow(/^settlement_not_found/);
  });

  it('writes its contact details and notification settings, its consents, nothing else', async () => {
    await as(HOUSEHOLD, `select set_attribute('participant', $1, 'contact_email', '"home@example.org"'::jsonb, null, null, 'customer_declaration')`, [home]);
    await as(HOUSEHOLD, `select set_attribute('participant', $1, 'notification_channels', '{"bill": ["email"]}'::jsonb, null, null, 'customer_declaration')`, [home]);
    expect(await as(HOUSEHOLD, `select attribute_type, value from attributes where object_id = $1 order by 1`, [home])).toEqual([
      { attribute_type: 'contact_email', value: 'home@example.org' },
      { attribute_type: 'notification_channels', value: { bill: ['email'] } },
    ]);
    await expect(asUser(db, HOUSEHOLD, () => db.query(
      `select set_attribute('participant', $1, 'annual_consumption', '1'::jsonb, null, null, 'customer_declaration')`, [home]))).rejects.toThrow(/row-level security/);
    await expect(asUser(db, HOUSEHOLD, () => db.query(
      `select set_attribute('participant', $1, 'contact_email', '"x@example.org"'::jsonb, null, null, 'customer_declaration')`, [neighbour]))).rejects.toThrow();
    const purpose = (await one<{ code: string }>(db, 'select code from community.consent_purposes order by code limit 1')).code;
    const [{ id }] = await as<{ id: string }>(HOUSEHOLD, `select community.give_consent($1, $2, '2026-01-01T00:00:00Z', 'Household') id`, [home, purpose]);
    expect(id).toBeTruthy();
    await expect(asUser(db, HOUSEHOLD, () => db.query(`select community.give_consent($1, $2, '2026-01-01T00:00:00Z')`, [neighbour, purpose])))
      .rejects.toThrow(/^participant_not_found/);
  });

  it('reads the bills and the actions of its own participant', async () => {
    await db.query(`select actions.propose('participant', $1, (select code from actions.phases order by code limit 1), 'Insulate the roof')`, [home]);
    await db.query(`select actions.propose('participant', $1, (select code from actions.phases order by code limit 1), 'Not yours')`, [neighbour]);
    expect(await as(HOUSEHOLD, 'select name from actions.actions')).toEqual([{ name: 'Insulate the roof' }]);
  });
});

describe('a group of participants', () => {
  it('lets the account on the parent read its children, never the other way', async () => {
    expect((await as<{ name: string }>(BUSINESS, 'select name from participants order by name')).map((r) => r.name))
      .toEqual(['A business', 'Site A', 'Site B']);
    expect(await as(BUSINESS, 'select count(*)::int n from meters')).toEqual([{ n: 2 }]);
    await db.query('update participants set user_id = $2 where id = $1', [siteA, NEWCOMER]);
    expect(await as(NEWCOMER, 'select name from participants')).toEqual([{ name: 'Site A' }]);
    await db.query('update participants set user_id = null where id = $1', [siteA]);
  });
});

describe('an invitation to a participant', () => {
  it('opens the account of the participant to the person it was sent to', async () => {
    const sent = await asUser(db, USER_A, () => one<{ token: string }>(db, `select * from invite_participant($1, 'New@Example.org')`, [neighbour]));
    const taken = await asUser(db, NEWCOMER, () => one<{ r: Record<string, string> }>(db, 'select accept_invitation($1) r', [sent.token]));
    expect(taken.r).toEqual({ organisation_id: org, project_id: project, participant_id: neighbour, role: 'participant' });
    expect(await as(NEWCOMER, 'select name from participants')).toEqual([{ name: 'Neighbour' }]);
    expect(await as(NEWCOMER, 'select identifier from meters')).toEqual([{ identifier: '541448000000000012' }]);
  });

  it('is refused when the participant already has an account, and to whoever does not share', async () => {
    await asUser(db, USER_A, () => db.query(`select invite_participant($1, 'new@example.org')`, [home]));
    await expect(asUser(db, NEWCOMER, () => db.query('select accept_invitations()'))).rejects.toThrow(/^participant_has_account/);
    await expect(asUser(db, HOUSEHOLD, () => db.query(`select invite_participant($1, 'x@example.org')`, [home]))).rejects.toThrow(/^participant_not_found/);
  });
});
