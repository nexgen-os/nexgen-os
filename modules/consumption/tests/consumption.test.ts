// The `consumption` module: the office block of example 7 in Munich, its
// activity hours, its electricity curve estimated from a monthly bill
// and from its annual consumption, recorded as estimates, and read back measured
// first once its meter gives readings.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, USER_B, asUser, freshDatabase, insert, one, organisation, repoRoot } from '../../../tests/helpers/db.js';
import { store } from '@nexgen-os/core';
import { estimateConsumption, slotWeights, spreadEnergy, type LoadProfile } from '../src/curve.js';

const ORG = '00000000-0000-4000-8000-000700000001';
const BLOCK = '00000000-0000-4000-8000-000700000010';
const PROJECT = '00000000-0000-4000-8000-000700000005';
const ELECTRICITY = '00000000-0000-4000-8000-000700000041';
const TZ = 'Europe/Berlin';

let db: PGlite;

const FLAT: LoadProfile = {
  code: 'flat', method: 'day_shapes', slots_per_day: 24, closed_ratio: null, monthly_factors: null, source_code: null,
  day_shapes: { weekday: Array(24).fill(1), saturday: Array(24).fill(1), sunday: Array(24).fill(1) },
};
const OFFICE: LoadProfile = {
  code: 'office_hours', method: 'activity_hours', slots_per_day: 24, day_shapes: null, closed_ratio: 0.25, monthly_factors: null, source_code: null,
};
const WEEKDAYS_8_TO_18 = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens: '08:00', closes: '18:00', valid_from: null, valid_to: null }));

/** The wall-clock hour of an instant in Munich. */
const localHour = (at: string) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(at)));

beforeAll(async () => {
  db = await freshDatabase(['building', 'grid', 'actions', 'consumption']);
  await db.exec(await readFile(join(repoRoot, 'docs', 'demo', '07-office-heating.sql'), 'utf8'));
  await db.query('insert into auth.users (id) values ($1), ($2) on conflict do nothing', [USER_A, USER_B]);
  await db.query(`insert into organisation_members (organisation_id, user_id, role) values ($1, $2, 'owner')`, [ORG, USER_A]);
  await organisation(db, 'Another company', USER_B);
  // A profile by activity hours, as an installation publishes one.
  await db.query(
    `insert into consumption.load_profiles (code, name, use_code, method, closed_ratio, published_by)
     values ('office_hours', 'Office, by its opening hours', 'office', 'activity_hours', 0.25, 'test')`,
  );
});

afterAll(async () => {
  await db.close();
});

describe('load profiles', () => {
  it('are data: the flat one ships with the module, the others come with the installation', async () => {
    const rows = await db.query<{ code: string; method: string; use_code: string | null }>('select code, method, use_code from consumption.load_profiles order by code');
    expect(rows.rows).toEqual([
      { code: 'flat', method: 'day_shapes', use_code: null },
      { code: 'office_hours', method: 'activity_hours', use_code: 'office' },
    ]);
  });

  it('refuse shapes that are not one weight per slot of a known day type, and a closed ratio outside a profile by hours', async () => {
    const add = (fields: string) => db.query(`insert into consumption.load_profiles (code, name, method, slots_per_day, day_shapes, closed_ratio) values ${fields}`);
    await expect(add(`('short', 'Short', 'day_shapes', 24, '{"weekday": [1, 2, 3]}', null)`)).rejects.toThrow(/day_shape_invalid/);
    await expect(add(`('negative', 'Negative', 'day_shapes', 24, jsonb_build_object('weekday', to_jsonb(array_fill(-1, array[24]))), null)`)).rejects.toThrow(/day_shape_invalid/);
    await expect(add(`('holiday', 'Holiday', 'day_shapes', 24, jsonb_build_object('holiday', to_jsonb(array_fill(1, array[24]))), null)`)).rejects.toThrow(/day_type_unknown/);
    await expect(add(`('hours_no_ratio', 'Hours', 'activity_hours', 24, null, null)`)).rejects.toThrow(/load_profiles_closed_ratio/);
    await expect(add(`('shape_ratio', 'Shape', 'day_shapes', 24, jsonb_build_object('weekday', to_jsonb(array_fill(1, array[24]))), 0.5)`)).rejects.toThrow(/load_profiles_closed_ratio/);
    await expect(db.query(`insert into consumption.load_profiles (code, name, method, closed_ratio, monthly_factors) values ('eleven', 'Eleven', 'activity_hours', 0.1, array_fill(1.0, array[11]))`))
      .rejects.toThrow(/load_profiles_monthly_factors/);
  });

  it('are read by everyone signed in and written by none of them', async () => {
    await asUser(db, USER_B, async () => {
      expect((await db.query('select code from consumption.load_profiles')).rows).toHaveLength(2);
      await expect(db.query(`update consumption.load_profiles set closed_ratio = 0.5 where code = 'office_hours'`)).rejects.toThrow(/permission denied/);
    });
  });
});

