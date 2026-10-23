// The `actions` module: the actions of the works on the farm of example 4,
// from the permit to the commissioning of the ground array, who carries each,
// what is late on a given day, where the farm and its project stand; a
// recommendation resting on an estimate along its lifecycle; a command asked
// of the ground array's inverter, carried out or failed; and the steps a
// project gets from the templates of its country and condition.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, USER_B, asUser, freshDatabase, insert, one, organisation, repoRoot, participant } from '../../../tests/helpers/db.js';

const ORG = '00000000-0000-4000-8000-000400000001';
const FARM = '00000000-0000-4000-8000-000400000010';
const GROUND_ARRAY = '00000000-0000-4000-8000-000400000052';
const CARPORT_ARRAY = '00000000-0000-4000-8000-000400000053';

let db: PGlite;
let installer: string;
let installed: string;

interface Progress {
  on: string;
  total: number;
  by_status: Record<string, number>;
  done_share: number | null;
  late: { id: string; name: string; phase: string; planned_end: string }[];
  current_phase: string | null;
}

interface Plan {
  project_id: string;
  created: number;
  existing: number;
  skipped: { code: string; published_by: string; reason: string; attribute_type: string }[];
}

const progress = async (objectId: string, on: string): Promise<Progress> =>
  (await one<{ p: Progress }>(db, 'select actions.progress($1, $2) p', [objectId, on])).p;

const plan = async (projectId: string): Promise<Plan> =>
  (await one<{ p: Plan }>(db, 'select actions.plan($1) p', [projectId])).p;

const action = (fields: Record<string, unknown>) => insert(db, 'actions.actions', { organisation_id: ORG, ...fields });

beforeAll(async () => {
  db = await freshDatabase(['actions', 'solar']);
  await db.exec(await readFile(join(repoRoot, 'docs', 'demo', '04-farm-solar.sql'), 'utf8'));
  await db.query('insert into auth.users (id) values ($1), ($2) on conflict do nothing', [USER_A, USER_B]);
  await db.query(`insert into organisation_members (organisation_id, user_id, role) values ($1, $2, 'owner')`, [ORG, USER_A]);
  await organisation(db, 'Another farm', USER_B);
  installer = (await one<{ id: string }>(db, `insert into contacts (organisation_id, name) values ($1, 'Solaire du Nord') returning id`, [ORG])).id;

  await action({ object_kind: 'participant', object_id: FARM, phase: 'permitting', role: 'municipality', name: 'Building permit for the ground array', status: 'done', planned_end: '2026-02-28', actual_start: '2026-01-05', actual_end: '2026-02-20' });
  await action({ object_kind: 'device', object_id: GROUND_ARRAY, phase: 'procurement', role: 'installer', name: 'Panels delivered', status: 'done', planned_end: '2026-04-30', actual_start: '2026-04-28', actual_end: '2026-04-28', responsible_contact_id: installer });
  installed = await action({
    object_kind: 'device', object_id: GROUND_ARRAY, phase: 'installation', role: 'installer', name: 'Ground array mounted and wired', status: 'launched',
    planned_start: '2026-05-04', planned_end: '2026-05-29', actual_start: '2026-05-11', responsible_contact_id: installer,
  });
  await action({ object_kind: 'device', object_id: GROUND_ARRAY, phase: 'grid_connection', role: 'grid_operator', name: 'Injection point energised', planned_start: '2026-08-01', planned_end: '2026-09-30' });
  await action({ object_kind: 'device', object_id: GROUND_ARRAY, phase: 'commissioning', name: 'Ground array commissioned', planned_end: '2026-10-31' });
  await action({ object_kind: 'device', object_id: CARPORT_ARRAY, phase: 'installation', name: 'Carport built', status: 'dismissed', planned_end: '2026-06-30' });
});

afterAll(async () => {
  await db.close();
});

