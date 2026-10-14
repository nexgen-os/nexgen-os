// The `construction` module: the milestones of the works on the farm of
// example 4, from the permit to the commissioning of the ground array, who
// answers for each, what is late on a given day, and where the works of
// the site and of a project stand.
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

const progress = async (objectId: string, on: string, scenarioId: string | null = null): Promise<Progress> =>
  (await one<{ p: Progress }>(db, 'select construction.progress($1, $2, $3) p', [objectId, on, scenarioId])).p;

const milestone = (fields: Record<string, unknown>) => insert(db, 'construction.milestones', { organisation_id: ORG, ...fields });

beforeAll(async () => {
  db = await freshDatabase(['construction']);
  await db.exec(await readFile(join(repoRoot, 'examples', '04-farm-solar.sql'), 'utf8'));
  await db.query('insert into auth.users (id) values ($1), ($2) on conflict do nothing', [USER_A, USER_B]);
  await db.query(`insert into organisation_members (organisation_id, user_id, role) values ($1, $2, 'owner')`, [ORG, USER_A]);
  await organisation(db, 'Another farm', USER_B);
  installer = (await one<{ id: string }>(db, `insert into contacts (organisation_id, name) values ($1, 'Solaire du Nord') returning id`, [ORG])).id;

  await milestone({ subject_id: SITE, phase: 'permitting', name: 'Building permit for the ground array', status: 'done', planned_end: '2026-02-28', actual_start: '2026-01-05', actual_end: '2026-02-20' });
  await milestone({ subject_id: GROUND_ARRAY, phase: 'procurement', name: 'Panels delivered', status: 'done', planned_end: '2026-04-30', actual_start: '2026-04-28', actual_end: '2026-04-28', responsible_contact_id: installer });
  installed = await milestone({
    subject_id: GROUND_ARRAY, phase: 'installation', name: 'Ground array mounted and wired', status: 'in_progress',
    planned_start: '2026-05-04', planned_end: '2026-05-29', actual_start: '2026-05-11', responsible_contact_id: installer,
  });
  await milestone({ subject_id: GROUND_ARRAY, phase: 'grid_connection', name: 'Injection point energised', planned_start: '2026-08-01', planned_end: '2026-09-30' });
  await milestone({ subject_id: GROUND_ARRAY, phase: 'commissioning', name: 'Ground array commissioned', planned_end: '2026-10-31' });
  await milestone({ subject_id: CARPORT_ARRAY, phase: 'installation', name: 'Carport built', status: 'cancelled', planned_end: '2026-06-30' });
});

afterAll(async () => {
  await db.close();
});

describe('milestones', () => {
  it('are objects on the site of what they are about, so that a photo or a report attaches to them', async () => {
    const m = await one<{ kind: string; site: string }>(db, 'select o.kind, site_of(o.id) site from objects o where o.id = $1', [installed]);
    expect(m).toEqual({ kind: 'milestone', site: SITE });
    await db.query(
      `insert into documents (object_id, name, kind, uri, media_type, source) values ($1, 'Rows 1 to 12 mounted', 'image', 's3://farm/rows-1-12.jpg', 'image/jpeg', 'site manager')`,
      [installed],
    );
    const d = await one<{ organisation_id: string }>(db, 'select organisation_id from documents where object_id = $1', [installed]);
    expect(d.organisation_id).toBe(ORG);
  });

  it('come in phases read from a vocabulary, in their usual order', async () => {
    const phases = await db.query<{ code: string }>('select code from construction.phases order by position');
    expect(phases.rows.map((r) => r.code)).toEqual(['design', 'permitting', 'procurement', 'site_preparation', 'installation', 'grid_connection', 'commissioning', 'handover']);
    await expect(milestone({ subject_id: SITE, phase: 'demolition', name: 'Unknown phase' })).rejects.toThrow(/foreign key/);
  });

  it('keep their dates and status consistent', async () => {
    await expect(milestone({ subject_id: SITE, phase: 'design', name: 'Done without an end', status: 'done', actual_start: '2026-01-01' }))
      .rejects.toThrow(/milestones_done/);
    await expect(milestone({ subject_id: SITE, phase: 'design', name: 'Ended but not done', actual_end: '2026-01-01' }))
      .rejects.toThrow(/milestones_done/);
    await expect(milestone({ subject_id: SITE, phase: 'design', name: 'Started without a start', status: 'in_progress' }))
      .rejects.toThrow(/milestones_started/);
    await expect(milestone({ subject_id: SITE, phase: 'design', name: 'Backwards', planned_start: '2026-03-01', planned_end: '2026-02-01' }))
      .rejects.toThrow(/milestones_planned_order/);
    await expect(milestone({ subject_id: SITE, phase: 'design', name: 'Unknown status', status: 'paused' }))
      .rejects.toThrow(/milestones_status/);
  });

  it('stay in their organisation: subject and contact', async () => {
    const other = await one<{ id: string }>(db, `select id from organisations where name = 'Another farm'`);
    const theirSite = await insert(db, 'sites', { organisation_id: other.id, name: 'Their field', country: 'FR' });
    await expect(milestone({ subject_id: theirSite, phase: 'design', name: 'Not ours' })).rejects.toThrow(/^parent_in_other_organisation/);
    const theirContact = (await one<{ id: string }>(db, `insert into contacts (organisation_id, name) values ($1, 'Their installer') returning id`, [other.id])).id;
    await expect(milestone({ subject_id: SITE, phase: 'design', name: 'Their contact', responsible_contact_id: theirContact }))
      .rejects.toThrow(/^contact_in_other_organisation/);
  });
});

