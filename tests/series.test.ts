// The series store at scale: weekly partitions, daily buckets cut in the
// site's time zone across a daylight-saving change, a named refusal when
// the time zone is unknown, and access that goes through the series.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, USER_B, asUser, freshDatabase, insert, one, organisation } from './helpers/db.js';

let db: PGlite;
let org: string;
let meter: string;
let energy: string;

beforeAll(async () => {
  db = await freshDatabase();
  org = await organisation(db, 'A utility', USER_A);
  await organisation(db, 'Another', USER_B);
  const site = await insert(db, 'sites', { organisation_id: org, name: 'Depot', country: 'BE', time_zone: 'Europe/Brussels' });
  meter = await insert(db, 'meters', { organisation_id: org, site_id: site, identifier: '541400000000000001', scheme: 'gs1_gsrn' });
  energy = await insert(db, 'series', { organisation_id: org, object_id: meter, quantity_code: 'energy_import', kind: 'measured', value_kind: 'interval', step: '15 minutes' });
  // Two weeks around the spring change (29 March 2026, 02:00 → 03:00 in Brussels), 1 kWh per quarter-hour.
  await db.query(
    `insert into series_values (series_id, at, value)
     select $1, ts, 1 from generate_series('2026-03-23 00:00+01'::timestamptz, '2026-04-05 23:45+02', '15 minutes') ts`,
    [energy],
  );
});

afterAll(async () => {
  await db.close();
});

describe('the series store', () => {
  it('cuts daily buckets in the site time zone, 92 quarter-hours on the short day', async () => {
    const r = await db.query<{ bucket: Date; value: number; samples: number }>(
      `select bucket, value, samples from resample($1, '2026-03-28 00:00+01', '2026-03-31 00:00+02', '1 day')`,
      [energy],
    );
    expect(r.rows.map((x) => [new Date(x.bucket).toISOString(), x.samples])).toEqual([
      ['2026-03-27T23:00:00.000Z', 96],
      ['2026-03-28T23:00:00.000Z', 92],
      ['2026-03-29T22:00:00.000Z', 96],
    ]);
    expect(r.rows[1].value).toBe(92);
  });

  it('refuses a daily step for a site without a time zone, by name', async () => {
    const site = await insert(db, 'sites', { organisation_id: org, name: 'Nowhere', country: 'BE' });
    const s = await insert(db, 'series', { organisation_id: org, object_id: site, quantity_code: 'power', kind: 'measured', value_kind: 'instant' });
    await expect(db.query(`select * from resample($1, '2026-01-01', '2026-01-02', '1 day')`, [s])).rejects.toThrow(/time_zone_required/);
    const r = await db.query(`select * from resample($1, '2026-01-01', '2026-01-02', '1 day', 'Europe/Brussels')`, [s]);
    expect(r.rows).toEqual([]);
  });

  it('moves a week out of the default partition into its own', async () => {
    const before = await one<{ n: number }>(db, 'select count(*)::int n from series_values_default');
    const name = await one<{ name: string }>(db, `select series_values_partition('2026-03-25') name`);
    expect(name.name).toBe('series_values_2026_w13');
    const after = await one<{ n: number; moved: number; total: number }>(
      db,
      `select (select count(*)::int from series_values_default) n,
              (select count(*)::int from series_values_2026_w13) moved,
              (select count(*)::int from series_values) total`,
    );
    expect(after.moved).toBe(7 * 96); // partition bounds are UTC midnights
    expect(after.n + after.moved).toBe(before.n);
    expect(after.total).toBe(before.n);
    const again = await one<{ name: string }>(db, `select series_values_partition('2026-03-29') name`);
    expect(again.name).toBe('series_values_2026_w13');
  });

  it('shows values to the members of the series organisation only', async () => {
    const mine = await asUser(db, USER_A, () => one<{ n: number }>(db, 'select count(*)::int n from series_values where series_id = $1', [energy]));
    const theirs = await asUser(db, USER_B, () => one<{ n: number }>(db, 'select count(*)::int n from series_values where series_id = $1', [energy]));
    expect(mine.n).toBe(14 * 96 - 4);
    expect(theirs.n).toBe(0);
    await expect(
      asUser(db, USER_B, () => db.query(`select * from resample($1, '2026-03-23', '2026-03-24', '1 hour')`, [energy])),
    ).rejects.toThrow(/series_not_found/);
  });

  it('keeps missing values out of the aggregates', async () => {
    await db.query(`update series_values set quality = 3 where series_id = $1 and at >= '2026-03-23 10:00+01' and at < '2026-03-23 11:00+01'`, [energy]);
    const r = await db.query<{ value: number | null; samples: number }>(
      `select value, samples from resample($1, '2026-03-23 09:00+01', '2026-03-23 12:00+01', '1 hour')`,
      [energy],
    );
    expect(r.rows.map((x) => x.samples)).toEqual([4, 4]);
  });
});
