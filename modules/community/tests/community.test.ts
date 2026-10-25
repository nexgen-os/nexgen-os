// An energy community, on the projects, participants and meters of the core
// with the `community` and `grid` modules installed beside them: a project,
// three tenants taking part as participants, each carrying its place, its
// meter and the company that answers for it, a shared PV plant as a fourth
// participant with its array behind its meter, a group of participants, a
// meter swapped without losing the connection point, and the values of a
// register.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase, insert, one, organisation } from '../../../tests/helpers/db.js';

let db: PGlite;
let org: string;
let project: string;
const meters: string[] = [];
const participants: string[] = [];

const unit = (n: number) => JSON.stringify({ address_line1: `Harbour ${n}`, city: 'Rotterdam', country: 'NL' });

beforeAll(async () => {
  db = await freshDatabase(['community', 'grid']);
  org = await organisation(db, 'A cooperative');
  project = await insert(db, 'projects', { organisation_id: org, name: 'Harbour community', kind: 'energy_community', country: 'NL', status: 'active' });
  for (const n of [1, 2, 3]) {
    const tenant = await insert(db, 'contacts', { organisation_id: org, name: `Tenant ${n}`, kind: 'company' });
    const participant = (await one<{ id: string }>(
      db, `select join_project($1, $2, $3, 'consumer', $4, '2025-01-01', 'active', 'Europe/Amsterdam') id`, [project, `Tenant ${n}`, unit(n), tenant])).id;
    const meter = (await one<{ id: string }>(db, `select declare_meter($1, $2, 'gs1_gsrn', p_valid_from => '2025-01-01') id`, [participant, `87100000000000000${n}`])).id;
    meters.push(meter);
    participants.push(participant);
  }
  const plant = (await one<{ id: string }>(
    db, `select join_project($1, 'Roof plant', $2, 'producer', p_status => 'active') id`, [project, unit(9)])).id;
  await insert(db, 'meters', { organisation_id: org, participant_id: plant, identifier: '871000000000000009', scheme: 'gs1_gsrn', direction: 'injection' });
  await insert(db, 'devices', { organisation_id: org, participant_id: plant, name: 'Shared roof array', device_type: 'solar', rated_power_kw: 250 });
});

afterAll(async () => {
  await db.close();
});