describe('actions', () => {
  it('are about an object of the core, of the participant of what they are about, and name no seventh kind', async () => {
    const m = await one<{ participant: string }>(db, `select participant_of(t.object_kind, t.object_id) participant from actions.actions t where t.id = $1`, [installed]);
    expect(m).toEqual({ participant: FARM });
    await expect(action({ object_kind: 'building', object_id: FARM, phase: 'design', name: 'On a building' })).rejects.toThrow(/actions_object_kind|kind_unknown/);
  });

  it('come in phases read from a vocabulary that covers the life of a project', async () => {
    const phases = await db.query<{ code: string }>('select code from actions.phases order by position');
    expect(phases.rows.map((r) => r.code)).toEqual([
      'study', 'design', 'permitting', 'financing', 'procurement', 'site_preparation',
      'installation', 'grid_connection', 'commissioning', 'handover', 'operation', 'decommissioning',
    ]);
    await expect(action({ object_kind: 'participant', object_id: FARM, phase: 'demolition', name: 'Unknown phase' })).rejects.toThrow(/foreign key/);
  });

  it('are carried by a role read from a vocabulary', async () => {
    const roles = await db.query<{ code: string }>('select code from actions.roles order by code');
    expect(roles.rows.map((r) => r.code)).toEqual(['community_manager', 'financer', 'grid_operator', 'installer', 'municipality', 'notary', 'owner', 'regulator']);
    await expect(action({ object_kind: 'participant', object_id: FARM, phase: 'design', role: 'wizard', name: 'Unknown role' })).rejects.toThrow(/foreign key/);
  });

  it('keep their dates, status and source consistent', async () => {
    await expect(action({ object_kind: 'participant', object_id: FARM, phase: 'design', name: 'Done without an end', status: 'done', actual_start: '2026-01-01' }))
      .rejects.toThrow(/actions_done/);
    await expect(action({ object_kind: 'participant', object_id: FARM, phase: 'design', name: 'Ended but not done', actual_end: '2026-01-01' }))
      .rejects.toThrow(/actions_done/);
    await expect(action({ object_kind: 'participant', object_id: FARM, phase: 'design', name: 'Launched without a start', status: 'launched' }))
      .rejects.toThrow(/actions_launched/);
    await expect(action({ object_kind: 'participant', object_id: FARM, phase: 'design', name: 'Backwards', planned_start: '2026-03-01', planned_end: '2026-02-01' }))
      .rejects.toThrow(/actions_planned_order/);
    await expect(action({ object_kind: 'participant', object_id: FARM, phase: 'design', name: 'Unknown status', status: 'paused' }))
      .rejects.toThrow(/actions_status/);
    await expect(action({ object_kind: 'participant', object_id: FARM, phase: 'design', name: 'Unknown source', source: 'dream' }))
      .rejects.toThrow(/actions_source/);
    const fromDetector = await action({ object_kind: 'participant', object_id: FARM, phase: 'study', name: 'Battery sizing study', source: 'detector', source_ref: 'battery_investment' });
    expect((await one<{ source: string }>(db, 'select source from actions.actions where id = $1', [fromDetector])).source).toBe('detector');
  });

  it('stay in their organisation: subject, contact and dependency', async () => {
    const other = await one<{ id: string }>(db, `select id from organisations where name = 'Another farm'`);
    const theirField = await participant(db, { organisation_id: other.id, name: 'Their field', country: 'FR' });
    await expect(action({ object_kind: 'participant', object_id: theirField, phase: 'design', name: 'Not ours' })).rejects.toThrow(/^object_in_other_organisation/);
    const theirContact = (await one<{ id: string }>(db, `insert into contacts (organisation_id, name) values ($1, 'Their installer') returning id`, [other.id])).id;
    await expect(action({ object_kind: 'participant', object_id: FARM, phase: 'design', name: 'Their contact', responsible_contact_id: theirContact }))
      .rejects.toThrow(/^contact_in_other_organisation/);
    const theirs = await insert(db, 'actions.actions', { organisation_id: other.id, object_kind: 'participant', object_id: theirField, phase: 'design', name: 'Their study' });
    await expect(action({ object_kind: 'participant', object_id: FARM, phase: 'design', name: 'Waits for theirs', depends_on: theirs }))
      .rejects.toThrow(/^dependency_in_other_organisation/);
  });
});

