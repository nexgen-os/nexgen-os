// set_device_status(): a device of the core moves from planned to in service, out
// of service and back, by named transitions, on a day that has come; the
// day it leaves planned is its installation date. Removed is
// retire_device()'s. A person who cannot reach the device does not find it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, freshDatabase, insert, one, organisation, USER_B } from './helpers/db.js';

const VIEWER = '00000000-0000-4000-8000-00000000000c';

let db: PGlite;
let unit: string;

const install = async (name: string, on: string | null) =>
  (await one<{ id: string }>(db, `select install_device($1, 'solar', $2, null, 6, $3::date) id`, [unit, name, on])).id;
const state = (id: string) =>
  one<{ status: string; installation_date: string | null }>(db, `select status, installation_date::text from devices where id = $1`, [id]);
const refusal = async (sql: string, params: unknown[]) => {
  try {
    await db.query(sql, params);
  } catch (error) {
    return (error as Error).message.split(':')[0];
  }
  return 'accepted';
};

beforeAll(async () => {
  db = await freshDatabase();
  const org = await organisation(db, 'A cooperative');
  await db.query('insert into auth.users (id) values ($1) on conflict do nothing', [VIEWER]);
  await db.query(`insert into organisation_members (organisation_id, user_id, role) values ($1, $2, 'viewer')`, [org, VIEWER]);
  const project = await insert(db, 'projects', { organisation_id: org, name: 'Riverside community', kind: 'energy_community', country: 'NL', status: 'creation' });
  const place = JSON.stringify({ address_line1: 'Kade 1', city: 'Rotterdam', country: 'NL' });
  unit = (await one<{ id: string }>(
    db, `select join_project($1, 'Unit 1', $2, 'prosumer', null, '2026-01-01', p_time_zone => 'Europe/Amsterdam') id`, [project, place])).id;
});

afterAll(async () => {
  await db.close();
});

describe('set_device_status()', () => {
  it('takes a planned device through the works: installed on a day, which becomes its installation date, then in service', async () => {
    const roof = await install('Roof array', null);
    expect(await state(roof)).toEqual({ status: 'planned', installation_date: null });
    await db.query(`select set_device_status($1, 'installed', '2026-03-02')`, [roof]);
    expect(await state(roof)).toEqual({ status: 'installed', installation_date: '2026-03-02' });
    await db.query(`select set_device_status($1, 'in_service', '2026-03-09')`, [roof]);
    expect(await state(roof)).toEqual({ status: 'in_service', installation_date: '2026-03-02' });
  });

  it('puts a device in service the day it is installed, and takes it out of service and back', async () => {
    const carport = await install('Carport array', '2099-01-01');
    expect(await state(carport)).toEqual({ status: 'planned', installation_date: '2099-01-01' });
    await db.query(`select set_device_status($1, 'in_service', '2026-04-01')`, [carport]);
    expect(await state(carport)).toEqual({ status: 'in_service', installation_date: '2026-04-01' });
    await db.query(`select set_device_status($1, 'out_of_service', '2026-05-10')`, [carport]);
    expect((await state(carport)).status).toBe('out_of_service');
    await db.query(`select set_device_status($1, 'in_service', '2026-05-12')`, [carport]);
    expect(await state(carport)).toEqual({ status: 'in_service', installation_date: '2026-04-01' });
  });

  it('takes an installed device that failed its commissioning out of service', async () => {
    const shed = await install('Shed array', null);
    await db.query(`select set_device_status($1, 'installed', '2026-06-01')`, [shed]);
    await db.query(`select set_device_status($1, 'out_of_service', '2026-06-02')`, [shed]);
    expect(await state(shed)).toEqual({ status: 'out_of_service', installation_date: '2026-06-01' });
  });

  it('refuses by name any other move, a day to come, a day before its installation, and a removed device', async () => {
    const wall = await install('Wall array', null);
    const move = (status: string | null, on: string | null = '2026-06-01') => refusal(`select set_device_status($1, $2, $3::date)`, [wall, status, on]);
    expect(await move('out_of_service')).toBe('device_status_invalid');
    expect(await move('planned')).toBe('device_status_invalid');
    expect(await move('removed')).toBe('device_status_invalid');
    expect(await move('broken')).toBe('device_status_invalid');
    expect(await move(null)).toBe('device_status_invalid');
    expect(await move('installed', '2999-01-01')).toBe('device_day_invalid');
    expect(await move('installed')).toBe('accepted');
    expect(await move('installed')).toBe('device_status_invalid');
    expect(await move('in_service', '2026-05-31')).toBe('device_day_invalid');
    expect(await move('in_service', '2026-06-01')).toBe('accepted');
    expect(await move('planned')).toBe('device_status_invalid');
    await db.query(`select retire_device($1, '2026-07-01')`, [wall]);
    expect(await move('in_service')).toBe('device_retired');
    expect(await refusal(`select set_device_status(gen_random_uuid(), 'in_service')`, [])).toBe('device_not_found');
  });

  it('is made under the rights of the person: not found by a stranger, refused to a viewer', async () => {
    const roof = await install('Second roof array', null);
    const moveAs = (user: string) => asUser(db, user, () => refusal(`select set_device_status($1, 'installed', '2026-03-02')`, [roof]));
    expect(await moveAs(USER_B)).toBe('device_not_found');
    expect(await moveAs(VIEWER)).toBe('not_allowed');
    expect((await state(roof)).status).toBe('planned');
  });
});
