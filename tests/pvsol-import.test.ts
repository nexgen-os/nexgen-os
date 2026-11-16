// A PV*SOL study becomes a project, its participant, its inverters and a PV
// system of the solar module with one array per roof face, each oriented as
// PV*SOL drew it; imported again it creates nothing, and a study the model
// cannot take whole is refused before anything is written.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, asUser, freshDatabase, one, organisation } from './helpers/db.js';
import { importPvsolStudy, projectOfPvsolStudy } from '@nexgen-os/core';
import { readPvsolStudy } from '@nexgen-os/pvsol';
import { study } from '../packages/formats/pvsol/tests/study.js';

let db: PGlite;
let org: string;

const count = async (table: string) => (await one<{ n: number }>(db, `select count(*)::int n from ${table}`)).n;

beforeAll(async () => {
  db = await freshDatabase(['solar']);
  org = await organisation(db, 'Solar designer');
});

afterAll(async () => {
  await db.close();
});

describe('a PV*SOL study imported', () => {
  it('reads as one participant with its inverters, in the country the caller gives', () => {
    expect(projectOfPvsolStudy(readPvsolStudy(study()), { country: 'FR', time_zone: 'Europe/Paris' })).toEqual({
      name: 'Warehouse roof', country: 'FR',
      participants: [{
        name: 'Example Logistics', category: 'prosumer', time_zone: 'Europe/Paris',
        place: { country: 'FR', address_line1: '1 Example Street, 1000 Sample Town' },
        devices: [{ device_type: 'inverter', name: 'Example Power EP 60', unit_count: 2 }],
      }],
    });
  });

  it('writes nothing on a dry run', async () => {
    const plan = await asUser(db, USER_A, () => importPvsolStudy(db, org, study(), { country: 'FR', dryRun: true }));
    expect(plan.project.counts).toEqual({
      project: { found: 0, created: 1 }, participant: { found: 0, created: 1 }, meter: { found: 0, created: 0 }, device: { found: 0, created: 1 },
    });
    expect(plan.pv_system).toEqual({ name: 'Warehouse roof', outcome: 'to_create', device_id: null, arrays: [] });
    expect(plan.warnings.map((w) => w.code)).toEqual(['array_empty']);
    expect(await count('projects')).toBe(0);
  });

  it('creates the PV system with each array at its own orientation and power', async () => {
    const done = await asUser(db, USER_A, () => importPvsolStudy(db, org, study(), { country: 'FR' }));
    expect(done.pv_system.outcome).toBe('created');
    expect(done.pv_system.arrays).toHaveLength(2);
    expect(await one(db, `select d.device_type, d.rated_power_kw::float8 kw, s.kwp_dc::float8 kwp_dc
                            from devices d join solar.devices s using (id) where d.id = $1`, [done.pv_system.device_id]))
      .toEqual({ device_type: 'solar', kw: 133.65, kwp_dc: 133.65 });
    expect((await db.query(`select name, azimuth_deg::float8 azimuth, tilt_deg::float8 tilt, kwp_dc::float8 kwp
                              from solar.pv_arrays order by name`)).rows).toEqual([
      { name: 'Building 01-Roof surface north-east', azimuth: 52, tilt: 15, kwp: 60.75 },
      { name: 'Building 01-Roof surface south-west', azimuth: 231.5, tilt: 15, kwp: 72.9 },
    ]);
    expect(await one(db, `select unit_count from devices where device_type = 'inverter'`)).toEqual({ unit_count: 2 });
  });

  it('finds everything when the study is imported again', async () => {
    const again = await asUser(db, USER_A, () => importPvsolStudy(db, org, study(), { country: 'FR' }));
    expect(again.pv_system.outcome).toBe('found');
    expect(again.pv_system.arrays).toHaveLength(2);
    expect(Object.values(again.project.counts).every((c) => c.created === 0)).toBe(true);
    expect([await count('projects'), await count('devices'), await count('solar.pv_arrays')]).toEqual([1, 2, 2]);
  });

  it('refuses a study it cannot take whole, before writing', async () => {
    const before = await count('projects');
    await expect(asUser(db, USER_A, () => importPvsolStudy(db, org, study({ without: ['DB.json'] }), { country: 'FR', project: 'Other' })))
      .rejects.toThrow(/^pvsol_incomplete: the array Building 01-Roof surface north-east has no power$/);
    await expect(asUser(db, USER_A, () => importPvsolStudy(db, org, new Uint8Array([1, 2, 3]), { country: 'FR' })))
      .rejects.toThrow(/^pvsol_unreadable: /);
    expect(await count('projects')).toBe(before);
  });
});