describe('where the works stand', () => {
  it('sums the milestones of the site up on a day: by status, share done, the late ones, the current phase', async () => {
    const p = await progress(SITE, '2026-06-15');
    expect(p).toEqual({
      on: '2026-06-15',
      total: 6,
      by_status: { done: 2, in_progress: 1, planned: 2, cancelled: 1 },
      done_share: 0.4,
      late: [{ id: installed, name: 'Ground array mounted and wired', phase: 'installation', planned_end: '2026-05-29' }],
      current_phase: 'installation',
    });
  });

  it('gives the same answer for the same day, and another for another day', async () => {
    expect(await progress(SITE, '2026-06-15')).toEqual(await progress(SITE, '2026-06-15'));
    const early = await progress(SITE, '2026-05-01');
    expect(early.late).toEqual([]);
    const autumn = await progress(SITE, '2026-10-15');
    expect(autumn.late.map((l) => l.phase)).toEqual(['installation', 'grid_connection']);
  });

  it('moves when a milestone is done', async () => {
    await db.query(`update construction.milestones set status = 'done', actual_end = '2026-06-19' where id = $1`, [installed]);
    const p = await progress(SITE, '2026-06-22');
    expect(p.done_share).toBe(0.6);
    expect(p.late).toEqual([]);
    expect(p.current_phase).toBe('grid_connection');
  });

  it('adds the milestones of a scenario only when asked', async () => {
    const scenario = await one<{ id: string }>(db, `insert into scenarios (organisation_id, name) values ($1, 'Battery later') returning id`, [ORG]);
    await milestone({ subject_id: SITE, phase: 'installation', name: 'Battery installed', planned_end: '2027-03-31', scenario_id: scenario.id });
    expect((await progress(SITE, '2026-06-22')).total).toBe(6);
    expect((await progress(SITE, '2026-06-22', scenario.id)).total).toBe(7);
  });

  it('sums a project up: its own milestones and those of every site taking part', async () => {
    const project = await insert(db, 'projects', { organisation_id: ORG, name: 'Mont Noir solar works', country: 'FR', status: 'creation' });
    await insert(db, 'participants', { organisation_id: ORG, project_id: project, site_id: SITE, name: 'The farm', role: 'prosumer' });
    await milestone({ subject_id: project, phase: 'design', name: 'Grid study accepted', status: 'done', actual_start: '2025-11-03', actual_end: '2025-12-15' });
    const p = await progress(project, '2026-06-22');
    expect(p.total).toBe(7);
    expect(p.by_status.done).toBe(4);
  });

  it('reads under row level security: a stranger sees no milestone', async () => {
    const mine = await asUser(db, USER_A, () => one<{ p: Progress }>(db, `select construction.progress($1, '2026-06-22') p`, [SITE]));
    expect(mine.p.total).toBe(6);
    const theirs = await asUser(db, USER_B, () => one<{ p: Progress }>(db, `select construction.progress($1, '2026-06-22') p`, [SITE]));
    expect(theirs.p).toMatchObject({ total: 0, by_status: {}, done_share: null, late: [], current_phase: null });
    await expect(asUser(db, USER_B, () => db.query(`update construction.milestones set notes = 'x' returning id`)))
      .resolves.toMatchObject({ rows: [] });
  });
});
