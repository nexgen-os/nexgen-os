// The `tasks` module: the tasks of the works on the farm of example 4, from
// the permit to the commissioning of the ground array, who carries each,
// what is late on a given day, where the site and a project stand; and the
// tasks a project gets from the templates of its country and kind.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, USER_B, asUser, freshDatabase, insert, one, organisation, repoRoot } from './helpers/db.js';

const ORG = '00000000-0000-4000-8000-000400000001';
const SITE = '00000000-0000-4000-8000-000400000010';
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
  skipped: { code: string; published_by: string; reason: string; property: string }[];
}

const progress = async (objectId: string, on: string, scenarioId: string | null = null): Promise<Progress> =>
  (await one<{ p: Progress }>(db, 'select tasks.progress($1, $2, $3) p', [objectId, on, scenarioId])).p;

const plan = async (projectId: string, scenarioId: string | null = null): Promise<Plan> =>
  (await one<{ p: Plan }>(db, 'select tasks.plan($1, $2) p', [projectId, scenarioId])).p;

const task = (fields: Record<string, unknown>) => insert(db, 'tasks.tasks', { organisation_id: ORG, ...fields });

beforeAll(async () => {
  db = await freshDatabase(['tasks']);
  await db.exec(await readFile(join(repoRoot, 'examples', '04-farm-solar.sql'), 'utf8'));
  await db.query('insert into auth.users (id) values ($1), ($2) on conflict do nothing', [USER_A, USER_B]);
  await db.query(`insert into organisation_members (organisation_id, user_id, role) values ($1, $2, 'owner')`, [ORG, USER_A]);
  await organisation(db, 'Another farm', USER_B);
  installer = (await one<{ id: string }>(db, `insert into contacts (organisation_id, name) values ($1, 'Solaire du Nord') returning id`, [ORG])).id;

  await task({ subject_id: SITE, phase: 'permitting', role: 'municipality', name: 'Building permit for the ground array', status: 'done', planned_end: '2026-02-28', actual_start: '2026-01-05', actual_end: '2026-02-20' });
  await task({ subject_id: GROUND_ARRAY, phase: 'procurement', role: 'installer', name: 'Panels delivered', status: 'done', planned_end: '2026-04-30', actual_start: '2026-04-28', actual_end: '2026-04-28', responsible_contact_id: installer });
  installed = await task({
    subject_id: GROUND_ARRAY, phase: 'installation', role: 'installer', name: 'Ground array mounted and wired', status: 'in_progress',
    planned_start: '2026-05-04', planned_end: '2026-05-29', actual_start: '2026-05-11', responsible_contact_id: installer,
  });
  await task({ subject_id: GROUND_ARRAY, phase: 'grid_connection', role: 'grid_operator', name: 'Injection point energised', planned_start: '2026-08-01', planned_end: '2026-09-30' });
  await task({ subject_id: GROUND_ARRAY, phase: 'commissioning', name: 'Ground array commissioned', planned_end: '2026-10-31' });
  await task({ subject_id: CARPORT_ARRAY, phase: 'installation', name: 'Carport built', status: 'cancelled', planned_end: '2026-06-30' });
});

afterAll(async () => {
  await db.close();
});

