// The readings of a P1 port land on a meter as its series: the energy
// registers as cumulative series by tariff, the power and the voltage as
// instants by phase, the gas volume on the meter of the bus; every value at
// the meter's clock in UTC, a bad telegram left out and said.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { readP1m5, readTelegram } from '@nexgen-os/dsmr';
import { meterSeriesOfDsmr, storeSeries } from '@nexgen-os/core';
import { freshDatabase, insert, one, organisation } from './helpers/db.js';

const zone = { timeZone: 'Europe/Brussels' };
// Three messages of a dongle, a quarter hour apart, the meter on summer time.
const message = (stamp: string, t1: number, t2: number, offtake: number, injection: number, l1: number) => ({
  '0-0:1.0.0': stamp,
  '0-0:96.1.1': '3153414731323334353637383930',
  '1-0:1.8.1': { value: t1, unit: 'kWh' },
  '1-0:1.8.2': { value: t2, unit: 'kWh' },
  '1-0:2.8.1': { value: 456.789, unit: 'kWh' },
  '1-0:2.8.2': { value: 123.456, unit: 'kWh' },
  '1-0:1.7.0': { value: offtake, unit: 'kW' },
  '1-0:2.7.0': { value: injection, unit: 'kW' },
  '1-0:1.6.0': { value: 4.812, unit: 'kW' },
  '1-0:32.7.0': { value: l1, unit: 'V' },
  '1-0:31.7.0': { value: 4.13, unit: 'A' },
  dongle_id: 'P1000001',
});
const stream = [
  readP1m5(message('261015140000S', 1234.0, 2345.0, 0.4, 0, 236.1), zone),
  readP1m5(message('261015141500S', 1234.1, 2345.0, 0.4, 0, 236.4), zone),
  readP1m5(message('261015143000S', 1234.2, 2345.0, 0, 1.874, 237.0), zone),
];
const telegram = readFileSync(new URL('../packages/formats/dsmr/tests/fixtures/emucs-three-phase.txt', import.meta.url), 'latin1');

describe('the readings of a P1 port as the series of a meter', () => {
  it('gives each register, each direction and each phase its series, at the meter time', () => {
    const { series, skipped } = meterSeriesOfDsmr(stream);
    expect(skipped).toEqual([]);
    expect(series.map((s) => [s.quantity_code, s.value_kind, s.name ?? null, s.unit, s.values.length])).toEqual([
      ['offtake_energy', 'cumulative', 'tariff 1', 'kWh', 3],
      ['offtake_energy', 'cumulative', 'tariff 2', 'kWh', 3],
      ['injection_energy', 'cumulative', 'tariff 1', 'kWh', 3],
      ['injection_energy', 'cumulative', 'tariff 2', 'kWh', 3],
      ['offtake_power', 'instant', null, 'kW', 3],
      ['injection_power', 'instant', null, 'kW', 3],
      ['voltage', 'instant', 'L1', 'V', 3],
    ]);
    expect(series[0]!.values.map((v) => v.at)).toEqual(['2026-10-15T12:00:00.000Z', '2026-10-15T12:15:00.000Z', '2026-10-15T12:30:00.000Z']);
  });

  it('leaves out a telegram whose checksum does not match, and one without a zone, and says which', () => {
    const tampered = readTelegram(telegram.replace('(001234.567*kWh)', '(001234.568*kWh)'), zone);
    const undated = readTelegram(telegram);
    const { series, skipped } = meterSeriesOfDsmr([stream[0]!, tampered, undated, readTelegram(telegram, zone)]);
    expect(skipped.map((s) => [s.index, s.problems.map((p) => p.code)])).toEqual([[1, ['crc_mismatch']], [2, ['time_zone_required']]]);
    expect(series.find((s) => s.quantity_code === 'offtake_energy' && s.name === 'tariff 1')!.values.map((v) => v.value)).toEqual([1234, 1234.567]);
  });

  it('gives the gas meter of the bus its volume, at the stamp the gas meter sent', () => {
    const { series } = meterSeriesOfDsmr([readTelegram(telegram, zone), readTelegram(telegram, zone)], { channel: 1 });
    expect(series).toEqual([
      { quantity_code: 'volume', value_kind: 'cumulative', name: null, step: null, unit: 'M3', values: [{ at: '2026-10-15T12:30:00.000Z', value: 872.234, quality: 0 }] },
    ]);
  });
});

describe('stored on a meter', () => {
  let db: PGlite;
  let org: string;
  let meter: string;

  beforeAll(async () => {
    db = await freshDatabase();
    org = await organisation(db, 'A cooperative');
    const project = await insert(db, 'projects', { organisation_id: org, name: 'Village community', kind: 'energy_community', country: 'BE', status: 'creation' });
    const place = JSON.stringify({ address_line1: 'Rue 1', city: 'Lasne', country: 'BE' });
    const home = (await one<{ id: string }>(
      db, `select join_project($1, 'House 1', $2, 'prosumer', null, '2026-01-01', p_time_zone => 'Europe/Brussels') id`, [project, place])).id;
    meter = (await one<{ id: string }>(db, `select declare_meter($1, '541448000000000001', 'gs1_gsrn') id`, [home])).id;
    await db.query(`insert into sources (code, name, kind) values ('p1_port', 'The P1 port of a smart meter', 'device')`);
  });

  afterAll(async () => {
    await db.close();
  });

  it('keeps the registers as cumulative series, whose quarter hours give the energy taken', async () => {
    const target = { organisationId: org, objectKind: 'meter', objectId: meter, sourceCode: 'p1_port', kind: 'measured' as const };
    const ids: Record<string, string> = {};
    for (const s of meterSeriesOfDsmr(stream).series) ids[`${s.quantity_code} ${s.name ?? ''}`] = (await storeSeries(db, target, s)).seriesId;
    const quarters = await db.query<{ value: number }>(
      `select round(value::numeric, 3)::float8 as value from resample($1, '2026-10-15 12:00Z', '2026-10-15 12:30Z', '15 minutes')`, [ids['offtake_energy tariff 1']]);
    expect(quarters.rows.map((r) => r.value)).toEqual([0.1, 0.1]);
    const power = await db.query<{ value: number }>(`select value from series_values where series_id = $1 order by at`, [ids['injection_power ']]);
    expect(power.rows.map((r) => r.value)).toEqual([0, 0, 1.874]);
  });
});
