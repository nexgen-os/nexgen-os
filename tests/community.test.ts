// An energy community, with the `community` and `grid` modules: a project,
// three sites each behind its own connection point, taking part as
// participants with the company that answers for each, a shared PV plant on
// a fourth site, a group of participants, a meter swapped without losing the
// connection point, and the values of a register.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase, insert, one, organisation } from './helpers/db.js';

let db: PGlite;
let org: string;
let project: string;
const sites: string[] = [];
const meters: string[] = [];
const participants: string[] = [];

beforeAll(async () => {
  db = await freshDatabase(['community', 'grid']);
  org = await organisation(db, 'A cooperative');
  project = await insert(db, 'community.projects', { organisation_id: org, name: 'Harbour community', kind: 'energy_community', country: 'NL', status: 'active' });
  for (const n of [1, 2, 3]) {
    const site = await insert(db, 'sites', { organisation_id: org, name: `Unit ${n}`, country: 'NL', city: 'Rotterdam', time_zone: 'Europe/Amsterdam', profile: 'warehouse' });
    const meter = (await one<{ id: string }>(db, `select grid.declare_meter($1, $2, 'gs1_gsrn') id`, [site, `87100000000000000${n}`])).id;
    const tenant = await insert(db, 'contacts', { organisation_id: org, name: `Tenant ${n}`, kind: 'company' });
    const participant = (await one<{ id: string }>(
      db, `select community.join_project($1, $2, $3, 'consumer', $4, '2025-01-01', 'active') id`, [project, site, `Tenant ${n}`, tenant])).id;
    sites.push(site);
    meters.push(meter);
    participants.push(participant);
  }
  const plant = await insert(db, 'sites', { organisation_id: org, name: 'Roof plant', country: 'NL', profile: 'plant' });
  const plantMeter = await insert(db, 'grid.meters', { organisation_id: org, site_id: plant, identifier: '871000000000000009', scheme: 'gs1_gsrn', direction: 'injection' });
  const array = await insert(db, 'devices', { organisation_id: org, site_id: plant, name: 'Shared roof array', device_type: 'solar', rated_power_kw: 250 });
  await db.query(`select link_objects($1, 'behind_meter', $2)`, [array, plantMeter]);
  await insert(db, 'community.participants', { organisation_id: org, project_id: project, site_id: plant, name: 'Roof plant', role: 'producer', status: 'active' });
});

afterAll(async () => {
  await db.close();
});