describe('the lifecycle of an action', () => {
  it('proposes a recommendation resting on its estimate, then validates, launches and completes it', async () => {
    const estimate = '00000000-0000-4000-8000-0000000000e1';
    const id = (await one<{ id: string }>(db,
      `select actions.propose('participant', $1, 'study', 'Install a 20 kWh battery', 'agent', 'battery', 'solar.estimates', $2, 1400, 10) id`,
      [FARM, estimate])).id;
    expect(await one(db, 'select status, source, estimate_kind, estimate_id, expected_gain_per_year::float8 gain, gain_horizon_years from actions.actions where id = $1', [id]))
      .toEqual({ status: 'proposed', source: 'agent', estimate_kind: 'solar.estimates', estimate_id: estimate, gain: 1400, gain_horizon_years: 10 });
    await expect(db.query(`select actions.move($1, 'launched', '2026-07-01')`, [id])).rejects.toThrow(/^action_status_invalid: .* not proposed → launched/);
    await db.query(`select actions.move($1, 'validated')`, [id]);
    await expect(db.query(`select actions.move($1, 'launched')`, [id])).rejects.toThrow(/^action_day_required/);
    await db.query(`select actions.move($1, 'launched', '2026-07-01')`, [id]);
    await db.query(`select actions.move($1, 'done', '2026-07-15')`, [id]);
    expect(await one(db, 'select status, actual_start::text s, actual_end::text e from actions.actions where id = $1', [id])).toEqual({ status: 'done', s: '2026-07-01', e: '2026-07-15' });
    await expect(db.query(`select actions.move($1, 'dismissed')`, [id])).rejects.toThrow(/^action_status_invalid/);
    await db.query('delete from actions.actions where id = $1', [id]);
  });

  it('dismisses an action and restores it to proposed; refuses an estimate of no table, and a gain without an estimate', async () => {
    const id = (await one<{ id: string }>(db, `select actions.propose('participant', $1, 'study', 'Heat pump study') id`, [FARM])).id;
    await db.query(`select actions.move($1, 'dismissed')`, [id]);
    await expect(db.query(`select actions.move($1, 'validated')`, [id])).rejects.toThrow(/^action_status_invalid: .* not dismissed → validated/);
    await db.query(`select actions.move($1, 'proposed')`, [id]);
    expect(await one(db, 'select status from actions.actions where id = $1', [id])).toEqual({ status: 'proposed' });
    await expect(db.query(`select actions.propose('participant', $1, 'study', 'X', 'agent', null, 'battery.nowhere', $1)`, [FARM])).rejects.toThrow(/^estimate_kind_unknown/);
    await expect(action({ object_kind: 'participant', object_id: FARM, phase: 'study', name: 'Gain alone', expected_gain_per_year: 10 })).rejects.toThrow(/actions_gain_on_estimate/);
    await db.query('delete from actions.actions where id = $1', [id]);
  });
});

describe('where a project stands', () => {
  it('sums the actions of the participant up on a day: by status, share done, the late ones, the current phase', async () => {
    const p = await progress(FARM, '2026-06-15');
    expect(p).toEqual({
      on: '2026-06-15',
      total: 7,
      by_status: { done: 2, launched: 1, proposed: 3, dismissed: 1 },
      done_share: 0.3333,
      late: [{ id: installed, name: 'Ground array mounted and wired', phase: 'installation', planned_end: '2026-05-29' }],
      current_phase: 'study',
    });
  });

  it('gives the same answer for the same day, and another for another day', async () => {
    expect(await progress(FARM, '2026-06-15')).toEqual(await progress(FARM, '2026-06-15'));
    const early = await progress(FARM, '2026-05-01');
    expect(early.late).toEqual([]);
    const autumn = await progress(FARM, '2026-10-15');
    expect(autumn.late.map((l) => l.phase)).toEqual(['installation', 'grid_connection']);
  });

  it('moves when an action is done', async () => {
    await db.query(`update actions.actions set status = 'done', actual_end = '2026-06-19' where id = $1`, [installed]);
    await db.query(`update actions.actions set status = 'dismissed' where name = 'Battery sizing study'`);
    const p = await progress(FARM, '2026-06-22');
    expect(p.done_share).toBe(0.6);
    expect(p.late).toEqual([]);
    expect(p.current_phase).toBe('grid_connection');
  });

  it('sums a project up: its own actions and those of every participant taking part', async () => {
    const project = '00000000-0000-4000-8000-000400000005';
    await action({ object_kind: 'project', object_id: project, phase: 'design', name: 'Grid study accepted', status: 'done', actual_start: '2025-11-03', actual_end: '2025-12-15' });
    const p = await progress(project, '2026-06-22');
    expect(p.total).toBe(8);
    expect(p.by_status.done).toBe(4);
  });

  it('reads under row level security: a stranger sees no action', async () => {
    const mine = await asUser(db, USER_A, () => one<{ p: Progress }>(db, `select actions.progress($1, '2026-06-22') p`, [FARM]));
    expect(mine.p.total).toBe(7);
    const theirs = await asUser(db, USER_B, () => one<{ p: Progress }>(db, `select actions.progress($1, '2026-06-22') p`, [FARM]));
    expect(theirs.p).toMatchObject({ total: 0, by_status: {}, done_share: null, late: [], current_phase: null });
    await expect(asUser(db, USER_B, () => db.query(`update actions.actions set notes = 'x' where object_id = $1 returning id`, [FARM])))
      .resolves.toMatchObject({ rows: [] });
  });
});

