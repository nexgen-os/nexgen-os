// The `flexibility` module: a PV system of 10 kW whose production is read
// hour by hour over a morning, the power it can give up worked out by hand —
// its operating point, capped by the power downwards it declares, read from
// a power series or from an energy series turned into its mean power.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { store } from '@nexgen-os/core';
import { USER_A, USER_B, asUser, freshDatabase, one, organisation, participant } from '../../../tests/helpers/db.js';

const START = Date.parse('2026-06-01T06:00:00Z');
const at = (minutes: number) => new Date(START + minutes * 60_000).toISOString();

/** The production power of the system, kW, every 15 minutes from 06:00 to 08:00. */
const POWER = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5];

let db: PGlite;
let pv: string;
let power: string;
let energy: string;

const refusal = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    return (e as Error).message.split(':')[0];
  }
  return 'accepted';
};

const available = async (seriesId: string, step = '1 hour') =>
  (await db.query<{ bucket: Date; operating_kw: number; available_kw: number }>(
    `select bucket, operating_kw, available_kw from flexibility.power_down_available($1, $2, $3, $4::interval)`,
    [seriesId, at(0), at(120), step])).rows
    .map((r) => [r.bucket.toISOString(), Number(r.operating_kw.toFixed(6)), Number(r.available_kw.toFixed(6))]);

beforeAll(async () => {
  db = await freshDatabase(['flexibility']);
  const org = await organisation(db, 'A solar cooperative');
  await organisation(db, 'Another company', USER_B);
  // A country is data: Testland, its currency and its time zone, as a pack writes them.
  await db.query(`insert into currencies (code, name) values ('ZZZ', 'Testland currency') on conflict do nothing`);
  await db.query(`insert into countries (code, name, currency, time_zones, region_level, pack_version, published_by)
                  values ('ZZ', 'Testland', 'ZZZ', '{UTC}', 'region', '0.1.0', 'pack:zz')`);
  const site = await participant(db, { organisation_id: org, name: 'Barn roof', country: 'ZZ', time_zone: 'UTC' });
  pv = (await one<{ id: string }>(db, `select install_device($1, 'solar', 'Barn PV', null, 10, '2025-01-01') id`, [site])).id;
  ({ seriesId: power } = await store(db, { object_kind: 'device', object_id: pv, quantity_code: 'production_power', step: '15 minutes' },
    POWER.map((value, i) => ({ at: at(15 * i), value }))));
  // The same production as energy per quarter hour: kW x 0.25 h.
  ({ seriesId: energy } = await store(db, { object_kind: 'device', object_id: pv, quantity_code: 'production_energy', step: '15 minutes' },
    POWER.map((value, i) => ({ at: at(15 * i), value: value * 0.25 }))));
});

afterAll(async () => {
  await db.close();
});

describe('a flexible device', () => {
  it('is a device of any type, with the same id and its organisation, and refuses what cannot be asked', async () => {
    await db.query(`insert into flexibility.devices (id, power_down_kw, ramp_kw_per_min, notice) values ($1, null, 2, '5 minutes')`, [pv]);
    expect((await one<{ same: boolean }>(db, `select f.organisation_id = d.organisation_id same from flexibility.devices f join devices d using (id) where f.id = $1`, [pv])).same).toBe(true);
    expect(await refusal(() => db.query(`update flexibility.devices set power_down_kw = -1 where id = $1`, [pv]))).toMatch(/devices_power_non_negative/);
    expect(await refusal(() => db.query(`update flexibility.devices set min_duration = '2 hours', max_duration = '1 hour' where id = $1`, [pv]))).toMatch(/devices_durations/);
    expect(await refusal(() => db.query(`insert into flexibility.devices (id) values (gen_random_uuid())`))).toBe('device_not_found');
  });

  it('is read by its organisation and by nobody else', async () => {
    expect((await asUser(db, USER_A, () => db.query('select id from flexibility.devices'))).rows).toHaveLength(1);
    expect((await asUser(db, USER_B, () => db.query('select id from flexibility.devices'))).rows).toHaveLength(0);
  });
});

describe('the power a generator can give up', () => {
  it('is its operating point when it declares no cap: the mean of each hour', async () => {
    // 06:00: (0.5 + 1.5 + 2.5 + 3.5) / 4 = 2; 07:00: (4.5 + 5.5 + 6.5 + 7.5) / 4 = 6.
    expect(await available(power)).toEqual([
      ['2026-06-01T06:00:00.000Z', 2, 2],
      ['2026-06-01T07:00:00.000Z', 6, 6],
    ]);
  });

  it('reads an energy series as its mean power, the same figures', async () => {
    // 06:00: (0.125 + 0.375 + 0.625 + 0.875) kWh in one hour = 2 kW.
    expect(await available(energy)).toEqual(await available(power));
    // At its own step: 0.125 kWh in a quarter hour = 0.5 kW.
    expect((await available(energy, '15 minutes'))[0]).toEqual(['2026-06-01T06:00:00.000Z', 0.5, 0.5]);
  });

  it('is capped by the power downwards the device declares, and never more than it produces', async () => {
    await db.query(`update flexibility.devices set power_down_kw = 4 where id = $1`, [pv]);
    expect(await available(power)).toEqual([
      ['2026-06-01T06:00:00.000Z', 2, 2],
      ['2026-06-01T07:00:00.000Z', 6, 4],
    ]);
  });

  it('is refused by name on a series that is not the production of a device', async () => {
    const { seriesId: setpoint } = await store(db, { object_kind: 'device', object_id: pv, quantity_code: 'production_power', kind: 'setpoint', value_kind: 'instant', name: 'setpoint' },
      [{ at: at(0), value: 3 }]);
    const { seriesId: consumption } = await store(db, { object_kind: 'device', object_id: pv, quantity_code: 'consumption_power', step: '15 minutes' },
      [{ at: at(0), value: 1 }]);
    expect(await refusal(() => available(consumption))).toBe('production_series_required');
    expect(await refusal(() => available(setpoint))).toBe('production_series_required');
    expect(await refusal(() => db.query(`select * from flexibility.power_down_available(gen_random_uuid(), now(), now())`))).toBe('series_not_found');
    expect(await refusal(() => available(power, '1 month'))).toBe('step_unsupported');
  });

  it('is not read by another organisation', async () => {
    expect(await asUser(db, USER_B, () => refusal(() => available(power)))).toBe('series_not_found');
  });
});