describe('the weights of the slots', () => {
  it('cut the local days of the participant: the spring day has 23 hours and the autumn day 25', () => {
    expect(slotWeights(FLAT, '2026-03-29', '2026-03-30', TZ)).toHaveLength(23);
    expect(slotWeights(FLAT, '2026-10-25', '2026-10-26', TZ)).toHaveLength(25);
    const year = slotWeights(FLAT, '2026-01-01', '2027-01-01', TZ);
    expect(year).toHaveLength(8760);
    expect(year[0].at).toBe('2025-12-31T23:00:00.000Z');
    expect(year.at(-1)!.at).toBe('2026-12-31T22:00:00.000Z');
  });

  it('weigh an open hour 1, a closed one the closed ratio, and a half-open one in between', () => {
    const hours = [{ weekday: 1, opens: '08:30', closes: '12:00', valid_from: null, valid_to: null }, { weekday: 1, opens: '13:00', closes: '18:00', valid_from: null, valid_to: null }];
    // Monday 12 January 2026.
    const w = new Map(slotWeights(OFFICE, '2026-01-12', '2026-01-13', TZ, hours).map((s) => [localHour(s.at), s.weight]));
    expect(w.get(7)).toBe(0.25);
    expect(w.get(8)).toBeCloseTo(0.625, 12);
    expect(w.get(10)).toBe(1);
    expect(w.get(12)).toBe(0.25);
    expect(w.get(17)).toBe(1);
    expect(w.get(18)).toBe(0.25);
  });

  it('read the hours on the wall clock in summer as in winter', () => {
    const summer = slotWeights(OFFICE, '2026-07-06', '2026-07-07', TZ, WEEKDAYS_8_TO_18).filter((s) => s.weight === 1);
    expect(summer.map((s) => s.at)[0]).toBe('2026-07-06T06:00:00.000Z');
    const winter = slotWeights(OFFICE, '2026-01-12', '2026-01-13', TZ, WEEKDAYS_8_TO_18).filter((s) => s.weight === 1);
    expect(winter.map((s) => s.at)[0]).toBe('2026-01-12T07:00:00.000Z');
    expect(summer).toHaveLength(10);
  });

  it('keep the hours to their period, and the shapes to their day type and month', () => {
    const summerOnly = [{ weekday: 1, opens: '08:00', closes: '18:00', valid_from: '2026-06-01', valid_to: '2026-09-01' }];
    expect(slotWeights(OFFICE, '2026-01-12', '2026-01-13', TZ, summerOnly).every((s) => s.weight === 0.25)).toBe(true);
    const weekdaysOnly: LoadProfile = { ...FLAT, day_shapes: { weekday: Array(24).fill(1) }, monthly_factors: [2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] };
    // Saturday 31 January, Sunday 1 February, Monday 2 February.
    const days = slotWeights(weekdaysOnly, '2026-01-30', '2026-02-03', TZ);
    const byDay = (date: string) => days.filter((s) => new Date(s.at).toLocaleDateString('en-CA', { timeZone: TZ }) === date).reduce((sum, s) => sum + s.weight, 0);
    expect([byDay('2026-01-30'), byDay('2026-01-31'), byDay('2026-02-01'), byDay('2026-02-02')]).toEqual([48, 0, 0, 24]);
  });

  it('refuse what they cannot cut', () => {
    expect(() => slotWeights(FLAT, '2026-01-01', '2026-01-01', TZ)).toThrow(/period_empty/);
    expect(() => slotWeights(FLAT, '2026-02-30', '2026-03-01', TZ)).toThrow(/date_invalid/);
    expect(() => slotWeights(FLAT, '2026-01-01', '2026-01-02', 'Europe/Atlantis')).toThrow(/time_zone_unknown/);
    expect(() => spreadEnergy(100, slotWeights({ ...FLAT, day_shapes: { saturday: Array(24).fill(1) } }, '2026-01-12', '2026-01-13', TZ))).toThrow(/profile_without_weight/);
  });
});

