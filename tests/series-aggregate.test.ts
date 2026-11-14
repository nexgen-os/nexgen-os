// aggregate(): several series of one summable quantity added up on one
// step — the meters of a community, a register beside an interval series —
// each read by resample() on the same buckets, with the count of series
// that held a value in each bucket, and its refusals by name.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, USER_B, asUser, freshDatabase, insert, organisation, participant } from './helpers/db.js';
import { aggregate, resample, store } from '@nexgen-os/core';

let db: PGlite;
let org: string;
let brussels: string;
let lisbon: string;
let meterA: string;
let meterB: string;
let meterC: string;

const hours = (from: string, values: number[]) =>
  values.map((value, i) => ({ at: new Date(Date.parse(from) + i * 3_600_000).toISOString(), value }));

const series = (object_id: string, quantity_code: string, values: { at: string; value: number }[], value_kind = 'interval') =>
  store(db, { object_kind: 'device', object_id, quantity_code, value_kind: value_kind as 'interval', step: '1 hour', source_code: 'pvgis' }, values)
    .then((r) => r.seriesId);

beforeAll(async () => {
  db = await freshDatabase();
  org = await organisation(db, 'A community', USER_A);
  await organisation(db, 'Another', USER_B);
  brussels = await participant(db, { organisation_id: org, name: 'Bakery', country: 'BE', time_zone: 'Europe/Brussels' });
  const school = await participant(db, { organisation_id: org, name: 'School', country: 'BE', time_zone: 'Europe/Brussels' });
  lisbon = await participant(db, { organisation_id: org, name: 'Office', country: 'PT', time_zone: 'Europe/Lisbon' });
  meterA = await insert(db, 'devices', { organisation_id: org, participant_id: brussels, name: 'Meter A', device_type: 'meter' });
  meterB = await insert(db, 'devices', { organisation_id: org, participant_id: school, name: 'Meter B', device_type: 'meter' });
  meterC = await insert(db, 'devices', { organisation_id: org, participant_id: lisbon, name: 'Meter C', device_type: 'meter' });
});

afterAll(async () => {
  await db.close();
});

describe('aggregate()', () => {
  it('adds up the series bucket by bucket, a register by its consumption, and counts the series in each bucket', async () => {
    const a = await series(meterA, 'offtake_energy', hours('2026-06-01T08:00:00Z', [1, 2, 3, 4]));
    // A register: its index, read as the consumption of each hour.
    const b = await series(meterB, 'offtake_energy', hours('2026-06-01T08:00:00Z', [100, 110, 130, 160, 200]), 'cumulative');
    const r = await aggregate(db, [a, b, a], '2026-06-01T08:00:00Z', '2026-06-01T12:00:00Z', '1 hour');
    expect(r.map((x) => [x.bucket, x.value, x.series])).toEqual([
      ['2026-06-01T08:00:00.000Z', 11, 2],
      ['2026-06-01T09:00:00.000Z', 22, 2],
      ['2026-06-01T10:00:00.000Z', 33, 2],
      ['2026-06-01T11:00:00.000Z', 44, 2],
    ]);
    expect(r[0]).toMatchObject({ samples: 2, expected: 2, quality: 0 });
  });

  it('gives the same total as resample() of each series, and says where a series is missing', async () => {
    const a = await series(meterA, 'consumption_energy', hours('2026-06-02T08:00:00Z', [1, 1, 1]));
    const b = await series(meterB, 'consumption_energy', hours('2026-06-02T08:00:00Z', [2, 2]));
    const r = await aggregate(db, [a, b], '2026-06-02T08:00:00Z', '2026-06-02T11:00:00Z', '1 hour');
    expect(r.map((x) => [x.value, x.series])).toEqual([[3, 2], [3, 2], [1, 1]]);
    const each = [
      ...(await resample(db, a, '2026-06-02T08:00:00Z', '2026-06-02T11:00:00Z', '1 hour')),
      ...(await resample(db, b, '2026-06-02T08:00:00Z', '2026-06-02T11:00:00Z', '1 hour')),
    ];
    expect(r.reduce((t, x) => t + (x.value ?? 0), 0)).toBe(each.reduce((t, x) => t + (x.value ?? 0), 0));
  });

  it('cuts days in the time zone the series share, and asks for one when they differ', async () => {
    const a = await series(meterA, 'injection_energy', hours('2026-06-03T20:00:00Z', [1, 1, 1, 1, 1, 1]));
    const b = await series(meterB, 'injection_energy', hours('2026-06-03T20:00:00Z', [1, 1, 1, 1, 1, 1]));
    // 20:00 to 02:00 UTC is 22:00 to 04:00 in Brussels: two hours on the 3rd, four on the 4th.
    const days = await aggregate(db, [a, b], '2026-06-03T00:00:00+02:00', '2026-06-05T00:00:00+02:00', '1 day');
    expect(days.map((x) => x.value)).toEqual([4, 8]);
    const c = await series(meterC, 'injection_energy', hours('2026-06-03T20:00:00Z', [1, 1, 1, 1, 1, 1]));
    await expect(aggregate(db, [a, c], '2026-06-03T00:00:00Z', '2026-06-05T00:00:00Z', '1 day')).rejects.toThrow(/time_zone_required/);
    const lisbonDays = await aggregate(db, [a, c], '2026-06-03T00:00:00+01:00', '2026-06-05T00:00:00+01:00', '1 day', { timeZone: 'Europe/Lisbon' });
    // 20:00 to 02:00 UTC is 21:00 to 03:00 in Lisbon: three hours on each day.
    expect(lisbonDays.map((x) => x.value)).toEqual([6, 6]);
  });

  it('refuses by name what does not add up', async () => {
    const energy = await series(meterA, 'offtake_energy', []);
    const other = await series(meterB, 'injection_energy', []);
    const temperature = (await store(db, { object_kind: 'device', object_id: meterA, quantity_code: 'temperature', value_kind: 'instant', step: '1 hour' }, [])).seriesId;
    await expect(aggregate(db, [], '2026-06-01', '2026-06-02', '1 hour')).rejects.toThrow(/series_required/);
    await expect(aggregate(db, [energy, other], '2026-06-01', '2026-06-02', '1 hour')).rejects.toThrow(/quantities_differ/);
    await expect(aggregate(db, [temperature], '2026-06-01', '2026-06-02', '1 hour')).rejects.toThrow(/quantity_not_summable/);
    await expect(aggregate(db, [energy], '2026-06-01', '2026-06-02', '1 day 2 hours')).rejects.toThrow(/step_unsupported/);
  });

  it('reads only series the caller may read', async () => {
    const a = await series(meterA, 'offtake_energy', []);
    const mine = await asUser(db, USER_A, () => aggregate(db, [a], '2026-06-01T08:00:00Z', '2026-06-01T12:00:00Z', '1 hour'));
    expect(mine.length).toBe(4);
    await expect(asUser(db, USER_B, () => aggregate(db, [a], '2026-06-01T08:00:00Z', '2026-06-01T12:00:00Z', '1 hour'))).rejects.toThrow(/series_not_found/);
  });
});