describe('the generic templates the module publishes, for every country', () => {
  it('plan a roof installation in any country, steps in order, each waiting for the one before', async () => {
    const n = await one<{ n: number; countries: number }>(db, `select count(*)::int n, count(country)::int countries from actions.templates where published_by = 'actions'`);
    expect(n).toEqual({ n: 15, countries: 0 });
    const roof = await insert(db, 'projects', { organisation_id: ORG, name: 'Generic roof', country: 'FR', kind: 'pv_roof', status: 'creation' });
    expect(await plan(roof)).toMatchObject({ created: 9, existing: 0, skipped: [] });
    const first = await one<{ name: string; depends: string | null }>(db,
      `select t.name, d.name depends from actions.actions t left join actions.actions d on d.id = t.depends_on where t.object_id = $1 and t.phase = 'handover'`, [roof]);
    expect(first).toEqual({ name: 'Installation handed over with its file', depends: 'Connection energised and meter set for injection' });
    const community = await insert(db, 'projects', { organisation_id: ORG, name: 'Generic community', country: 'FR', kind: 'energy_community', status: 'creation' });
    expect(await plan(community)).toMatchObject({ created: 6, skipped: [] });
  });

  afterAll(async () => {
    // Set aside, so that the cases below count only the templates they write.
    await db.query(`delete from actions.templates where published_by = 'actions'`);
  });
});