describe('a curve estimated from a bill', () => {
  let hours: string[];

  beforeAll(async () => {
    hours = [];
    for (const weekday of [1, 2, 3, 4, 5]) {
      hours.push(await insert(db, 'consumption.activity_hours', { organisation_id: ORG, object_kind: 'participant', object_id: BLOCK, weekday, opens: '07:00', closes: '19:00', source: 'facility manager' }));
    }
  });

  it('is a simulated series of the participant that adds up to the bill, open hours four times closed ones', async () => {
    const r = await estimateConsumption(db, {
      participantId: BLOCK, from: '2026-01-01', to: '2026-02-01', profileCode: 'office_hours',
      energy: { kwh: 41_850, source: 'electricity bill January 2026' },
    });
    expect(r).toMatchObject({ step: '60 minutes', slots: 744 });
    expect(r.kwh).toBeCloseTo(41_850, 3);
    const series = await one<{ object_id: string; kind: string; quantity_code: string; step: string; source: string }>(
      db, 'select object_id, kind, quantity_code, step::text, source from series where id = $1', [r.seriesId],
    );
    expect(series).toEqual({ object_id: BLOCK, kind: 'simulated', quantity_code: 'consumption_energy', step: '01:00:00', source: `consumption.estimates:${r.estimateId}` });

    const values = await db.query<{ at: Date; value: number }>('select at, value from series_values where series_id = $1 order by at', [r.seriesId]);
    // Thursday 15 January: 10:00 open, 03:00 closed.
    const at = (iso: string) => values.rows.find((v) => v.at.toISOString() === iso)!.value;
    expect(at('2026-01-15T09:00:00.000Z') / at('2026-01-15T02:00:00.000Z')).toBeCloseTo(4, 5);
    // 22 working days of 12 open hours, the rest closed.
    const closed = 41_850 / (22 * 12 + (744 - 22 * 12) * 0.25);
    expect(at('2026-01-15T02:00:00.000Z')).toBeCloseTo(closed * 0.25, 5);
  });

  it('is an estimate of the module that says its profile, its hours, its energy and its conventions, and a new computation replaces the one it names', async () => {
    const request = { participantId: BLOCK, from: '2026-01-01', to: '2026-02-01', profileCode: 'office_hours', energy: { kwh: 41_850, source: 'electricity bill January 2026' } };
    const earlier = await estimateConsumption(db, request);
    const first = await estimateConsumption(db, { ...request, replaces: earlier.estimateId });
    expect(first.estimateId).toBe(earlier.estimateId);
    expect((await db.query('select id from series where id = $1', [earlier.seriesId])).rows).toEqual([]);
    await expect(estimateConsumption(db, { ...request, replaces: '00000000-0000-4000-8000-00000000dead' })).rejects.toThrow(/estimate_not_found/);
    const estimate = await one<{ participant_id: string; provenance: string; inputs: Record<string, any>; results: Record<string, any> }>(
      db, 'select participant_id, provenance, inputs, results from consumption.estimates where id = $1', [first.estimateId],
    );
    expect(estimate.participant_id).toBe(BLOCK);
    expect(estimate.provenance).toBe('consumption-curve-0.3.0');
    expect(estimate.inputs.profile).toMatchObject({ code: 'office_hours', method: 'activity_hours', closed_ratio: 0.25 });
    expect(estimate.inputs.activity_hours).toHaveLength(5);
    expect(estimate.inputs.activity_hours[0]).toEqual({ weekday: 1, opens: '07:00:00', closes: '19:00:00', valid_from: null, valid_to: null });
    expect(estimate.inputs.energy).toEqual({ kwh: 41_850, source_code: null, source: 'electricity bill January 2026', document_id: null });
    expect(estimate.inputs.period).toEqual({ from: '2026-01-01', to: '2026-02-01', time_zone: TZ });
    expect(estimate.results).toMatchObject({ series_id: first.seriesId, step: '60 minutes', slots: 744 });
  });

  it('needs the participant\'s activity hours for a profile by hours, and its time zone', async () => {
    await expect(estimateConsumption(db, { participantId: BLOCK, from: '2025-01-01', to: '2025-02-01', profileCode: 'nope', energy: { kwh: 1 } })).rejects.toThrow(/load_profile_unknown/);
    await db.query('update consumption.activity_hours set valid_from = $1 where object_id = $2', ['2026-01-01', BLOCK]);
    await expect(estimateConsumption(db, { participantId: BLOCK, from: '2025-01-01', to: '2025-02-01', profileCode: 'office_hours', energy: { kwh: 1 } }))
      .rejects.toThrow(/activity_hours_required/);
    await db.query('update consumption.activity_hours set valid_from = null where object_id = $1', [BLOCK]);
    await db.query('update participants set time_zone = null where id = $1', [BLOCK]);
    try {
      await expect(estimateConsumption(db, { participantId: BLOCK, from: '2026-01-01', to: '2026-02-01', profileCode: 'flat', energy: { kwh: 1 } })).rejects.toThrow(/time_zone_required/);
    } finally {
      await db.query('update participants set time_zone = $1 where id = $2', [TZ, BLOCK]);
    }
  });
});

