// The platform's database, read only, imported into the model, imported
// again without a duplicate, and reconciled per participant and per month.
// Every organisation, project, person, place and metering point is made up
// (`fixtures/platform.ts`).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { importHistory, registerSource, type HistoryReport } from '@nexgen-os/core';
import { readWesmartDatabase, registerWesmartDatabaseScheme, wesmartDatabaseSource } from '@nexgen-os/wesmart-database';
import { USER_A, asUser, freshDatabase, one } from '../../../../tests/helpers/db.js';
import { EAN_HOUSE, EAN_SCHOOL, HOUSE, LONELY_PROJECT, NAMES, PV_RECORD, SCHOOL, madeUpPlatform } from './fixtures/platform.js';

let source: PGlite;
let db: PGlite;

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
  source = await madeUpPlatform();
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
