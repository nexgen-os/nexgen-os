// A value is written once (decision 0065): the installed power of a
// participant or a project is the sum of the rated powers of its producing
// devices, read through the one reader of an attribute; the attribute
// declared by hand is read only where no device carries a power; and the
// rated power of a PV system is the power the solar module describes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase, insert, one, organisation, participant, repoRoot } from './helpers/db.js';

let db: PGlite;
let org: string;
let project: string;
let school: string;
let farm: string;
let hall: string;
let pv: string;

const power = async (id: string, at = 'now()') =>
  (await one<{ v: string | null }>(db, `select installed_power($1, ${at === 'now()' ? 'now()' : `'${at}'`}) v`, [id])).v;
const parameter = async (kind: string, id: string) =>
  (await one<{ p: Record<string, unknown> }>(db, `select parameter_of($1, $2, 'installed_power') p`, [kind, id])).p;
const rated = async (id: string) => (await one<{ v: string | null }>(db, 'select rated_power_kw v from devices where id = $1', [id])).v;

beforeAll(async () => {
  db = await freshDatabase(['solar']);
  org = await organisation(db, 'A cooperative');
  project = await insert(db, 'projects', { organisation_id: org, name: 'Valley', country: 'ES' });
  school = await participant(db, { organisation_id: org, project_id: project, name: 'School', country: 'ES', city: 'Sevilla' });
  farm = await participant(db, { organisation_id: org, project_id: project, name: 'Farm', country: 'ES', city: 'Sevilla' });
  hall = await participant(db, { organisation_id: org, project_id: project, name: 'Town hall', country: 'ES', city: 'Sevilla' });
  pv = await insert(db, 'devices', { organisation_id: org, participant_id: school, name: 'Roof PV', device_type: 'solar', rated_power_kw: 30 });
  await insert(db, 'devices', { organisation_id: org, participant_id: school, name: 'Battery', device_type: 'battery', rated_power_kw: 10 });
  await insert(db, 'devices', { organisation_id: org, participant_id: farm, name: 'Turbine', device_type: 'wind', rated_power_kw: 100 });
  await insert(db, 'devices', { organisation_id: org, participant_id: farm, name: 'Canopy', device_type: 'parking_canopy', rated_power_kw: 12.5 });
  await insert(db, 'devices', {
    organisation_id: org, participant_id: farm, name: 'Old PV', device_type: 'solar', rated_power_kw: 8,
    status: 'removed', installation_date: '2010-01-01', removal_date: '2024-06-30',
  });
});

afterAll(async () => {
  await db.close();
});

describe('the installed power of a participant and a project', () => {
  it('is the sum of the rated powers of the producing devices that are not removed', async () => {
    expect(Number(await power(school))).toBe(30);
    expect(Number(await power(farm))).toBe(112.5);
    expect(Number(await power(project))).toBe(142.5);
    expect(await power(hall)).toBeNull();
    // The day before it was taken out, the old system still counted.
    expect(Number(await power(farm, '2024-06-01'))).toBe(120.5);
  });

  it('is what parameter_of() answers, before any attribute declared by hand', async () => {
    await db.query(`select set_attribute('participant', $1, 'installed_power', '25'::jsonb)`, [school]);
    const p = await parameter('participant', school);
    expect(p.value).toBe(30);
    expect(p.level).toBe('object');
    expect(p.reference).toMatch(/devices/);
    expect((await parameter('project', project)).value).toBe(142.5);
    // What is stored is still there, and still what an export says.
    const stored = await one<{ value: number }>(db, `select value from attributes where object_id = $1 and attribute_type = 'installed_power'`, [school]);
    expect(stored.value).toBe(25);
  });

  it('is the declared attribute where no device carries a power', async () => {
    await db.query(`select set_attribute('participant', $1, 'installed_power', '640'::jsonb)`, [hall]);
    const p = await parameter('participant', hall);
    expect(p.value).toBe(640);
    expect(p.reference ?? null).toBeNull();
  });

  it('is what a condition compares', async () => {
    const matches = async (id: string, kind: string, op: string, value: number) =>
      (await one<{ m: boolean | null }>(db, `select condition_matches($1::jsonb, condition_facts($2, $3, now())) m`,
        [JSON.stringify({ attribute: { attribute_type: 'installed_power', op, value } }), kind, id])).m;
    expect(await matches(project, 'project', '>', 100)).toBe(true);
    expect(await matches(school, 'participant', '>', 100)).toBe(false);
    const empty = await insert(db, 'projects', { organisation_id: org, name: 'Empty', country: 'ES' });
    expect(await matches(empty, 'project', '>', 100)).toBeNull();
  });
});