describe('a curve on quarter-hours', () => {
  it('takes the step of its profile, and its series names its estimate', async () => {
    await db.query(
      `insert into consumption.load_profiles (code, name, method, slots_per_day, day_shapes, published_by)
       values ('flat_quarter_hours', 'Flat, by quarter-hours', 'day_shapes', 96,
               jsonb_build_object('weekday', to_jsonb(array_fill(1, array[96]))), 'test')`,
    );
    const r = await estimateConsumption(db, { participantId: BLOCK, from: '2026-03-02', to: '2026-03-09', profileCode: 'flat_quarter_hours', energy: { kwh: 480, source: 'weekday estimate' } });
    expect(r).toMatchObject({ step: '15 minutes', slots: 7 * 96 });
    // Five weekdays carry the energy, the weekend nothing: 1 kWh a quarter-hour.
    const v = await one<{ value: number }>(db, `select value from series_values where series_id = $1 and at = '2026-03-02T10:00:00Z'`, [r.seriesId]);
    expect(v.value).toBeCloseTo(1, 9);
    const series = await one<{ source: string }>(db, 'select source from series where id = $1', [r.seriesId]);
    expect(series.source).toBe(`consumption.estimates:${r.estimateId}`);
  });
});

describe('a typical curve from the annual consumption', () => {
  it('spreads the participant\'s annual consumption over one year', async () => {
    await db.query(`insert into attributes (object_kind, object_id, attribute_type, value, source) values ('participant', $1, 'annual_consumption', '438000', 'energy audit 2022')`, [BLOCK]);
    const r = await estimateConsumption(db, { participantId: BLOCK, from: '2026-01-01', to: '2027-01-01', profileCode: 'flat' });
    expect(r.slots).toBe(8760);
    expect(r.kwh).toBeCloseTo(438_000, 3);
    const v = await one<{ value: number }>(db, 'select value from series_values where series_id = $1 limit 1', [r.seriesId]);
    expect(v.value).toBe(50);
  });

  it('needs the energy of a period that is not one year', async () => {
    await expect(estimateConsumption(db, { participantId: BLOCK, from: '2026-01-01', to: '2026-07-01', profileCode: 'flat' })).rejects.toThrow(/energy_required/);
  });
});