describe('an energy community', () => {
  it('lists its participants with their place, their meter and who answers for them', async () => {
    const r = await db.query<{ participant: string; category: string; address_line1: string; meter: string; contact: string | null }>(
      `select p.name participant, p.category, p.address_line1, m.identifier meter, c.name contact
         from participants p
         join meters m on m.participant_id = p.id
         left join contacts c on c.id = p.contact_id
        where p.project_id = $1
        order by p.category, p.name`,
      [project],
    );
    expect(r.rows).toEqual([
      { participant: 'Tenant 1', category: 'consumer', address_line1: 'Harbour 1', meter: '871000000000000001', contact: 'Tenant 1' },
      { participant: 'Tenant 2', category: 'consumer', address_line1: 'Harbour 2', meter: '871000000000000002', contact: 'Tenant 2' },
      { participant: 'Tenant 3', category: 'consumer', address_line1: 'Harbour 3', meter: '871000000000000003', contact: 'Tenant 3' },
      { participant: 'Roof plant', category: 'producer', address_line1: 'Harbour 9', meter: '871000000000000009', contact: null },
    ]);
  });

  it('refuses a metering number that is not one, and a connection point declared twice', async () => {
    await expect(db.query(`select declare_meter($1, '12AB', 'gs1_gsrn')`, [participants[0]])).rejects.toThrow(/invalid_identifier/);
    await expect(db.query(`select declare_meter($1, '871000000000000001', 'gs1_gsrn')`, [participants[1]])).rejects.toThrow(/meter_already_open/);
  });

  it('lets a participant leave, and a new one join at the same place and carry its meter', async () => {
    await db.query(`select leave_project($1, '2025-12-31')`, [participants[2]]);
    await expect(db.query(`select leave_project($1)`, [participants[2]])).rejects.toThrow(/participant_not_in_project/);
    const next = (await one<{ id: string }>(db, `select join_project($1, 'Next tenant', $2, 'consumer', null, '2026-02-01') id`, [project, unit(3)])).id;
    await db.query(`select assign_meter($1, $2)`, [meters[2], next]);
    const carried = await one<{ participant_id: string }>(db, 'select participant_id from meters where id = $1', [meters[2]]);
    expect(carried.participant_id).toBe(next);
  });

  it('groups participants, and finds the meters behind a group', async () => {
    const group = await insert(db, 'participants', { organisation_id: org, project_id: project, name: 'Tenants 1 and 2' });
    await db.query('update participants set parent_id = $1 where id = any ($2)', [group, [participants[0], participants[1]]]);
    const r = await db.query<{ meter_id: string }>('select meter_id from participant_meters($1) order by 1', [group]);
    expect(r.rows.map((x) => x.meter_id).sort()).toEqual([meters[0], meters[1]].sort());
    await expect(
      db.query('update participants set parent_id = $1 where id = $2', [participants[0], participants[2]]),
    ).rejects.toThrow(/participant_parent_not_a_group/);
  });

  it('swaps the physical meter and keeps the connection point', async () => {
    const old = await one<{ id: string }>(db, `select install_device($1, 'meter', 'Meter A', null, null, '2015-03-01') id`, [participants[0]]);
    // The new meter takes the old one's place, behind the same connection point.
    await one<{ id: string }>(db, `select replace_device($1, '2026-03-01', null, 'Meter B') id`, [old.id]);
    const r = await one<{ name: string; identifier: string; installed: string }>(
      db,
      `select d.name, m.identifier, d.installation_date::text installed
         from devices d join meters m on m.participant_id = d.participant_id
        where m.id = $1 and d.device_type = 'meter' and d.status = 'in_service'`,
      [meters[0]],
    );
    expect(r).toEqual({ name: 'Meter B', identifier: '871000000000000001', installed: '2026-03-01' });
    const retired = await one<{ status: string; removed: string }>(db, 'select status, removal_date::text removed from devices where id = $1', [old.id]);
    expect(retired).toEqual({ status: 'removed', removed: '2026-03-01' });
    await expect(db.query(`select replace_device($1)`, [old.id])).rejects.toThrow(/device_retired/);
  });

  it('closes a connection point when its register retires the number', async () => {
    await db.query(`select close_meter($1, '2026-06-30')`, [meters[2]]);
    await expect(db.query(`select close_meter($1)`, [meters[2]])).rejects.toThrow(/meter_not_open/);
    const holder = (await one<{ participant_id: string }>(db, 'select participant_id from meters where id = $1', [meters[2]])).participant_id;
    const reissued = await one<{ id: string }>(db, `select declare_meter($1, '871000000000000003', 'gs1_gsrn', 'electricity', 'both', '2026-07-01') id`, [holder]);
    expect(reissued.id).not.toBe(meters[2]);
  });

  it('reads a cumulative register as the consumption of each step, and its index as a window', async () => {
    const register = await one<{ id: string }>(
      db,
      `insert into series (object_kind, object_id, quantity_code, kind, value_kind, source) values ('meter', $1, 'offtake_energy', 'measured', 'cumulative', 'dso') returning id`,
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

  it('lets the same place take part in a second project, as a participant of that project', async () => {
    const study = await insert(db, 'projects', { organisation_id: org, name: 'Harbour study', country: 'NL' });
    const again = (await one<{ id: string }>(db, `select join_project($1, 'Unit 1', $2) id`, [study, unit(1)])).id;
    const r = await one<{ n: number }>(db, `select count(*)::int n from participants where address_line1 = 'Harbour 1'`);
    expect(again).toBeTruthy();
    expect(r.n).toBe(2);
  });

  it('lets a study project describe the same meter as the project that runs it, one open participant per meter within each', async () => {
    const study = await insert(db, 'projects', { organisation_id: org, name: 'Scenario study', country: 'NL' });
    const variant = (await one<{ id: string }>(db, `select join_project($1, 'Unit 2 (scenario)', $2) id`, [study, unit(2)])).id;
    const copy = (await one<{ id: string }>(db, `select declare_meter($1, '871000000000000002', 'gs1_gsrn') id`, [variant])).id;
    expect(await one(db, 'select project_id from meters where id = $1', [copy])).toEqual({ project_id: study });
    const n = await one<{ n: number }>(db, `select count(distinct project_id)::int n from meters where identifier = '871000000000000002' and valid_to is null`);
    expect(n.n).toBe(2);
    const second = (await one<{ id: string }>(db, `select join_project($1, 'Unit 2 (other scenario)', $2) id`, [study, unit(2)])).id;
    await expect(db.query(`select declare_meter($1, '871000000000000002', 'gs1_gsrn')`, [second])).rejects.toThrow(/^meter_already_open: .* of this project/);
  });
});
