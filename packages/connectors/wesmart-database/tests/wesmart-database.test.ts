// The platform's database, read only, imported into the model, imported
// again without a duplicate, and reconciled per participant and per month.
// Every organisation, project, person, place and metering point below is
// made up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { importHistory, registerSource, type HistoryReport } from '@nexgen-os/core';
import { readWesmartDatabase, registerWesmartDatabaseScheme, wesmartDatabaseSource } from '@nexgen-os/wesmart-database';
import { USER_A, asUser, freshDatabase, one } from '../../../../tests/helpers/db.js';

const ORG = '0a000000-0000-4000-8000-000000000001';
const PROJECT = '0b000000-0000-4000-8000-000000000001';
const LONELY_PROJECT = '0b000000-0000-4000-8000-000000000002';
const SCHOOL = '0c000000-0000-4000-8000-000000000001';
const HOUSE = '0c000000-0000-4000-8000-000000000002';
const PV_RECORD = '0c000000-0000-4000-8000-000000000003';
const EAN_SCHOOL = '541448000000000017';
const EAN_HOUSE = '541448000000000024';
const NAMES = ['Example Cooperative', 'Demo Sharing', 'Example School', 'Example House', 'Rue de l’Exemple 1'];

// The tables and columns of the platform the reader reads, nothing more.
const SOURCE_SCHEMA = `
  create table organisations (id uuid primary key, name text, created_at timestamptz default now());
  create table projects (id uuid primary key, organisation_id uuid, name text, country text, start_date date, created_at timestamptz default now());
  create table profiles (id text primary key, category text);
  create table participants (id uuid primary key, project_id uuid, name text, address text, postal_code text, city text, country text,
    latitude numeric, longitude numeric, smart_meter_id text, join_date date, profile_id text, created_at timestamptz default now());
  create table devices (id uuid primary key, participant_id uuid, name text, device_type text, power numeric, installation_date date,
    created_at timestamptz default now());
  create table dso_meter_readings (participant_id uuid, "timestamp" timestamptz, offtake_kwh numeric, consumption_kwh numeric,
    injection_kwh numeric, primary key (participant_id, "timestamp"));
  create table connector_mandates (id uuid primary key, participant_id uuid, dso text, status text, data_granularity text,
    data_start_date date, data_end_date date, approved_at timestamptz, created_at timestamptz default now(), external_id text);
`;

let source: PGlite;
let db: PGlite;

/** Quarter-hours from 31 January 22:00 UTC to 1 February 02:00 UTC: across the end of a month in Brussels (UTC+1). */
async function seedReadings(participant: string, offtake: number, injection: number) {
  await source.query(
    `insert into dso_meter_readings (participant_id, "timestamp", consumption_kwh, injection_kwh)
     select $1, t, $2, $3 from generate_series('2026-01-31T22:00:00Z'::timestamptz, '2026-02-01T01:45:00Z', interval '15 minutes') t`,
    [participant, offtake, injection]);
}

async function nightly(mode: 'dry_run' | 'apply' | 'report'): Promise<HistoryReport> {
  const { history } = await readWesmartDatabase(source, { timeZone: 'Europe/Brussels' });
  return asUser(db, USER_A, async () => {
    await db.exec('begin');
    try {
      const report = await importHistory(db, history, { mode });
      await db.exec('commit');
      return report;
    } catch (error) {
      await db.exec('rollback');
      throw error;
    }
  });
}

const count = async (table: string) => (await one<{ n: number }>(db, `select count(*)::int n from ${table}`)).n;
const state = async () => ({
  organisations: await count('organisations'), projects: await count('projects'), participants: await count('participants'),
  meters: await count('meters'), devices: await count('devices'), series: await count('series'), mandates: await count('grid.mandates'),
});