describe('tasks', () => {
  it('are objects on the site of what they are about, so that a photo or a certificate attaches to them', async () => {
    const m = await one<{ kind: string; site: string }>(db, 'select o.kind, site_of(o.id) site from objects o where o.id = $1', [installed]);
    expect(m).toEqual({ kind: 'task', site: SITE });
    await db.query(
      `insert into documents (object_id, name, kind, uri, media_type, source) values ($1, 'Rows 1 to 12 mounted', 'image', 's3://farm/rows-1-12.jpg', 'image/jpeg', 'site manager')`,
      [installed],
    );
    const d = await one<{ organisation_id: string }>(db, 'select organisation_id from documents where object_id = $1', [installed]);
    expect(d.organisation_id).toBe(ORG);
  });

  it('come in phases read from a vocabulary that covers the life of a project', async () => {
    const phases = await db.query<{ code: string }>('select code from tasks.phases order by position');
    expect(phases.rows.map((r) => r.code)).toEqual([
      'study', 'design', 'permitting', 'financing', 'procurement', 'site_preparation',
      'installation', 'grid_connection', 'commissioning', 'handover', 'operation', 'decommissioning',
    ]);
    await expect(task({ subject_id: SITE, phase: 'demolition', name: 'Unknown phase' })).rejects.toThrow(/foreign key/);
  });

  it('are carried by a role read from a vocabulary', async () => {
    const roles = await db.query<{ code: string }>('select code from tasks.roles order by code');
    expect(roles.rows.map((r) => r.code)).toEqual(['community_manager', 'financer', 'grid_operator', 'installer', 'municipality', 'notary', 'owner', 'regulator']);
    await expect(task({ subject_id: SITE, phase: 'design', role: 'wizard', name: 'Unknown role' })).rejects.toThrow(/foreign key/);
  });

  it('keep their dates, status and source consistent', async () => {
    await expect(task({ subject_id: SITE, phase: 'design', name: 'Done without an end', status: 'done', actual_start: '2026-01-01' }))
      .rejects.toThrow(/tasks_done/);
    await expect(task({ subject_id: SITE, phase: 'design', name: 'Ended but not done', actual_end: '2026-01-01' }))
      .rejects.toThrow(/tasks_done/);
    await expect(task({ subject_id: SITE, phase: 'design', name: 'Started without a start', status: 'in_progress' }))
      .rejects.toThrow(/tasks_started/);
    await expect(task({ subject_id: SITE, phase: 'design', name: 'Backwards', planned_start: '2026-03-01', planned_end: '2026-02-01' }))
      .rejects.toThrow(/tasks_planned_order/);
    await expect(task({ subject_id: SITE, phase: 'design', name: 'Unknown status', status: 'paused' }))
      .rejects.toThrow(/tasks_status/);
    await expect(task({ subject_id: SITE, phase: 'design', name: 'Unknown source', source: 'dream' }))
      .rejects.toThrow(/tasks_source/);
    const fromAction = await task({ subject_id: SITE, phase: 'study', name: 'Battery sizing study', source: 'action', source_ref: 'storage_investment' });
    expect((await one<{ source: string }>(db, 'select source from tasks.tasks where id = $1', [fromAction])).source).toBe('action');
  });

  it('stay in their organisation: subject, contact and dependency', async () => {
    const other = await one<{ id: string }>(db, `select id from organisations where name = 'Another farm'`);
    const theirSite = await insert(db, 'sites', { organisation_id: other.id, name: 'Their field', country: 'FR' });
    await expect(task({ subject_id: theirSite, phase: 'design', name: 'Not ours' })).rejects.toThrow(/^parent_in_other_organisation/);
    const theirContact = (await one<{ id: string }>(db, `insert into contacts (organisation_id, name) values ($1, 'Their installer') returning id`, [other.id])).id;
    await expect(task({ subject_id: SITE, phase: 'design', name: 'Their contact', responsible_contact_id: theirContact }))
      .rejects.toThrow(/^contact_in_other_organisation/);
    const theirs = await insert(db, 'tasks.tasks', { organisation_id: other.id, subject_id: theirSite, phase: 'design', name: 'Their study' });
    await expect(task({ subject_id: SITE, phase: 'design', name: 'Waits for theirs', depends_on: theirs }))
      .rejects.toThrow(/^dependency_in_other_organisation/);
  });
});

