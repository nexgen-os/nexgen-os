// Raw values kept as long as the place decides (decision 0007): series_retain()
// removes what is older than the retention parameter_of() resolves, cut at the
// hour, and the hourly and daily rollups outlive the values they summarise.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, asUser, freshDatabase, insert, one, organisation, participant } from './helpers/db.js';

let db: PGlite;
let org: string;
let meter: string;
let kept: string;
let retained: string;
let own: string;

const AT = '2026-03-10 12:30+00';

async function series(quantity: string): Promise<string> {
  const id = await insert(db, 'series', { organisation_id: org, object_kind: 'device', object_id: meter, quantity_code: quantity, kind: 'measured', value_kind: 'interval', step: '15 minutes' });
  // Ten days of quarter-hours, 1 kWh each, from 1 to 10 March.
  await db.query(
    `insert into series_values (series_id, at, value)
     select $1, ts, 1 from generate_series('2026-03-01 00:00+00'::timestamptz, '2026-03-10 23:45+00', '15 minutes') ts`,
    [id],
  );
  return id;
}

beforeAll(async () => {
  db = await freshDatabase();
  org = await organisation(db, 'A utility', USER_A);
  const home = await participant(db, { organisation_id: org, name: 'Depot', country: 'BE', time_zone: 'UTC' });
  meter = await insert(db, 'devices', { organisation_id: org, participant_id: home, name: 'Meter', device_type: 'meter' });
  kept = await series('offtake_energy');
  retained = await series('injection_energy');
  own = await series('consumption_energy');
});

afterAll(async () => {
  await db.close();
});

describe('series_retain()', () => {
  it('keeps every value of a series without a retention', async () => {
    const r = await db.query(`select * from series_retain(array[$1]::uuid[], $2)`, [kept, AT]);
    expect(r.rows).toEqual([]);
    expect((await one<{ n: number }>(db, `select count(*)::int n from series_values where series_id = $1`, [kept])).n).toBe(960);
  });

  it('removes the values older than the retention its organisation decides, cut at the hour, and keeps the rollups', async () => {
    await db.query(`select set_attribute('organisation', $1, 'series_retention', '"P3D"', null, null, 'board decision')`, [org]);
    const before = await db.query<{ value: number }>(`select value from resample($1, '2026-03-01 00:00+00', '2026-03-11 00:00+00', '1 day')`, [retained]);

    const r = await one<{ retention: string; kept_from: Date; removed: number }>(
      db, `select retention, kept_from, removed::int from series_retain(array[$1]::uuid[], $2)`, [retained, AT]);
    // 12:30 three days before is 7 March 12:30, cut at 12:00: 6 days and 12 hours of quarter-hours go.
    expect(r.retention).toBe('P3D');
    expect(new Date(r.kept_from).toISOString()).toBe('2026-03-07T12:00:00.000Z');
    expect(r.removed).toBe(6 * 96 + 12 * 4);
    const first = await one<{ at: Date }>(db, `select min(at) at from series_values where series_id = $1`, [retained]);
    expect(new Date(first.at).toISOString()).toBe('2026-03-07T12:00:00.000Z');

    // The days read the same: the rollups outlive the values.
    const after = await db.query<{ value: number }>(`select value from resample($1, '2026-03-01 00:00+00', '2026-03-11 00:00+00', '1 day')`, [retained]);
    expect(after.rows.map((x) => x.value)).toEqual(before.rows.map((x) => x.value));
    expect(after.rows.map((x) => x.value)).toEqual(Array(10).fill(96));
  });

  it('takes the retention of the series before the organisation\'s, for every series when none is named', async () => {
    await db.query(`select set_attribute('series', $1, 'series_retention', '"P1D"', null, null, 'raw values kept a day')`, [own]);
    const r = await db.query<{ series_id: string; retention: string; removed: number }>(
      `select series_id, retention, removed::int from series_retain(p_at => $1) order by retention`, [AT]);
    const by = Object.fromEntries(r.rows.map((x) => [x.series_id, [x.retention, x.removed]]));
    expect(by[own]).toEqual(['P1D', 8 * 96 + 12 * 4]);
    expect(by[retained]).toEqual(['P3D', 0]);
    // The organisation's retention reaches the series that had none.
    expect(by[kept]).toEqual(['P3D', 6 * 96 + 12 * 4]);
  });

  it('refuses a retention that is not an ISO 8601 duration, by name', async () => {
    await db.query(`select set_attribute('series', $1, 'series_retention', '"3 days"', null, null, 'typo')`, [kept]);
    await expect(db.query(`select * from series_retain(array[$1]::uuid[], $2)`, [kept, AT])).rejects.toThrow(/^retention_invalid: 3 days/);
  });

  it('is not a function of the API roles', async () => {
    await expect(asUser(db, USER_A, () => db.query(`select * from series_retain()`))).rejects.toThrow(/permission denied/);
  });
});