describe('what has to be done, from the templates of a country and a kind of project', () => {
  let roofFr: string;
  let roofBe: string;
  let community: string;

  beforeAll(async () => {
    // Templates as an installation or a country overlay would publish them:
    // two countries, two kinds, one condition, one dependency.
    await db.query(`
      insert into actions.templates (code, published_by, country, condition, phase, role, name, legal_reference, documents, depends_on_code, position) values
        ('prior_declaration',  'overlay:fr', 'FR', '{"project_kind": "pv_roof"}',          'permitting',      'owner',        'Prior declaration of works filed with the municipality', 'Code de l''urbanisme, R. 421-17', '{"Cerfa 13703"}', null, 10),
        ('consuel',            'overlay:fr', 'FR', '{"project_kind": "pv_roof"}',          'commissioning',   'installer',    'Electrical conformity certificate obtained',             'Décret 72-1120',                  '{"Attestation de conformité"}', 'prior_declaration', 20),
        ('building_permit',    'overlay:fr', 'FR', '{"project_kind": "pv_roof", "attribute": {"attribute_type": "installed_power", "op": ">", "value": 250}}', 'permitting', 'municipality', 'Building permit granted', 'Code de l''urbanisme, R. 421-1', '{}', null, 15),
        ('statutes',           'overlay:fr', 'FR', '{"project_kind": "energy_community"}', 'design',          'notary',       'Statutes of the community signed',                        'Code de l''énergie, L. 291-1',    '{"Statuts"}', null, 10),
        ('dso_notification',   'overlay:be', 'BE', '{"project_kind": "pv_roof"}',          'grid_connection', 'owner',        'Installation notified to the grid operator',              'Règlement technique',             '{}', null, 10),
        ('yearly_inspection',  'farm',       null, '{}',                                   'operation',       'installer',    'Yearly inspection of the arrays',                         null,                              '{"Inspection report"}', null, 10)
    `);
    roofFr = await insert(db, 'projects', { organisation_id: ORG, name: 'Barn roof', country: 'FR', kind: 'pv_roof', status: 'creation' });
    roofBe = await insert(db, 'projects', { organisation_id: ORG, name: 'Flemish barn roof', country: 'BE', kind: 'pv_roof', status: 'creation' });
    community = await insert(db, 'projects', { organisation_id: ORG, name: 'Farm community', country: 'FR', kind: 'energy_community', status: 'creation' });
  });

  it('keep a template well-formed: a known phase and role, a condition in the one shape of the core, naming what a project has', async () => {
    await expect(db.query(`insert into actions.templates (code, published_by, phase, name) values ('x', 'farm', 'demolition', 'Unknown phase')`)).rejects.toThrow(/foreign key/);
    await expect(db.query(`insert into actions.templates (code, published_by, phase, name, condition) values ('y', 'farm', 'design', 'Bad condition', '{"attribute": {"attribute_type": "installed_power", "op": "~", "value": 1}}')`))
      .rejects.toThrow(/^condition_invalid: an attribute condition is/);
    await expect(db.query(`insert into actions.templates (code, published_by, phase, name, condition) values ('z', 'farm', 'design', 'Bad condition', '{"attribute": {"attribute_type": "installed_power", "op": ">", "value": "ten"}}')`))
      .rejects.toThrow(/^condition_invalid/);
    await expect(db.query(`insert into actions.templates (code, published_by, phase, name, condition) values ('w', 'farm', 'design', 'Bad condition', '{"property": "installed_power"}')`))
      .rejects.toThrow(/^condition_invalid: property is not a key of a condition/);
    await expect(db.query(`insert into actions.templates (code, published_by, phase, name, condition) values ('v', 'farm', 'design', 'For a segment', '{"segment": "individual"}')`))
      .rejects.toThrow(/^condition_invalid: a template is matched against a project/);
    await expect(db.query(`insert into actions.templates (code, published_by, phase, name) values ('prior_declaration', 'overlay:fr', 'design', 'Twice')`)).rejects.toThrow(/templates_once_per_publisher/);
  });

  it('plan the actions of a project from the templates of its country and condition, validated, once', async () => {
    const first = await plan(roofFr);
    expect(first).toEqual({
      project_id: roofFr,
      created: 3,
      existing: 0,
      skipped: [{ code: 'building_permit', published_by: 'overlay:fr', reason: 'attribute_missing', attribute_type: 'installed_power' }],
    });
    const rows = await db.query<{ name: string; phase: string; role: string; source: string; status: string; depends: string | null }>(
      `select t.name, t.phase, t.role, t.source, t.status, d.name depends from actions.actions t left join actions.actions d on d.id = t.depends_on where t.object_id = $1 order by t.phase, t.name`, [roofFr]);
    expect(rows.rows).toEqual([
      { name: 'Electrical conformity certificate obtained', phase: 'commissioning', role: 'installer', source: 'template', status: 'validated', depends: 'Prior declaration of works filed with the municipality' },
      { name: 'Yearly inspection of the arrays', phase: 'operation', role: 'installer', source: 'template', status: 'validated', depends: null },
      { name: 'Prior declaration of works filed with the municipality', phase: 'permitting', role: 'owner', source: 'template', status: 'validated', depends: null },
    ]);
    const again = await plan(roofFr);
    expect(again).toMatchObject({ created: 0, existing: 3 });
    expect((await one<{ n: number }>(db, 'select count(*)::int n from actions.actions where object_id = $1', [roofFr])).n).toBe(3);
  });

  it('apply a condition once the project has the attribute it names', async () => {
    await db.query(`select set_attribute('project', $1, 'installed_power', '36'::jsonb, null, null, 'design')`, [roofFr]);
    expect(await plan(roofFr)).toMatchObject({ created: 0, existing: 3, skipped: [] });
    await db.query(`update attributes set value = '300'::jsonb where object_id = $1 and attribute_type = 'installed_power'`, [roofFr]);
    const bigger = await plan(roofFr);
    expect(bigger).toMatchObject({ created: 1, existing: 3, skipped: [] });
    const permit = await one<{ role: string; phase: string }>(db, `select role, phase from actions.actions where object_id = $1 and name = 'Building permit granted'`, [roofFr]);
    expect(permit).toEqual({ role: 'municipality', phase: 'permitting' });
  });

  it('give another country and another kind their own actions, and nothing of the others', async () => {
    expect(await plan(roofBe)).toMatchObject({ created: 2, existing: 0, skipped: [] });
    const be = await db.query<{ name: string }>('select name from actions.actions where object_id = $1 order by name', [roofBe]);
    expect(be.rows.map((r) => r.name)).toEqual(['Installation notified to the grid operator', 'Yearly inspection of the arrays']);
    expect(await plan(community)).toMatchObject({ created: 2, existing: 0, skipped: [] });
    const fr = await db.query<{ name: string }>('select name from actions.actions where object_id = $1 order by name', [community]);
    expect(fr.rows.map((r) => r.name)).toEqual(['Statutes of the community signed', 'Yearly inspection of the arrays']);
  });

  it('refuse a project that is not there', async () => {
    await expect(plan('00000000-0000-4000-8000-0000000000ff')).rejects.toThrow(/^project_not_found/);
  });

  it('write under row level security: an owner plans, a stranger plans nothing', async () => {
    const mine = await asUser(db, USER_A, () => plan(community));
    expect(mine).toMatchObject({ created: 0, existing: 2 });
    await expect(asUser(db, USER_B, () => plan(community))).rejects.toThrow(/^project_not_found/);
  });
});

