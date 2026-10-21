// The series package of the core: one way to write (store(), with its
// units, qualities, steps and runs), the rollups and the latest value it
// keeps, and the family of reads — resample() on a register, on a
// half-hour time zone, on steps of several days; window(), latest(),
// fill(), coverage(), forecast_at(), export_rows() — with the access check
// of a role that carries no signed-in user.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, USER_B, asUser, freshDatabase, insert, one, organisation } from './helpers/db.js';
import { convertUnit, coverage, exportRows, fill, forecastAt, latest, resample, store, window } from '@nexgen-os/core';

let db: PGlite;
let org: string;
let site: string;
let meter: string;

const at = (from: string, n: number, stepMinutes: number) =>
  Array.from({ length: n }, (_, i) => new Date(Date.parse(from) + i * stepMinutes * 60_000).toISOString());

beforeAll(async () => {
  db = await freshDatabase();
  org = await organisation(db, 'A utility', USER_A);
  await organisation(db, 'Another', USER_B);
  site = await insert(db, 'sites', { organisation_id: org, name: 'Depot', country: 'BE', time_zone: 'Europe/Brussels' });
  meter = await insert(db, 'devices', { organisation_id: org, site_id: site, name: 'Meter', device_type: 'meter' });
});

afterAll(async () => {
  await db.close();
});

describe('units', () => {
  it('converts between two units of a kind, by code or symbol, and refuses the others by name', async () => {
    expect(await convertUnit(db, 1500, 'W', 'kW')).toBe(1.5);
    expect(await convertUnit(db, 1, 'KiloW-HR', 'MJ')).toBe(3.6);
    expect(await convertUnit(db, 20, '°C', '°F')).toBeCloseTo(68, 9);
    expect(await convertUnit(db, 0, 'DEG_C', 'K')).toBeCloseTo(273.15, 9);
    await expect(convertUnit(db, 1, 'kWh', 'kW')).rejects.toThrow(/unit_incompatible/);
    await expect(convertUnit(db, 1, 'furlongs', 'm')).rejects.toThrow(/unit_unknown/);
  });

  it('holds the unit of every quantity of the core', async () => {
    const orphans = await db.query<{ code: string }>(
      `select q.code from quantities q where q.published_by = 'core' and not exists (select 1 from units u where u.code = q.unit)`);
    expect(orphans.rows).toEqual([]);
  });
});