beforeAll(async () => {
  source = new PGlite();
  await source.exec(SOURCE_SCHEMA);
  await source.query(`insert into organisations (id, name) values ($1, 'Example Cooperative')`, [ORG]);
  await source.query(`insert into projects (id, organisation_id, name, country, start_date) values ($1, $2, 'Demo Sharing', 'BE', '2026-01-01'), ($3, null, 'Orphan', 'BE', null)`,
    [PROJECT, ORG, LONELY_PROJECT]);
  await source.query(`insert into profiles (id, category) values ('school', 'consumer'), ('pv', 'producer')`);
  await source.query(
    `insert into participants (id, project_id, name, address, postal_code, city, country, latitude, longitude, smart_meter_id, join_date, profile_id) values
      ($1, $4, 'Example School', 'Rue de l’Exemple 1', '1000', 'Bruxelles', 'BE', 50.85, 4.35, $5, '2026-01-01', 'school'),
      ($2, $4, 'Example House', 'Rue de l’Exemple 3', '1000', 'Bruxelles', 'BE', null, null, $6, '2026-01-01', null),
      ($3, $4, 'PV - Example School', 'Rue de l’Exemple 1', '1000', 'Bruxelles', 'BE', 50.85, 4.35, $5, '2026-01-01', 'pv')`,
    [SCHOOL, HOUSE, PV_RECORD, PROJECT, EAN_SCHOOL, EAN_HOUSE]);
  await source.query(
    `insert into devices (id, participant_id, name, device_type, power, installation_date) values
      ('0d000000-0000-4000-8000-000000000001', $1, 'Roof PV', 'solar', 36, '2025-06-01'),
      ('0d000000-0000-4000-8000-000000000002', $1, 'Bus', 'ev', null, null),
      ('0d000000-0000-4000-8000-000000000003', $2, 'Heat pump', 'heatpump', 6, null)`, [SCHOOL, HOUSE]);
  await seedReadings(SCHOOL, 1.25, 0.5);
  await seedReadings(HOUSE, 0.25, 0);
  await source.query(
    `insert into connector_mandates (id, participant_id, dso, status, data_granularity, data_start_date, approved_at, external_id) values
      ('0e000000-0000-4000-8000-000000000001', $1, 'sibelga', 'approved', '15min', '2026-01-01', '2026-01-05T09:00:00Z', 'OP-REF-1'),
      ('0e000000-0000-4000-8000-000000000002', $2, 'sibelga', 'revoked', '15min', '2026-01-01', null, null)`, [SCHOOL, HOUSE]);

  db = await freshDatabase(['grid'], ['be']);
  await registerSource(db, wesmartDatabaseSource);
  await registerWesmartDatabaseScheme(db);
  await db.query('insert into auth.users (id) values ($1) on conflict do nothing', [USER_A]);
});

afterAll(async () => {
  await source.close();
  await db.close();
});

describe('the platform read', () => {
  it('describes what it holds and says by id what it skips', async () => {
    const { history, skipped } = await readWesmartDatabase(source, { timeZone: 'Europe/Brussels' });
    expect(history.organisations).toHaveLength(1);
    expect(history.organisations[0]!.projects[0]!.participants).toHaveLength(3);
    expect(history.readings!.map((r) => `${r.identifier} ${r.quantity_code} ${r.values.length}`)).toEqual([
      `${EAN_SCHOOL} offtake_energy 16`, `${EAN_SCHOOL} injection_energy 16`, `${EAN_HOUSE} offtake_energy 16`, `${EAN_HOUSE} injection_energy 16`,
    ]);
    expect(skipped).toEqual([
      { kind: 'device', ref: '0d000000-0000-4000-8000-000000000002', reason: 'device_type_unknown' },
      { kind: 'meter', ref: PV_RECORD, reason: 'meter_shared' },
      { kind: 'project', ref: LONELY_PROJECT, reason: 'organisation_missing' },
      { kind: 'mandate', ref: '0e000000-0000-4000-8000-000000000002', reason: 'mandate_closed' },
    ]);
  });

  it('never writes the platform', async () => {
    await source.query('begin transaction read only');
    await expect(source.query(`update organisations set name = 'x'`)).rejects.toThrow(/read-only/);
    await source.query('rollback');
    const { history } = await readWesmartDatabase(source, { timeZone: 'Europe/Brussels' });
    expect(history.organisations[0]!.name).toBe('Example Cooperative');
  });

  it('refuses to guess a time zone', async () => {
    await expect(readWesmartDatabase(source, { timeZone: '' })).rejects.toThrow(/^time_zone_required/);
  });
});

