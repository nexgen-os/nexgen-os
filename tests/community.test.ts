// An energy community: a project, three sites each behind its own meter,
// taking part as participants with the company that answers for each, a
// shared PV plant on a fourth site, a group of participants, a meter swapped
// without losing the connection point, and the values of a register.
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
  db = await freshDatabase();
  org = await organisation(db, 'A cooperative');
  project = await insert(db, 'projects', { organisation_id: org, name: 'Harbour community', kind: 'energy_community', country: 'NL', status: 'active' });
  for (const n of [1, 2, 3]) {
    const site = await insert(db, 'sites', { organisation_id: org, name: `Unit ${n}`, country: 'NL', city: 'Rotterdam', profile: 'warehouse' });
    const meter = await insert(db, 'meters', { organisation_id: org, site_id: site, identifier: `87100000000000000${n}`, scheme: 'gs1_gsrn' });
    const tenant = await insert(db, 'contacts', { organisation_id: org, name: `Tenant ${n}`, kind: 'company' });
    const participant = await insert(db, 'participants', {
      organisation_id: org, project_id: project, site_id: site, name: `Tenant ${n}`, role: 'consumer', contact_id: tenant,
      status: 'active', join_date: '2025-01-01',
    });
    sites.push(site);
    meters.push(meter);
    participants.push(participant);
  }
  const plant = await insert(db, 'sites', { organisation_id: org, name: 'Roof plant', country: 'NL', profile: 'plant' });
  const plantMeter = await insert(db, 'meters', { organisation_id: org, site_id: plant, identifier: '871000000000000009', scheme: 'gs1_gsrn', direction: 'injection' });
  await insert(db, 'devices', { organisation_id: org, site_id: plant, meter_id: plantMeter, name: 'Shared roof array', device_type: 'solar', power_kw: 250 });
  await insert(db, 'participants', { organisation_id: org, project_id: project, site_id: plant, name: 'Roof plant', role: 'producer', status: 'active' });
});

afterAll(async () => {
  await db.close();
});

describe('an energy community', () => {
  it('lists its participants with their site, their meter and who answers for them', async () => {
    const r = await db.query<{ participant: string; role: string; meter: string; contact: string | null }>(
      `select p.name participant, p.role, m.identifier meter, c.name contact
         from participants p
         join meters m on m.site_id = p.site_id
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

  it('refuses the same site twice in a project, and a metering number that is not one', async () => {
    await expect(
      insert(db, 'participants', { organisation_id: org, project_id: project, site_id: sites[0], name: 'Again', role: 'consumer' }),
    ).rejects.toThrow(/participant_site_already_in_project/);
    await expect(
      insert(db, 'meters', { organisation_id: org, site_id: sites[0], identifier: '12AB', scheme: 'gs1_gsrn' }),
    ).rejects.toThrow(/invalid_identifier/);
  });

  it('groups participants, and finds the meters behind a group', async () => {
    const group = await insert(db, 'participants', { organisation_id: org, project_id: project, name: 'Tenants 1 and 2', is_group: true });
    await db.query('update participants set parent_id = $1 where id = any ($2)', [group, [participants[0], participants[1]]]);
    const r = await db.query<{ meter_id: string }>('select meter_id from participant_meters($1) order by 1', [group]);
    expect(r.rows.map((x) => x.meter_id).sort()).toEqual([meters[0], meters[1]].sort());
    await expect(
      db.query('update participants set parent_id = $1 where id = $2', [participants[0], participants[2]]),
    ).rejects.toThrow(/participant_parent_not_a_group/);
  });

  it('swaps the physical meter and keeps the connection point', async () => {
    const old = await insert(db, 'devices', {
      organisation_id: org, site_id: sites[0], meter_id: meters[0], name: 'Meter A', device_type: 'meter', installation_date: '2015-03-01',
    });
    await db.query(`update devices set status = 'removed' where id = $1`, [old]);
    await insert(db, 'devices', {
      organisation_id: org, site_id: sites[0], meter_id: meters[0], name: 'Meter B', device_type: 'meter', installation_date: '2026-03-01',
    });
    const r = await one<{ name: string; identifier: string }>(
      db,
      `select d.name, m.identifier from devices d join meters m on m.id = d.meter_id
        where d.meter_id = $1 and d.device_type = 'meter' and d.status = 'in_service'`,
      [meters[0]],
    );
    expect(r).toEqual({ name: 'Meter B', identifier: '871000000000000001' });
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

  it('reads a cumulative register as its index per step', async () => {
    const register = await one<{ id: string }>(
      db,
      `insert into series (object_id, quantity_code, kind, value_kind, source) values ($1, 'energy_import', 'measured', 'cumulative', 'dso') returning id`,
      [meters[1]],
    );
    await db.query(
      `insert into series_values (series_id, at, value) values ($1, '2026-04-01 00:00+00', 1000), ($1, '2026-04-01 12:00+00', 1012), ($1, '2026-04-02 00:00+00', 1030)`,
      [register.id],
    );
    const r = await db.query<{ value: number }>(`select value from resample($1, '2026-04-01', '2026-04-03', '1 day')`, [register.id]);
    expect(r.rows.map((x) => x.value)).toEqual([1012, 1030]);
  });

  it('lets the same site take part in a second project', async () => {
    const portfolio = await insert(db, 'projects', { organisation_id: org, name: 'Harbour portfolio', kind: 'portfolio', country: 'NL' });
    const again = await insert(db, 'participants', { organisation_id: org, project_id: portfolio, site_id: sites[0], name: 'Unit 1', role: 'consumer' });
    const r = await one<{ n: number }>(db, 'select count(*)::int n from participants where site_id = $1', [sites[0]]);
    expect(again).toBeTruthy();
    expect(r.n).toBe(2);
  });
});