describe('store()', () => {
  it('creates the series of an identity, converts from the unit given, and changes nothing the second time', async () => {
    const identity = { object_kind: 'device', object_id: meter, quantity_code: 'offtake_energy', step: '15 minutes', source_code: 'pvgis' };
    const values = at('2026-05-04T08:00:00Z', 4, 15).map((t, i) => ({ at: t, value: 250 * (i + 1) }));
    const first = await store(db, identity, values, { unit: 'Wh' });
    expect(first.changed).toBe(4);
    const stored = await window(db, first.seriesId, '2026-05-04T08:00:00Z', '2026-05-04T09:00:00Z');
    expect(stored.map((v) => v.value)).toEqual([0.25, 0.5, 0.75, 1]);
    const again = await store(db, identity, values, { unit: 'Wh' });
    expect(again).toEqual({ seriesId: first.seriesId, changed: 0 });
  });

  it('refuses by name what does not fit the series', async () => {
    const s = (await store(db, { object_kind: 'device', object_id: meter, quantity_code: 'power', value_kind: 'instant', step: '1 hour' }, [])).seriesId;
    const one_ = [{ at: '2026-05-04T08:00:00Z', value: 1 }];
    await expect(store(db, s, one_, { unit: 'kWh' })).rejects.toThrow(/series_unit_mismatch/);
    await store(db, s, one_);
    await expect(store(db, s, [{ at: '2026-05-04T08:30:00Z', value: 1 }])).rejects.toThrow(/series_step_mismatch/);
    await expect(store(db, { object_kind: 'device', object_id: meter, quantity_code: 'power', value_kind: 'instant', step: '15 minutes' }, one_)).rejects.toThrow(/series_step_mismatch/);
    await expect(store(db, { object_kind: 'device', object_id: meter, quantity_code: 'power', value_kind: 'interval', step: '1 hour' }, one_)).rejects.toThrow(/series_value_kind_mismatch/);
    await expect(store(db, s, [...one_, ...one_])).rejects.toThrow(/values_duplicated/);
    await expect(store(db, s, [{ at: '2026-05-04T09:00:00Z', value: 1, quality: 42 }])).rejects.toThrow(/quality_unknown/);
    await expect(store(db, { object_kind: 'device', object_id: meter, quantity_code: 'power', kind: 'simulated', value_kind: 'instant' }, one_)).rejects.toThrow(/series_run_required/);
    await expect(store(db, s, one_, { issuedAt: '2026-05-04T00:00:00Z' })).rejects.toThrow(/not_a_forecast/);
  });

  it('keeps the quality it is given, stores a null as missing, and keeps the latest value', async () => {
    const s = (await store(db, { object_kind: 'device', object_id: meter, quantity_code: 'temperature', value_kind: 'instant', step: '1 hour' }, [
      { at: '2026-05-04T08:00:00Z', value: 18 },
      { at: '2026-05-04T09:00:00Z', value: 19, quality: 1 },
      { at: '2026-05-04T10:00:00Z', value: null as unknown as number, quality: 3 },
    ])).seriesId;
    const rows = await window(db, s, '2026-05-04T00:00:00Z', '2026-05-05T00:00:00Z');
    expect(rows.map((r) => r.quality)).toEqual([0, 1, 3]);
    expect(Number.isNaN(rows[2].value)).toBe(true);
    expect(await latest(db, [s])).toEqual([{ series_id: s, at: '2026-05-04T09:00:00.000Z', value: 19, quality: 1 }]);
    await store(db, s, [{ at: '2026-05-04T07:00:00Z', value: 17 }]);
    expect((await latest(db, [s]))[0].value).toBe(19);
  });

  it('is the only way an API role writes values', async () => {
    const s = (await store(db, { object_kind: 'device', object_id: meter, quantity_code: 'consumption_energy', step: '1 hour' }, [])).seriesId;
    await expect(asUser(db, USER_A, () => db.query(`insert into series_values (series_id, at, value) values ($1, '2026-05-04T08:00:00Z', 1)`, [s])))
      .rejects.toThrow(/permission denied/);
    const mine = await asUser(db, USER_A, () => store(db, s, [{ at: '2026-05-04T08:00:00Z', value: 1 }]));
    expect(mine.changed).toBe(1);
    await expect(asUser(db, USER_B, () => store(db, s, [{ at: '2026-05-04T09:00:00Z', value: 1 }]))).rejects.toThrow(/series_not_found/);
    await expect(asUser(db, USER_B, () => store(db, { object_kind: 'device', object_id: meter, quantity_code: 'consumption_energy', step: '1 hour' }, [])))
      .rejects.toThrow(/object_not_found/);
  });
});

describe('a cumulative register', () => {
  it('reads as the consumption of each bucket, a reset included, and as its index through window()', async () => {
    const s = (await store(db, { object_kind: 'device', object_id: meter, quantity_code: 'injection_energy', value_kind: 'cumulative', step: '1 hour', source_code: 'pvgis' }, [
      { at: '2026-05-05T08:00:00Z', value: 100 },
      { at: '2026-05-05T09:00:00Z', value: 104 },
      { at: '2026-05-05T10:00:00Z', value: 110 },
      { at: '2026-05-05T11:00:00Z', value: 2 },   // the register restarted from zero
      { at: '2026-05-05T12:00:00Z', value: 5 },
    ])).seriesId;
    const hours = await resample(db, s, '2026-05-05T08:00:00Z', '2026-05-05T12:00:00Z', '1 hour');
    expect(hours.map((b) => b.value)).toEqual([4, 6, 2, 3]);
    const day = await resample(db, s, '2026-05-05T00:00:00+02:00', '2026-05-06T00:00:00+02:00', '1 day');
    expect(day.map((b) => b.value)).toEqual([15]);
    const index = await window(db, s, '2026-05-05T00:00:00Z', '2026-05-06T00:00:00Z');
    expect(index.map((v) => v.value)).toEqual([100, 104, 110, 2, 5]);
  });
});