describe('the history imported every night', () => {
  it('writes nothing on a dry run, and says exactly what an import would do', async () => {
    const before = await state();
    const plan = await nightly('dry_run');
    expect(await state()).toEqual(before);
    expect(plan.counts.organisation).toEqual({ found: 0, created: 1, failed: 0 });
    expect(plan.counts.participant).toEqual({ found: 0, created: 3, failed: 0 });
    expect(plan.counts.meter.created).toBe(2);
    expect(plan.counts.device.created).toBe(2);
    expect(plan.counts.mandate).toEqual({ found: 0, created: 1, failed: 0 });
    expect(plan.readings).toEqual({ series: 4, values: 64, changed: 64 });
    expect(plan.objects.every((o) => o.id === null || o.outcome === 'found')).toBe(true);
    expect(plan.totals.equal).toBe(plan.totals.lines);
  });

  it('imports, and the model gives back the platform’s kWh per participant and per month', async () => {
    const first = await nightly('apply');
    expect(first.counts.project).toEqual({ found: 0, created: 1, failed: 0 });
    expect(first.readings.changed).toBe(64);
    // Brussels is one hour ahead: 22:00–23:00 UTC on 31 January is January, the rest February.
    const school = first.months.filter((m) => m.participant_ref === SCHOOL);
    expect(school).toEqual([
      expect.objectContaining({ month: '2026-01', quantity_code: 'injection_energy', source_kwh: 2, nexgen_kwh: 2, difference_kwh: 0, status: 'equal' }),
      expect.objectContaining({ month: '2026-01', quantity_code: 'offtake_energy', source_kwh: 5, nexgen_kwh: 5, status: 'equal' }),
      expect.objectContaining({ month: '2026-02', quantity_code: 'injection_energy', source_kwh: 6, nexgen_kwh: 6, status: 'equal' }),
      expect.objectContaining({ month: '2026-02', quantity_code: 'offtake_energy', source_kwh: 15, nexgen_kwh: 15, status: 'equal' }),
    ]);
    expect(school.every((m) => m.participant_id !== null)).toBe(true);
    expect(first.totals).toMatchObject({ lines: 8, equal: 8, differs: 0, missing: 0, failed: 0 });
    const mandate = await one<{ status: string; operator: string; external_reference: string }>(db, 'select status, operator, external_reference from grid.mandates');
    expect(mandate).toEqual({ status: 'approved', operator: 'sibelga', external_reference: 'OP-REF-1' });
  });

  it('imported again, creates nothing, changes nothing, and reports the same months', async () => {
    const before = await state();
    const first = await nightly('report');
    const again = await nightly('apply');
    expect(await state()).toEqual(before);
    expect(Object.values(again.counts).every((c) => c.created === 0 && c.failed === 0)).toBe(true);
    expect(again.readings.changed).toBe(0);
    expect(again.months).toEqual(first.months);
  });

  it('reports a month the platform changed since, to the kWh, and the next night closes it', async () => {
    await source.query(`update dso_meter_readings set consumption_kwh = 2.25 where participant_id = $1 and "timestamp" >= '2026-02-01T01:00:00Z'`, [HOUSE]);
    const seen = await nightly('report');
    expect(seen.months.filter((m) => m.status !== 'equal')).toEqual([
      expect.objectContaining({ participant_ref: HOUSE, month: '2026-02', quantity_code: 'offtake_energy', source_kwh: 11, nexgen_kwh: 3, difference_kwh: -8, status: 'differs' }),
    ]);
    const applied = await nightly('apply');
    expect(applied.readings.changed).toBe(4);
    expect(applied.totals.differs).toBe(0);
    await source.query(`update dso_meter_readings set consumption_kwh = 0.25 where participant_id = $1`, [HOUSE]);
  });

  it('names no person, no place and no metering point in its report', async () => {
    const report = JSON.stringify(await nightly('report'));
    for (const secret of [...NAMES, 'Bruxelles', EAN_SCHOOL, EAN_HOUSE]) expect(report).not.toContain(secret);
    expect(report).toContain(SCHOOL);
  });
});