describe('where a project stands', () => {
  it('sums the tasks of the site up on a day: by status, share done, the late ones, the current phase', async () => {
    const p = await progress(SITE, '2026-06-15');
    expect(p).toEqual({
      on: '2026-06-15',
      total: 7,
      by_status: { done: 2, in_progress: 1, planned: 3, cancelled: 1 },
      done_share: 0.3333,
      late: [{ id: installed, name: 'Ground array mounted and wired', phase: 'installation', planned_end: '2026-05-29' }],
      current_phase: 'study',
    });
  });

  it('gives the same answer for the same day, and another for another day', async () => {
    expect(await progress(SITE, '2026-06-15')).toEqual(await progress(SITE, '2026-06-15'));
    const early = await progress(SITE, '2026-05-01');
    expect(early.late).toEqual([]);
    const autumn = await progress(SITE, '2026-10-15');
    expect(autumn.late.map((l) => l.phase)).toEqual(['installation', 'grid_connection']);
  });

  it('moves when a task is done', async () => {
    await db.query(`update tasks.tasks set status = 'done', actual_end = '2026-06-19' where id = $1`, [installed]);
    await db.query(`update tasks.tasks set status = 'cancelled' where name = 'Battery sizing study'`);
    const p = await progress(SITE, '2026-06-22');
    expect(p.done_share).toBe(0.6);
    expect(p.late).toEqual([]);
    expect(p.current_phase).toBe('grid_connection');
  });

  it('adds the tasks of a scenario only when asked', async () => {
    const scenario = await one<{ id: string }>(db, `insert into scenarios (organisation_id, name) values ($1, 'Battery later') returning id`, [ORG]);
    await task({ subject_id: SITE, phase: 'installation', name: 'Battery installed', planned_end: '2027-03-31', scenario_id: scenario.id });
    expect((await progress(SITE, '2026-06-22')).total).toBe(7);
    expect((await progress(SITE, '2026-06-22', scenario.id)).total).toBe(8);
  });

  it('sums a project up: its own tasks and those of every site taking part', async () => {
    const project = await insert(db, 'projects', { organisation_id: ORG, name: 'Mont Noir solar works', country: 'FR', status: 'creation' });
    await insert(db, 'participants', { organisation_id: ORG, project_id: project, site_id: SITE, name: 'The farm', role: 'prosumer' });
    await task({ subject_id: project, phase: 'design', name: 'Grid study accepted', status: 'done', actual_start: '2025-11-03', actual_end: '2025-12-15' });
    const p = await progress(project, '2026-06-22');
    expect(p.total).toBe(8);
    expect(p.by_status.done).toBe(4);
  });

  it('reads under row level security: a stranger sees no task', async () => {
    const mine = await asUser(db, USER_A, () => one<{ p: Progress }>(db, `select tasks.progress($1, '2026-06-22') p`, [SITE]));
    expect(mine.p.total).toBe(7);
    const theirs = await asUser(db, USER_B, () => one<{ p: Progress }>(db, `select tasks.progress($1, '2026-06-22') p`, [SITE]));
    expect(theirs.p).toMatchObject({ total: 0, by_status: {}, done_share: null, late: [], current_phase: null });
    await expect(asUser(db, USER_B, () => db.query(`update tasks.tasks set notes = 'x' where subject_id = $1 returning id`, [SITE])))
      .resolves.toMatchObject({ rows: [] });
  });
});