describe('rollups', () => {
  let s: string;
  beforeAll(async () => {
    s = (await store(db, { object_kind: 'site', object_id: site, quantity_code: 'production_energy', step: '15 minutes', source_code: 'pvgis' },
      at('2026-06-01T00:00:00+02:00', 96 * 31, 15).map((t, i) => ({ at: t, value: (i % 96) / 4 })))).seriesId;
  });

  it('give the same figures as the values, and are not read while an hour is dirty', async () => {
    const raw = {
      hours: await resample(db, s, '2026-06-10T00:00:00Z', '2026-06-11T00:00:00Z', '1 hour'),
      days: await resample(db, s, '2026-06-01T00:00:00+02:00', '2026-07-01T00:00:00+02:00', '1 day'),
      month: await resample(db, s, '2026-06-01T00:00:00+02:00', '2026-07-01T00:00:00+02:00', '1 month'),
    };
    const drained = await one<{ n: number }>(db, 'select series_rollup() n');
    expect(drained.n).toBeGreaterThanOrEqual(31 * 24);
    const counts = await one<{ hours: number; days: number }>(db,
      `select count(*) filter (where step = 'hour')::int hours, count(*) filter (where step = 'day')::int days from series_rollups where series_id = $1`, [s]);
    expect(counts).toEqual({ hours: 31 * 24, days: 31 });
    expect(await resample(db, s, '2026-06-10T00:00:00Z', '2026-06-11T00:00:00Z', '1 hour')).toEqual(raw.hours);
    expect(await resample(db, s, '2026-06-01T00:00:00+02:00', '2026-07-01T00:00:00+02:00', '1 day')).toEqual(raw.days);
    expect(await resample(db, s, '2026-06-01T00:00:00+02:00', '2026-07-01T00:00:00+02:00', '1 month')).toEqual(raw.month);
    expect(raw.month[0]).toMatchObject({ samples: 96 * 30, expected: 96 * 30, quality: 0 });

    // A corrected value makes its hour dirty: the read goes back to the values until the next rollup.
    await store(db, s, [{ at: '2026-06-10T10:00:00Z', value: 100 }]);
    const corrected = await resample(db, s, '2026-06-10T00:00:00+02:00', '2026-06-11T00:00:00+02:00', '1 day');
    expect(corrected[0].value).toBeCloseTo(raw.days[9].value! - 12 + 100, 9);
    await db.query('select series_rollup()');
    expect(await resample(db, s, '2026-06-10T00:00:00+02:00', '2026-06-11T00:00:00+02:00', '1 day')).toEqual(corrected);
  });
});

describe('buckets', () => {
  it('fall on the local hours of a half-hour time zone', async () => {
    const india = await insert(db, 'sites', { organisation_id: org, name: 'Pune', country: 'IN', time_zone: 'Asia/Kolkata' });
    const s = (await store(db, { object_kind: 'site', object_id: india, quantity_code: 'production_energy', step: '30 minutes', source_code: 'pvgis' },
      at('2026-05-04T08:00:00+05:30', 4, 30).map((t) => ({ at: t, value: 1 })))).seriesId;
    const r = await resample(db, s, '2026-05-04T08:00:00+05:30', '2026-05-04T10:00:00+05:30', '1 hour');
    expect(r.map((b) => [b.bucket, b.value])).toEqual([['2026-05-04T02:30:00.000Z', 2], ['2026-05-04T03:30:00.000Z', 2]]);
  });

  it('honour a step of several days, and refuse one that mixes calendar units', async () => {
    const s = (await store(db, { object_kind: 'site', object_id: site, quantity_code: 'offtake_energy', step: '1 day', source_code: 'pvgis' },
      Array.from({ length: 6 }, (_, i) => ({ at: `2026-03-0${i + 1}T00:00:00+01:00`, value: 1 })))).seriesId;
    const r = await resample(db, s, '2026-03-01T00:00:00+01:00', '2026-03-07T00:00:00+01:00', '2 days');
    expect(r.map((b) => b.value)).toEqual([2, 2, 2]);
    await expect(resample(db, s, '2026-03-01', '2026-03-07', '1 day 2 hours')).rejects.toThrow(/step_unsupported/);
  });
});

