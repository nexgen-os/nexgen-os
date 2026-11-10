// @nexgen-os/homewizard, offline: the answers of the local API v1 are
// fixtures built after the examples of its documentation. Then the whole
// path on a database: the source registered, two readings a quarter hour
// apart stored on the meter of the connection and on the gas meter, and the
// energy of the quarter hour read back by resample().
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { registerSource, resample, storeSeries, type Db } from '@nexgen-os/core';
import { decodeIdentifier, homewizard, homewizardSource, readingOfHomeWizard, wallClockOf, type HttpFetch } from '../src/index.js';
import { freshDatabase, insert, one, organisation } from '../../../../tests/helpers/db.js';

const json = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as Record<string, unknown>;
const ZONE = 'Europe/Amsterdam';
const COUNTRY = 'NL'; // the place of the example, data of this test
const AT = Date.parse('2026-11-10T21:00:00.400Z');

/** A fake dongle: answers by path, in order for a path answered several times; records every URL. */
function fakeDongle(routes: Record<string, unknown[]>, status = 200): { fetch: HttpFetch; urls: string[] } {
  const urls: string[] = [];
  const fetch: HttpFetch = async (url) => {
    urls.push(url);
    const queue = routes[new URL(url).pathname];
    if (status !== 200 || !queue?.length) return { ok: false, status: status !== 200 ? status : 404, json: async () => ({}), text: async () => 'refused' };
    const answer = queue.length > 1 ? queue.shift() : queue[0];
    return { ok: true, status: 200, json: async () => answer, text: async () => JSON.stringify(answer) };
  };
  return { fetch, urls };
}

describe('the local API v1', () => {
  it('reads the dongle at the address of its connectors row and says what it is', async () => {
    const dongle = fakeDongle({ '/api': [json('api.json')], '/api/v1/data': [json('data-three-phase.json')] });
    const client = homewizard({ host: '192.168.1.20', fetch: dongle.fetch, now: () => AT, timeZone: ZONE });
    expect(await client.identify()).toEqual({ product_type: 'HWE-P1', product_name: 'P1 meter', serial: '3c39e7aabbcc', firmware_version: '4.19', api_version: 'v1' });
    expect((await client.read()).at).toBe('2026-11-10T21:00:00.000Z');
    expect(dongle.urls).toEqual(['http://192.168.1.20/api', 'http://192.168.1.20/api/v1/data']);
  });

  it('refuses by name: no address, the local API not enabled, another product, another API', async () => {
    expect(() => homewizard({ host: '' })).toThrow(/connector_config_required/);
    await expect(homewizard({ host: 'p1meter.local', fetch: fakeDongle({}, 403).fetch }).read()).rejects.toThrow(/source_unauthorised: .*enable the local API/);
    await expect(homewizard({ host: 'p1meter.local', fetch: fakeDongle({}, 500).fetch }).read()).rejects.toThrow(/source_unavailable: homewizard 500/);
    const down: HttpFetch = async () => { throw new Error('connect EHOSTUNREACH'); };
    await expect(homewizard({ host: 'http://p1meter.local/', fetch: down }).read()).rejects.toThrow(/source_unavailable: homewizard at http:\/\/p1meter.local does not answer/);
    const socket = fakeDongle({ '/api': [{ ...json('api.json'), product_type: 'HWE-SKT' }] });
    await expect(homewizard({ host: 'h', fetch: socket.fetch }).identify()).rejects.toThrow(/device_unsupported: .*not HWE-SKT/);
    const v2 = fakeDongle({ '/api': [{ ...json('api.json'), api_version: 'v2' }] });
    await expect(homewizard({ host: 'h', fetch: v2.fetch }).identify()).rejects.toThrow(/device_unsupported: .*gives v2/);
  });
});