describe('what has to be done, from the templates of a country and a kind of project', () => {
  let roofFr: string;
  let roofBe: string;
  let community: string;

  beforeAll(async () => {
    // Templates as a pack would publish them: two countries, two kinds, one
    // condition, one dependency.
    await db.query(`
      insert into tasks.templates (code, published_by, country, project_kind, phase, role, name, legal_reference, documents, applies_when, depends_on_code, position) values
        ('prior_declaration',  'pack:fr', 'FR', 'pv_roof',          'permitting',      'owner',        'Prior declaration of works filed with the municipality', 'Code de l''urbanisme, R. 421-17', '{"Cerfa 13703"}', null, null, 10),
        ('consuel',            'pack:fr', 'FR', 'pv_roof',          'commissioning',   'installer',    'Electrical conformity certificate obtained',             'Décret 72-1120',                  '{"Attestation de conformité"}', null, 'prior_declaration', 20),
        ('building_permit',    'pack:fr', 'FR', 'pv_roof',          'permitting',      'municipality', 'Building permit granted',                                 'Code de l''urbanisme, R. 421-1',  '{}', '{"property": "installed_power", "op": ">", "value": 250}', null, 15),
        ('statutes',           'pack:fr', 'FR', 'energy_community', 'design',          'notary',       'Statutes of the community signed',                        'Code de l''énergie, L. 291-1',    '{"Statuts"}', null, null, 10),
        ('dso_notification',   'pack:be', 'BE', 'pv_roof',          'grid_connection', 'owner',        'Installation notified to the grid operator',              'Règlement technique',             '{}', null, null, 10),
        ('yearly_inspection',  'farm',    null, null,               'operation',       'installer',    'Yearly inspection of the arrays',                         null,                              '{"Inspection report"}', null, null, 10)
    `);
    roofFr = await insert(db, 'projects', { organisation_id: ORG, name: 'Barn roof', country: 'FR', kind: 'pv_roof', status: 'creation' });
    roofBe = await insert(db, 'projects', { organisation_id: ORG, name: 'Flemish barn roof', country: 'BE', kind: 'pv_roof', status: 'creation' });
    community = await insert(db, 'projects', { organisation_id: ORG, name: 'Mont Noir community', country: 'FR', kind: 'energy_community', status: 'creation' });
  });

  it('keep a template well-formed: a known phase and role, a condition with a property, an operator and a number', async () => {
    await expect(db.query(`insert into tasks.templates (code, published_by, phase, name) values ('x', 'farm', 'demolition', 'Unknown phase')`)).rejects.toThrow(/foreign key/);
    await expect(db.query(`insert into tasks.templates (code, published_by, phase, name, applies_when) values ('y', 'farm', 'design', 'Bad condition', '{"property": "installed_power", "op": "~", "value": 1}')`))
      .rejects.toThrow(/templates_applies_when_shape/);
    await expect(db.query(`insert into tasks.templates (code, published_by, phase, name, applies_when) values ('z', 'farm', 'design', 'Bad condition', '{"property": "installed_power", "op": ">", "value": "ten"}')`))
      .rejects.toThrow(/templates_applies_when_shape/);
    await expect(db.query(`insert into tasks.templates (code, published_by, phase, name) values ('prior_declaration', 'pack:fr', 'design', 'Twice')`)).rejects.toThrow(/templates_once_per_publisher/);
  });

  it('plan the tasks of a project from the templates of its country and kind, once', async () => {
    const first = await plan(roofFr);
    expect(first).toEqual({
      project_id: roofFr,
      created: 3,
      existing: 0,
      skipped: [{ code: 'building_permit', published_by: 'pack:fr', reason: 'attribute_missing', property: 'installed_power' }],
    });
    const rows = await db.query<{ name: string; phase: string; role: string; source: string; depends: string | null }>(
      `select t.name, t.phase, t.role, t.source, d.name depends from tasks.tasks t left join tasks.tasks d on d.id = t.depends_on where t.subject_id = $1 order by t.phase, t.name`, [roofFr]);
    expect(rows.rows).toEqual([
      { name: 'Electrical conformity certificate obtained', phase: 'commissioning', role: 'installer', source: 'template', depends: 'Prior declaration of works filed with the municipality' },
      { name: 'Yearly inspection of the arrays', phase: 'operation', role: 'installer', source: 'template', depends: null },
      { name: 'Prior declaration of works filed with the municipality', phase: 'permitting', role: 'owner', source: 'template', depends: null },
    ]);
    const again = await plan(roofFr);
    expect(again).toMatchObject({ created: 0, existing: 3 });
    expect((await one<{ n: number }>(db, 'select count(*)::int n from tasks.tasks where subject_id = $1', [roofFr])).n).toBe(3);
  });

  it('apply a condition once the project has the attribute it names', async () => {
    await db.query(`insert into attributes (object_id, property_code, value, source) values ($1, 'installed_power', '36'::jsonb, 'design')`, [roofFr]);
    expect(await plan(roofFr)).toMatchObject({ created: 0, existing: 3, skipped: [] });
    await db.query(`update attributes set value = '300'::jsonb where object_id = $1 and property_code = 'installed_power'`, [roofFr]);
    const bigger = await plan(roofFr);
    expect(bigger).toMatchObject({ created: 1, existing: 3, skipped: [] });
    const permit = await one<{ role: string; phase: string }>(db, `select role, phase from tasks.tasks where subject_id = $1 and name = 'Building permit granted'`, [roofFr]);
    expect(permit).toEqual({ role: 'municipality', phase: 'permitting' });
  });

  it('give another country and another kind their own tasks, and nothing of the others', async () => {
    expect(await plan(roofBe)).toMatchObject({ created: 2, existing: 0, skipped: [] });
    const be = await db.query<{ name: string }>('select name from tasks.tasks where subject_id = $1 order by name', [roofBe]);
    expect(be.rows.map((r) => r.name)).toEqual(['Installation notified to the grid operator', 'Yearly inspection of the arrays']);
    expect(await plan(community)).toMatchObject({ created: 2, existing: 0, skipped: [] });
    const fr = await db.query<{ name: string }>('select name from tasks.tasks where subject_id = $1 order by name', [community]);
    expect(fr.rows.map((r) => r.name)).toEqual(['Statutes of the community signed', 'Yearly inspection of the arrays']);
  });

  it('plan a scenario on its own, and refuse a project that is not there', async () => {
    const scenario = await one<{ id: string }>(db, `insert into scenarios (organisation_id, name) values ($1, 'Bigger roof') returning id`, [ORG]);
    expect(await plan(roofBe, scenario.id)).toMatchObject({ created: 2, existing: 0 });
    expect((await progress(roofBe, '2026-06-22')).total).toBe(2);
    expect((await progress(roofBe, '2026-06-22', scenario.id)).total).toBe(4);
    await expect(plan('00000000-0000-4000-8000-0000000000ff')).rejects.toThrow(/^project_not_found/);
  });

  it('write under row level security: an owner plans, a stranger plans nothing', async () => {
    const mine = await asUser(db, USER_A, () => plan(community));
    expect(mine).toMatchObject({ created: 0, existing: 2 });
    await expect(asUser(db, USER_B, () => plan(community))).rejects.toThrow(/^project_not_found/);
  });
});