describe('the curve of a participant', () => {
  const from = '2026-01-12T00:00:00+01:00';
  const to = '2026-01-19T00:00:00+01:00';

  it('is the last estimate while nothing is measured', async () => {
    const r = await estimateConsumption(db, { participantId: BLOCK, from: '2026-01-12', to: '2026-01-19', profileCode: 'office_hours', energy: { kwh: 9_000, source: 'weekly estimate' } });
    const days = await db.query<{ value: number; series_id: string; kind: string }>(`select value, series_id, kind from consumption.curve($1, $2, $3, '1 day')`, [BLOCK, from, to]);
    expect(days.rows).toHaveLength(7);
    expect(days.rows.every((d) => d.series_id === r.seriesId && d.kind === 'simulated')).toBe(true);
    expect(days.rows.reduce((sum, d) => sum + d.value, 0)).toBeCloseTo(9_000, 3);
  });

  it('is the measured one as soon as a meter of the participant gives readings over the period', async () => {
    const instants: { at: string; value: number }[] = [];
    for (let t = Date.parse(from); t < Date.parse(to); t += 3_600_000) instants.push({ at: new Date(t).toISOString(), value: 50 });
    const { seriesId: measured } = await store(db, { object_kind: 'meter', object_id: ELECTRICITY, quantity_code: 'consumption_energy', kind: 'measured', step: '1 hour' }, instants);
    const days = await db.query<{ value: number; series_id: string; kind: string }>(`select value, series_id, kind from consumption.curve($1, $2, $3, '1 day')`, [BLOCK, from, to]);
    expect(days.rows.map((d) => [d.value, d.kind])).toEqual(Array(7).fill([1200, 'measured']));
    expect(days.rows[0].series_id).toBe(measured);
    // Before the readings start, an estimate still answers; before any curve, nothing does.
    const before = await one<{ s: string | null; kind: string }>(
      db, `select s, (select kind from series where id = s) kind from consumption.curve_series($1, '2026-01-05T00:00:00+01:00', '2026-01-12T00:00:00+01:00') s`, [BLOCK]);
    expect(before.s).not.toBe(measured);
    expect(before.kind).toBe('simulated');
    const december = await one<{ s: string | null }>(db, `select consumption.curve_series($1, '2025-12-01T00:00:00+01:00', '2025-12-08T00:00:00+01:00') s`, [BLOCK]);
    expect(december.s).toBeNull();
  });
});

describe('activity hours', () => {
  it('belong to the organisation of what is open, and close after they open', async () => {
    const id = await insert(db, 'consumption.activity_hours', { organisation_id: ORG, object_kind: 'project', object_id: PROJECT, weekday: 6, opens: '09:00', closes: '24:00' });
    const row = await one<{ organisation_id: string; closes: string }>(db, 'select organisation_id, closes::text from consumption.activity_hours where id = $1', [id]);
    expect(row).toEqual({ organisation_id: ORG, closes: '24:00:00' });
    await expect(insert(db, 'consumption.activity_hours', { organisation_id: ORG, object_kind: 'participant', object_id: BLOCK, weekday: 1, opens: '18:00', closes: '08:00' })).rejects.toThrow(/activity_hours_order/);
    await expect(insert(db, 'consumption.activity_hours', { organisation_id: ORG, object_kind: 'participant', object_id: BLOCK, weekday: 8, opens: '08:00', closes: '18:00' })).rejects.toThrow(/activity_hours_weekday/);
  });

  it('are read and written only by the organisation, and so is the curve', async () => {
    await asUser(db, USER_B, async () => {
      expect((await db.query('select id from consumption.activity_hours')).rows).toEqual([]);
      await expect(db.query(`insert into consumption.activity_hours (organisation_id, object_kind, object_id, weekday, opens, closes) values ($1, 'participant', $2, 1, '08:00', '18:00')`, [ORG, BLOCK]))
        .rejects.toThrow(/object_not_found/);
      expect((await db.query(`select * from consumption.curve($1, '2026-01-12T00:00:00+01:00', '2026-01-19T00:00:00+01:00', '1 day')`, [BLOCK])).rows).toEqual([]);
    });
    await asUser(db, USER_A, async () => {
      expect((await db.query('select id from consumption.activity_hours')).rows.length).toBe(6);
      expect((await db.query(`select * from consumption.curve($1, '2026-01-12T00:00:00+01:00', '2026-01-19T00:00:00+01:00', '1 day')`, [BLOCK])).rows).toHaveLength(7);
    });
  });
});