describe('gaps', () => {
  let s: string;
  beforeAll(async () => {
    // Eight quarter-hours with the third and fourth absent and the sixth missing.
    const values = at('2026-05-06T08:00:00Z', 8, 15).map((t, i) => ({ at: t, value: i + 1, quality: i === 5 ? 3 : 0 }))
      .filter((_, i) => i !== 2 && i !== 3);
    s = (await store(db, { object_kind: 'device', object_id: meter, quantity_code: 'temperature', value_kind: 'instant', step: '15 minutes', name: 'flow' }, values)).seriesId;
  });

  it('are found by coverage()', async () => {
    expect(await coverage(db, s, '2026-05-06T08:00:00Z', '2026-05-06T10:00:00Z')).toEqual([
      { gap_from: '2026-05-06T08:30:00.000Z', gap_to: '2026-05-06T09:00:00.000Z', missing: 2 },
      { gap_from: '2026-05-06T09:15:00.000Z', gap_to: '2026-05-06T09:30:00.000Z', missing: 1 },
    ]);
  });

  it('are filled on read, flagged estimated, and nothing is written', async () => {
    const before = await one<{ n: number }>(db, 'select count(*)::int n from series_values where series_id = $1', [s]);
    const linear = await fill(db, s, '2026-05-06T08:00:00Z', '2026-05-06T10:00:00Z', '15 minutes', 'linear');
    expect(linear.map((b) => b.value)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(linear.map((b) => b.quality)).toEqual([0, 0, 1, 1, 0, 1, 0, 0]);
    const previous = await fill(db, s, '2026-05-06T08:00:00Z', '2026-05-06T10:00:00Z', '15 minutes', 'previous');
    expect(previous.map((b) => b.value)).toEqual([1, 2, 2, 2, 5, 5, 7, 8]);
    const none = await fill(db, s, '2026-05-06T08:00:00Z', '2026-05-06T10:00:00Z', '15 minutes', 'none');
    expect(none.map((b) => b.quality)).toEqual([0, 0, 3, 3, 0, 3, 0, 0]);
    expect(none[2]).toMatchObject({ value: null, samples: 0, expected: 1 });
    expect(await one<{ n: number }>(db, 'select count(*)::int n from series_values where series_id = $1', [s])).toEqual(before);
    await expect(db.query(`select * from fill($1, now(), now(), '1 hour', 'guess')`, [s])).rejects.toThrow(/fill_method_unknown/);
  });
});

describe('a forecast', () => {
  it('is read as known at a time, or at a horizon before each instant', async () => {
    const identity = { object_kind: 'site', object_id: site, quantity_code: 'temperature', kind: 'forecast' as const, value_kind: 'instant' as const, step: '1 hour', source_code: 'open_meteo' };
    const hours = at('2026-05-07T12:00:00Z', 3, 60);
    const s = (await store(db, identity, hours.map((t) => ({ at: t, value: 10 })), { issuedAt: '2026-05-06T06:00:00Z' })).seriesId;
    await store(db, s, hours.map((t) => ({ at: t, value: 12 })), { issuedAt: '2026-05-07T06:00:00Z' });
    await store(db, s, hours.map((t) => ({ at: t, value: 13 })), { issuedAt: '2026-05-07T12:30:00Z' });
    const of = (rows: { value: number }[]) => rows.map((r) => r.value);
    expect(of(await forecastAt(db, s, hours[0], '2026-05-07T15:00:00Z'))).toEqual([13, 13, 13]);
    expect(of(await forecastAt(db, s, hours[0], '2026-05-07T15:00:00Z', { asOf: '2026-05-07T07:00:00Z' }))).toEqual([12, 12, 12]);
    const dayAhead = await forecastAt(db, s, hours[0], '2026-05-07T15:00:00Z', { horizon: '24 hours' });
    expect(dayAhead.map((r) => [r.value, r.issued_at])).toEqual([[10, '2026-05-06T06:00:00.000Z'], [10, '2026-05-06T06:00:00.000Z'], [10, '2026-05-06T06:00:00.000Z']]);
    await expect(forecastAt(db, s, hours[0], hours[2], { asOf: hours[0], horizon: '1 hour' })).rejects.toThrow(/as_of_or_horizon/);
    await expect(store(db, s, [{ at: hours[0], value: 1 }])).rejects.toThrow(/issued_at_required/);
  });
});

describe('reading', () => {
  it('exports rows sorted by series and time, for the series the caller may read', async () => {
    const a = (await store(db, { object_kind: 'device', object_id: meter, quantity_code: 'energy', step: '1 hour', source_code: 'pvgis' },
      [{ at: '2026-05-08T01:00:00Z', value: 2 }, { at: '2026-05-08T00:00:00Z', value: 1 }])).seriesId;
    const rows = await exportRows(db, [a], '2026-05-08T00:00:00Z', '2026-05-09T00:00:00Z');
    expect(rows).toEqual([
      { series_id: a, at: '2026-05-08T00:00:00.000Z', value: 1, quality: 0 },
      { series_id: a, at: '2026-05-08T01:00:00.000Z', value: 2, quality: 0 },
    ]);
    await expect(asUser(db, USER_B, () => exportRows(db, [a], '2026-05-08', '2026-05-09'))).rejects.toThrow(/series_not_found/);
  });

  it('gives nothing to a role that carries no signed-in user and does not bypass row level security', async () => {
    const s = await one<{ id: string }>(db, `select id from series where quantity_code = 'energy' and object_id = $1`, [meter]);
    await db.exec(`create role dashboard nologin; grant usage on schema nexgen to dashboard;
                   grant execute on function nexgen.resample(uuid, timestamptz, timestamptz, interval, text, timestamptz) to dashboard`);
    await db.exec('set role dashboard');
    try {
      await expect(db.query(`select * from nexgen.resample($1, '2026-05-08', '2026-05-09', '1 hour')`, [s.id])).rejects.toThrow(/series_not_found/);
    } finally {
      await db.exec('reset role');
    }
    const asOwner = await db.query(`select * from resample($1, '2026-05-08', '2026-05-09', '1 hour')`, [s.id]);
    expect(asOwner.rows).toHaveLength(2);
  });
});

describe('weekly partitions', () => {
  it('are bounded at UTC midnights whatever the session time zone', async () => {
    const s = (await store(db, { object_kind: 'device', object_id: meter, quantity_code: 'power', value_kind: 'instant', name: 'partition probe' }, [
      { at: '2026-05-10T23:30:00Z', value: 1 },   // the Sunday before, in UTC
      { at: '2026-05-11T00:30:00Z', value: 2 },   // the Monday of the week
    ])).seriesId;
    await db.exec(`set timezone = 'Asia/Tokyo'`);
    try {
      const { name } = await one<{ name: string }>(db, `select series_values_partition('2026-05-13') as name`);
      const moved = await one<{ n: number }>(db, `select count(*)::int n from ${name} where series_id = $1`, [s]);
      expect(moved.n).toBe(1);
    } finally {
      await db.exec(`set timezone = 'UTC'`);
    }
  });
});