describe('an energy community', () => {
  it('lists its participants with their site, their meter and who answers for them', async () => {
    const r = await db.query<{ participant: string; role: string; meter: string; contact: string | null }>(
      `select p.name participant, p.role, m.identifier meter, c.name contact
         from community.participants p
         join grid.meters m on m.site_id = p.site_id
         left join contacts c on c.id = p.contact_id
        where p.project_id = $1
        order by p.role, p.name`,
      [project],
    );
    expect(r.rows).toEqual([
      { participant: 'Tenant 1', role: 'consumer', meter: '871000000000000001', contact: 'Tenant 1' },
      { participant: 'Tenant 2', role: 'consumer', meter: '871000000000000002', contact: 'Tenant 2' },
      { participant: 'Tenant 3', role: 'consumer', meter: '871000000000000003', contact: 'Tenant 3' },
      { participant: 'Roof plant', role: 'producer', meter: '871000000000000009', contact: null },
    ]);
  });

  it('refuses the same site twice in a project, a metering number that is not one, and a connection point declared twice', async () => {
    await expect(
      db.query(`select community.join_project($1, $2, 'Again')`, [project, sites[0]]),
    ).rejects.toThrow(/participant_site_already_in_project/);
    await expect(
      db.query(`select grid.declare_meter($1, '12AB', 'gs1_gsrn')`, [sites[0]]),
    ).rejects.toThrow(/invalid_identifier/);
    await expect(
      db.query(`select grid.declare_meter($1, '871000000000000001', 'gs1_gsrn')`, [sites[0]]),
    ).rejects.toThrow(/meter_already_open/);
  });

  it('lets a participant leave and come back, never overlapping itself', async () => {
    await db.query(`select community.leave_project($1, '2025-12-31')`, [participants[2]]);
    await expect(db.query(`select community.leave_project($1)`, [participants[2]])).rejects.toThrow(/participant_not_in_project/);
    await expect(db.query(`select community.join_project($1, $2, 'Back too early', 'consumer', null, '2025-06-01')`, [project, sites[2]]))
      .rejects.toThrow(/participant_site_already_in_project/);
    const back = await one<{ id: string }>(db, `select community.join_project($1, $2, 'Back', 'consumer', null, '2026-02-01') id`, [project, sites[2]]);
    expect(back.id).toBeTruthy();
  });

  it('groups participants, and finds the meters behind a group', async () => {
    const group = await insert(db, 'community.participants', { organisation_id: org, project_id: project, name: 'Tenants 1 and 2' });
    await db.query('update community.participants set parent_id = $1 where id = any ($2)', [group, [participants[0], participants[1]]]);
    const r = await db.query<{ meter_id: string }>('select meter_id from community.participant_meters($1) order by 1', [group]);
    expect(r.rows.map((x) => x.meter_id).sort()).toEqual([meters[0], meters[1]].sort());
    await expect(
      db.query('update community.participants set parent_id = $1 where id = $2', [participants[0], participants[2]]),
    ).rejects.toThrow(/participant_parent_not_a_group/);
  });

  it('swaps the physical meter and keeps the connection point', async () => {
    const old = await one<{ id: string }>(db, `select install_device($1, 'meter', 'Meter A', '{}', null, null, '2015-03-01') id`, [sites[0]]);
    await db.query(`select link_objects($1, 'behind_meter', $2, '2015-03-01')`, [old.id, meters[0]]);
    const swapped = await one<{ id: string }>(db, `select replace_device($1, '2026-03-01', null, 'Meter B') id`, [old.id]);
    await db.query(`select link_objects($1, 'behind_meter', $2, '2026-03-01')`, [swapped.id, meters[0]]);
    const r = await one<{ name: string; identifier: string; replaces: string }>(
      db,
      `select d.name, m.identifier, (select object_id from links where subject_id = d.id and type_code = 'replaces') replaces
         from devices d join links l on l.subject_id = d.id and l.type_code = 'behind_meter' join grid.meters m on m.id = l.object_id
        where m.id = $1 and d.device_type = 'meter' and d.status = 'in_service'`,
      [meters[0]],
    );
    expect(r).toEqual({ name: 'Meter B', identifier: '871000000000000001', replaces: old.id });
    const retired = await one<{ status: string }>(db, 'select status from devices where id = $1', [old.id]);
    expect(retired.status).toBe('removed');
    await expect(db.query(`select replace_device($1)`, [old.id])).rejects.toThrow(/device_retired/);
  });

  it('closes a connection point when its register retires the number', async () => {
    await db.query(`select grid.close_meter($1, '2026-06-30')`, [meters[2]]);
    await expect(db.query(`select grid.close_meter($1)`, [meters[2]])).rejects.toThrow(/meter_not_open/);
    const reissued = await one<{ id: string }>(db, `select grid.declare_meter($1, '871000000000000003', 'gs1_gsrn', 'electricity', 'both', null, '2026-07-01') id`, [sites[2]]);
    expect(reissued.id).not.toBe(meters[2]);
  });

  it('records who occupies a site for a period, and refuses a link whose kinds do not fit', async () => {
    await db.query(
      `insert into links (subject_id, type_code, object_id, valid_from) values ($1, 'occupies', $2, '2025-01-01')`,
      [participants[0], sites[0]],
    );
    await expect(
      db.query(`insert into links (subject_id, type_code, object_id) values ($1, 'occupies', $2)`, [sites[0], sites[1]]),
    ).rejects.toThrow(/link_subject_kind/);
  });

  it('reads a cumulative register as the consumption of each step, and its index as a window', async () => {
    const register = await one<{ id: string }>(
      db,
      `insert into series (object_id, quantity_code, kind, value_kind, source) values ($1, 'offtake_energy', 'measured', 'cumulative', 'dso') returning id`,
      [meters[1]],
    );
    await db.query(
      `insert into series_values (series_id, at, value) values ($1, '2026-04-01 00:00+00', 1000), ($1, '2026-04-01 12:00+00', 1012), ($1, '2026-04-02 00:00+00', 1030)`,
      [register.id],
    );
    const r = await db.query<{ value: number }>(`select value from resample($1, '2026-04-01', '2026-04-03', '1 day')`, [register.id]);
    // 1000 → 1012 → 1030: both increments start on the first day.
    expect(r.rows.map((x) => x.value)).toEqual([30]);
    const index = await db.query<{ value: number }>(`select value from nexgen.window($1, '2026-04-01', '2026-04-03')`, [register.id]);
    expect(index.rows.map((x) => x.value)).toEqual([1000, 1012, 1030]);
  });

  it('lets the same site take part in a second project', async () => {
    const portfolio = await insert(db, 'community.projects', { organisation_id: org, name: 'Harbour portfolio', kind: 'portfolio', country: 'NL' });
    const again = await insert(db, 'community.participants', { organisation_id: org, project_id: portfolio, site_id: sites[0], name: 'Unit 1', role: 'consumer' });
    const r = await one<{ n: number }>(db, 'select count(*)::int n from community.participants where site_id = $1', [sites[0]]);
    expect(again).toBeTruthy();
    expect(r.n).toBe(2);
  });
});