describe('a reading in the core terms', () => {
  it('gives the registers by tariff, the power split by direction and the voltage of each phase', () => {
    const reading = readingOfHomeWizard(json('data-three-phase.json'), { at: AT, timeZone: ZONE });
    expect(reading.meter).toEqual({ identifier: 'Newton 3334', model: 'ISKRA 2M550T-101', smr_version: 50, active_tariff: 2 });
    expect(reading.series.map((s) => [s.quantity_code, s.value_kind, s.step, s.unit, s.name, s.values[0]!.value])).toEqual([
      ['offtake_energy', 'cumulative', null, 'KiloW-HR', null, 13779.338],
      ['offtake_energy', 'cumulative', null, 'KiloW-HR', 'tariff 1', 10830.511],
      ['offtake_energy', 'cumulative', null, 'KiloW-HR', 'tariff 2', 2948.827],
      ['injection_energy', 'cumulative', null, 'KiloW-HR', null, 3201.112],
      ['injection_energy', 'cumulative', null, 'KiloW-HR', 'tariff 1', 1285.951],
      ['injection_energy', 'cumulative', null, 'KiloW-HR', 'tariff 2', 1915.161],
      ['offtake_power', 'instant', null, 'W', null, 0],
      ['injection_power', 'instant', null, 'W', null, 543],
      ['offtake_power', 'instant', null, 'W', 'L1', 0],
      ['injection_power', 'instant', null, 'W', 'L1', 676],
      ['offtake_power', 'instant', null, 'W', 'L2', 133],
      ['injection_power', 'instant', null, 'W', 'L2', 0],
      ['offtake_power', 'instant', null, 'W', 'L3', 0],
      ['injection_power', 'instant', null, 'W', 'L3', 0],
      ['voltage', 'instant', null, 'V', 'L1', 235.4],
      ['voltage', 'instant', null, 'V', 'L2', 231.9],
      ['voltage', 'instant', null, 'V', 'L3', 233.1],
    ]);
    // Every electricity value is dated when it was read.
    expect(new Set(reading.series.map((s) => s.values[0]!.at))).toEqual(new Set(['2026-11-10T21:00:00.000Z']));
  });

  it('gives each meter of the bus at its own stamp, in the participant zone, and skips a unit the core has no quantity for', () => {
    const reading = readingOfHomeWizard(json('data-three-phase.json'), { at: AT, timeZone: ZONE });
    expect(reading.bus.map((b) => [b.type, b.identifier, b.series.quantity_code, b.series.unit, b.series.values])).toEqual([
      ['gas_meter', 'GasDemo1234', 'volume', 'M3', [{ at: '2023-01-25T21:09:57.000Z', value: 2569.646 }]],
      ['water_meter', 'WaterDmo', 'volume', 'M3', [{ at: '2023-01-25T21:09:57.000Z', value: 123.456 }]],
    ]);
    expect(reading.skipped).toEqual([{ field: 'external[2]', reason: 'unit_unsupported' }]);
  });

  it('reads the gas meter of an older firmware, and skips what it cannot date or read', () => {
    const older = json('data-single-phase-older.json');
    const reading = readingOfHomeWizard(older, { at: AT, timeZone: ZONE });
    expect(reading.meter.identifier).toBe('not-hex');
    expect(reading.series.filter((s) => s.quantity_code === 'offtake_power').map((s) => [s.name, s.values[0]!.value])).toEqual([[null, 412], ['L1', 412]]);
    // 02:30 on the night the clocks go back happens twice; the dongle drops the flag that tells which.
    expect(reading.bus).toEqual([]);
    expect(reading.skipped).toEqual([{ field: 'active_voltage_l1_v', reason: 'value_invalid' }, { field: 'total_gas_m3', reason: 'stamp_ambiguous' }]);

    const later = readingOfHomeWizard({ ...older, gas_timestamp: 231030023000 }, { at: AT, timeZone: ZONE });
    expect(later.bus.map((b) => [b.type, b.identifier, b.series.values[0]!.at])).toEqual([['gas_meter', 'GasDemo5678', '2023-10-30T01:30:00.000Z']]);
    expect(readingOfHomeWizard(older, { at: AT }).skipped).toContainEqual({ field: 'total_gas_m3', reason: 'time_zone_required' });
  });

  it('reads a stamp of the bus and an identifier as the dongle gives them', () => {
    expect([wallClockOf(230125220957), wallClockOf('010203040506'), wallClockOf(230631000000), wallClockOf(232525), wallClockOf(null)])
      .toEqual([Date.UTC(2023, 0, 25, 22, 9, 57), Date.UTC(2001, 1, 3, 4, 5, 6), null, null, null]);
    expect([decodeIdentifier('4E6577746F6E'), decodeIdentifier('00ff'), decodeIdentifier(''), decodeIdentifier(12)]).toEqual(['Newton', '00ff', null, null]);
  });
});