describe('three kinds, one lifecycle', () => {
  let setpoint: string;
  let measured: string;
  const made: string[] = [];

  beforeAll(async () => {
    setpoint = await insert(db, 'series', { organisation_id: ORG, object_kind: 'device', object_id: GROUND_ARRAY, quantity_code: 'power', kind: 'setpoint', value_kind: 'instant', name: 'Export limit' });
    measured = await insert(db, 'series', { organisation_id: ORG, object_kind: 'device', object_id: GROUND_ARRAY, quantity_code: 'power', kind: 'measured', value_kind: 'instant', name: 'Output' });
  });

  afterAll(async () => {
    await db.query('delete from actions.actions where id = any($1)', [made]);
  });

  it('reads its kinds from a vocabulary', async () => {
    const kinds = await db.query<{ code: string }>('select code from actions.kinds order by code');
    expect(kinds.rows.map((r) => r.code)).toEqual(['command', 'recommendation', 'step']);
    await expect(action({ object_kind: 'participant', object_id: FARM, phase: 'study', name: 'Unknown kind', kind: 'wish' })).rejects.toThrow(/foreign key|actions_kind/);
  });

  it('a step: from a template or a person, resting on no estimate', async () => {
    const id = (await one<{ id: string }>(db, `select actions.propose('participant', $1, 'operation', 'Clean the panels') id`, [FARM])).id;
    made.push(id);
    expect(await one(db, 'select kind, status from actions.actions where id = $1', [id])).toEqual({ kind: 'step', status: 'proposed' });
    await expect(action({ object_kind: 'participant', object_id: FARM, phase: 'study', name: 'A step on an estimate', estimate_kind: 'solar.estimates', estimate_id: FARM }))
      .rejects.toThrow(/actions_recommendation_estimate/);
  });

  it('a recommendation: proposed, resting on the estimate that gives its gain, and only on one', async () => {
    const id = (await one<{ id: string }>(db,
      `select actions.propose('participant', $1, 'study', 'Add a battery', 'agent', 'battery', 'solar.estimates', $1, 900, 12) id`, [FARM])).id;
    made.push(id);
    expect(await one(db, 'select kind, status from actions.actions where id = $1', [id])).toEqual({ kind: 'recommendation', status: 'proposed' });
    await expect(action({ object_kind: 'participant', object_id: FARM, phase: 'study', name: 'Groundless', kind: 'recommendation' }))
      .rejects.toThrow(/actions_recommendation_estimate/);
  });

  it('a command: a value asked of a device at an instant, on a setpoint series of the device', async () => {
    await expect(db.query(`select actions.command($1, 50, '2026-07-01T12:00:00Z')`, [measured])).rejects.toThrow(/^command_series_invalid/);
    await expect(action({ object_kind: 'participant', object_id: FARM, phase: 'operation', name: 'Not a device', kind: 'command', series_id: setpoint, value: 1, due_at: '2026-07-01T12:00:00Z' }))
      .rejects.toThrow(/actions_command_device/);
    await expect(action({ object_kind: 'device', object_id: GROUND_ARRAY, phase: 'operation', name: 'No instant', kind: 'command', series_id: setpoint, value: 1 }))
      .rejects.toThrow(/actions_command_fields/);
    await expect(action({ object_kind: 'device', object_id: CARPORT_ARRAY, phase: 'operation', name: 'Another device', kind: 'command', series_id: setpoint, value: 1, due_at: '2026-07-01T12:00:00Z' }))
      .rejects.toThrow(/^command_series_invalid/);
    const id = (await one<{ id: string }>(db, `select actions.command($1, 50, '2026-07-01T12:00:00Z', 'Limit export to 50 kW', 'agent', 'export_limit') id`, [setpoint])).id;
    made.push(id);
    expect(await one(db, `select kind, object_kind, object_id, phase, status, value, to_char(due_at at time zone 'UTC', 'HH24:MI') due from actions.actions where id = $1`, [id]))
      .toEqual({ kind: 'command', object_kind: 'device', object_id: GROUND_ARRAY, phase: 'operation', status: 'proposed', value: 50, due: '12:00' });
    await expect(db.query(`select actions.report($1, '2026-07-01T12:00:02Z')`, [id])).rejects.toThrow(/^action_status_invalid: a command is reported once validated/);
    await db.query(`select actions.move($1, 'validated')`, [id]);
    await db.query(`select actions.report($1, '2026-07-01T22:30:00Z')`, [id]);
    // Acknowledged after midnight in Paris: the day is the participant's.
    expect(await one(db, 'select status, actual_start::text s, actual_end::text e, acknowledged_at is not null ack from actions.actions where id = $1', [id]))
      .toEqual({ status: 'done', s: '2026-07-02', e: '2026-07-02', ack: true });
    const effect = await db.query<{ value: number }>(`select value from "window"($1, '2026-07-01', '2026-07-03')`, [setpoint]);
    expect(effect.rows.map((r) => r.value)).toEqual([50]);
    const step = (await one<{ id: string }>(db, `select actions.propose('device', $1, 'operation', 'Inspect') id`, [GROUND_ARRAY])).id;
    made.push(step);
    await expect(db.query(`select actions.report($1, now())`, [step])).rejects.toThrow(/^action_not_command/);
  });

  it('a command refused or not acknowledged fails, says why, writes nothing, and can be proposed again', async () => {
    const id = (await one<{ id: string }>(db, `select actions.command($1, 0, '2026-07-03T08:00:00Z') id`, [setpoint])).id;
    made.push(id);
    await db.query(`select actions.move($1, 'validated')`, [id]);
    await db.query(`select actions.report($1, '2026-07-03T08:00:30Z', 'not acknowledged within 30 s')`, [id]);
    expect(await one(db, 'select status, failure, actual_end from actions.actions where id = $1', [id]))
      .toEqual({ status: 'failed', failure: 'not acknowledged within 30 s', actual_end: null });
    expect((await db.query(`select value from "window"($1, '2026-07-03', '2026-07-04')`, [setpoint])).rows).toEqual([]);
    await expect(db.query(`select actions.move($1, 'dismissed')`, [id])).rejects.toThrow(/^action_status_invalid/);
    await expect(db.query(`select actions.move($1, 'failed', null, ' ')`, [id])).rejects.toThrow(/^action_failure_required/);
    await db.query(`select actions.move($1, 'proposed')`, [id]);
    expect(await one(db, 'select status, failure from actions.actions where id = $1', [id])).toEqual({ status: 'proposed', failure: null });
  });

  it('a step fails too, in the same lifecycle: launched, then failed with why', async () => {
    const id = (await one<{ id: string }>(db, `select actions.propose('participant', $1, 'permitting', 'Permit for the carport') id`, [FARM])).id;
    made.push(id);
    await expect(db.query(`select actions.move($1, 'failed', null, 'refused')`, [id])).rejects.toThrow(/^action_status_invalid: .* not proposed → failed/);
    await db.query(`select actions.move($1, 'validated')`, [id]);
    await db.query(`select actions.move($1, 'launched', '2026-03-01')`, [id]);
    await db.query(`select actions.move($1, 'failed', null, 'Permit refused by the municipality')`, [id]);
    expect(await one(db, 'select kind, status, failure from actions.actions where id = $1', [id])).toEqual({ kind: 'step', status: 'failed', failure: 'Permit refused by the municipality' });
  });
});

describe('the module itself', () => {
  it('installs on the core alone: projects and participants are the core\'s', async () => {
    const alone = await freshDatabase(['actions']);
    try {
      const r = await one<{ n: number }>(alone, `select count(*)::int n from modules`);
      expect(r.n).toBe(1);
    } finally {
      await alone.close();
    }
  });
});