describe('the rated power of a PV system', () => {
  it('computes from the rated power alone when the module describes nothing more', async () => {
    await db.query('insert into solar.devices (id) values ($1)', [pv]);
    expect(Number((await one<{ v: string }>(db, 'select solar.system_kwp($1) v', [pv])).v)).toBe(30);
    expect(Number(await rated(pv))).toBe(30);
  });

  it('is the system\'s own figure, then the sum of its arrays, wherever it is read', async () => {
    await db.query('update solar.devices set kwp_dc = 32 where id = $1', [pv]);
    expect(Number(await rated(pv))).toBe(32);
    const south = await insert(db, 'solar.pv_arrays', { organisation_id: org, device_id: pv, name: 'South', azimuth_deg: 180, tilt_deg: 30, kwp_dc: 20 });
    const west = await insert(db, 'solar.pv_arrays', { organisation_id: org, device_id: pv, name: 'West', azimuth_deg: 270, tilt_deg: 25, kwp_dc: 16 });
    const figures = async () => one<{ rated: string; own: string; system: string }>(db,
      `select d.rated_power_kw rated, p.kwp_dc own, solar.system_kwp(d.id) system from devices d join solar.devices p using (id) where d.id = $1`, [pv]);
    expect(Object.values(await figures()).map(Number)).toEqual([36, 36, 36]);
    expect(Number(await power(school))).toBe(36);
    await db.query('update solar.pv_arrays set kwp_dc = 18 where id = $1', [west]);
    expect(Object.values(await figures()).map(Number)).toEqual([38, 38, 38]);
    await db.query('delete from solar.pv_arrays where id = $1', [west]);
    expect(Object.values(await figures()).map(Number)).toEqual([20, 20, 20]);
    await db.query('update solar.pv_arrays set kwp_dc = 30 where id = $1', [south]);
    expect(Number(await power(school))).toBe(30);
  });

  it('does not count the arrays of a variant', async () => {
    const variant = await insert(db, 'solar.variants', { organisation_id: org, participant_id: school, name: 'With a carport' });
    await insert(db, 'solar.pv_arrays', { organisation_id: org, device_id: pv, name: 'Carport', azimuth_deg: 180, tilt_deg: 10, kwp_dc: 9, variant_id: variant });
    expect(Number(await rated(pv))).toBe(30);
    expect(Number((await one<{ v: string }>(db, 'select solar.system_kwp($1, $2) v', [pv, variant])).v)).toBe(39);
  });

  it('refuses a second figure, by name', async () => {
    await expect(db.query('update devices set rated_power_kw = 45 where id = $1', [pv])).rejects.toThrow(/power_from_arrays/);
    await expect(db.query('update solar.devices set kwp_dc = 45 where id = $1', [pv])).rejects.toThrow(/power_from_arrays/);
    await db.query('update devices set rated_power_kw = 30, name = $2 where id = $1', [pv, 'Roof PV, south']);
    expect(Number(await rated(pv))).toBe(30);
  });

  it('aligns, when it is installed, the systems an earlier release let say two figures', async () => {
    // As before the migration: nothing kept the figures equal.
    await db.exec(`alter table solar.devices disable trigger devices_power;
      alter table solar.pv_arrays disable trigger pv_arrays_power;
      alter table devices disable trigger solar_devices_power_check`);
    const own = await insert(db, 'devices', { organisation_id: org, participant_id: hall, name: 'Hall PV', device_type: 'solar', rated_power_kw: 9 });
    await db.query('insert into solar.devices (id, kwp_dc) values ($1, 12)', [own]);
    await db.query('update solar.devices set kwp_dc = 33 where id = $1', [pv]);
    await db.query('update devices set rated_power_kw = 31 where id = $1', [pv]);
    const migration = readFileSync(join(repoRoot, 'modules/solar/supabase/migrations/0006_one_power.sql'), 'utf8');
    const backfill = migration.slice(migration.indexOf('do $$'), migration.indexOf('$$;', migration.indexOf('do $$')) + 3);
    await db.exec(backfill);
    await db.exec(`alter table solar.devices enable trigger devices_power;
      alter table solar.pv_arrays enable trigger pv_arrays_power;
      alter table devices enable trigger solar_devices_power_check`);
    const figures = async (id: string) => Object.values(await one<{ rated: string; own: string }>(db,
      'select d.rated_power_kw rated, p.kwp_dc own from devices d join solar.devices p using (id) where d.id = $1', [id])).map(Number);
    // The arrays of the roof say 30; the hall's system says 12 and has no array.
    expect(await figures(pv)).toEqual([30, 30]);
    expect(await figures(own)).toEqual([12, 12]);
  });
});