describe('the whole path on a database', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await freshDatabase();
  });
  afterAll(async () => {
    await db.close();
  });

  it('keeps two readings on the meters of a participant, and resample() gives the energy of the quarter hour', async () => {
    await registerSource(db as unknown as Db, homewizardSource);
    expect(await one(db, `select kind, auth, redistributable, countries, published_by from sources where code = 'homewizard'`))
      .toEqual({ kind: 'device', auth: 'none', redistributable: false, countries: [], published_by: '@nexgen-os/homewizard' });
    const org = await organisation(db, 'A cooperative');
    const project = await insert(db, 'projects', { organisation_id: org, name: 'A community', country: COUNTRY });
    const site = (await one<{ id: string }>(db, `select join_project($1, 'A house', $2, 'consumer', null, null, 'simulation', $3) id`, [project, { country: COUNTRY }, ZONE])).id;
    const electricity = (await one<{ id: string }>(db, `select declare_meter($1, '541448800000000017', 'gs1_gsrn') id`, [site])).id;
    const gas = (await one<{ id: string }>(db, `select declare_meter($1, '541448800000000024', 'gs1_gsrn', 'gas', 'offtake') id`, [site])).id;

    const first = json('data-three-phase.json');
    const second = { ...first, total_power_import_kwh: 13779.588, active_power_w: 1000,
      external: [{ ...(first.external as Record<string, unknown>[])[0], timestamp: 261110221500, value: 2569.9 }] };
    const dongle = fakeDongle({ '/api/v1/data': [{ ...first, external: [{ ...(first.external as Record<string, unknown>[])[0], timestamp: 261110220000 }] }, second] });
    let clock = Date.parse('2026-11-10T21:00:00Z');
    const client = homewizard({ host: 'p1meter.local', fetch: dongle.fetch, now: () => clock, timeZone: ZONE });

    const stored: Record<string, string> = {};
    for (let i = 0; i < 2; i++) {
      const reading = await client.read();
      for (const s of reading.series) {
        const { seriesId } = await storeSeries(db as unknown as Db, { organisationId: org, objectKind: 'meter', objectId: electricity, sourceCode: 'homewizard', kind: 'measured' }, s);
        stored[`${s.quantity_code} ${s.name ?? ''}`.trim()] = seriesId;
      }
      for (const b of reading.bus) {
        const { seriesId } = await storeSeries(db as unknown as Db, { organisationId: org, objectKind: 'meter', objectId: gas, sourceCode: 'homewizard', kind: 'measured' }, b.series);
        stored[b.type] = seriesId;
      }
      clock += 15 * 60_000;
    }

    expect(await one(db, `select count(*)::int n from series where object_id = $1`, [electricity])).toEqual({ n: 17 });
    const registers = await db.query(`select at, value from series_values where series_id = $1 order by at`, [stored.offtake_energy]);
    expect(registers.rows).toEqual([
      { at: new Date('2026-11-10T21:00:00Z'), value: 13779.338 },
      { at: new Date('2026-11-10T21:15:00Z'), value: 13779.588 },
    ]);
    // The power is kept in the quantity unit, kW.
    const power = await db.query(`select value from series_values where series_id = $1 order by at`, [stored.offtake_power]);
    expect(power.rows).toEqual([{ value: 0 }, { value: 1 }]);
    const gasValues = await db.query(`select at, value from series_values where series_id = $1 order by at`, [stored.gas_meter]);
    expect(gasValues.rows).toEqual([
      { at: new Date('2026-11-10T21:00:00Z'), value: 2569.646 },
      { at: new Date('2026-11-10T21:15:00Z'), value: 2569.9 },
    ]);
    const quarter = await resample(db as unknown as Db, stored.offtake_energy!, '2026-11-10T21:00:00Z', '2026-11-10T21:30:00Z', '15 minutes');
    expect(quarter[0]!.value).toBeCloseTo(0.25, 6);
  });
});
