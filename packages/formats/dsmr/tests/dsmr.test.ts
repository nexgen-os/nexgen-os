// @nexgen-os/dsmr: DSMR telegrams and P1M5 messages read into values with
// their direction, phase and tariff register, dated by the meter's clock in
// UTC with the caller's zone. The fixtures follow the structure of the DSMR
// P1 companion standard (5.0.2), its Belgian variant (e-MUCS) and the
// message of the P1M5 firmware, with invented identifiers and values.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { crc16, meterTime, obisMeaning, readP1m5, readTelegram, type DsmrReading } from '../src/index.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'latin1');
// The zone of the meter's place: data of the test, never of the library.
const brussels = { timeZone: 'Europe/Brussels' };
const amsterdam = { timeZone: 'Europe/Amsterdam' };
const value = (r: DsmrReading, obis: string) => r.values.find((v) => v.obis === obis);

describe('the checksum', () => {
  it('is CRC-16/ARC, as DSMR 4 and 5 compute it', () => {
    expect(crc16('123456789')).toBe(0xbb3d);
  });

  it('is checked over every character from / to !, and a mismatch is reported, never repaired', () => {
    const text = fixture('emucs-three-phase.txt');
    expect(readTelegram(text, brussels).crc).toBe('valid');
    const tampered = text.replace('1-0:1.8.1(001234.567*kWh)', '1-0:1.8.1(001234.568*kWh)');
    const r = readTelegram(tampered, brussels);
    expect(r.crc).toBe('invalid');
    expect(r.problems.map((p) => p.code)).toEqual(['crc_mismatch']);
    expect(value(r, '1-0:1.8.1')!.value).toBe(1234.568);
  });

  it('is absent from a meter before DSMR 4', () => {
    expect(readTelegram(fixture('dsmr22.txt')).crc).toBe('absent');
  });
});

describe('a three-phase telegram of the Belgian variant', () => {
  const r = readTelegram(fixture('emucs-three-phase.txt'), brussels);

  it('reads the meter, its version, its tariff and its clock in UTC', () => {
    expect(r.problems).toEqual([]);
    expect(r).toMatchObject({
      header: 'FLU5\\253770234_A',
      equipment_id: '1SAG1234567890',
      version: '50217',
      local: '261015143000S',
      at: '2026-10-15T12:30:00.000Z',
      tariff: '0001',
      crc: 'valid',
    });
  });

  it('reads each energy register with its direction and its tariff, in the unit written', () => {
    const registers = r.values.filter((v) => v.measure === 'energy').map((v) => [v.obis, v.direction, v.tariff, v.value, v.unit, v.kind]);
    expect(registers).toEqual([
      ['1-0:1.8.1', 'offtake', 1, 1234.567, 'kWh', 'cumulative'],
      ['1-0:1.8.2', 'offtake', 2, 2345.678, 'kWh', 'cumulative'],
      ['1-0:2.8.1', 'injection', 1, 456.789, 'kWh', 'cumulative'],
      ['1-0:2.8.2', 'injection', 2, 123.456, 'kWh', 'cumulative'],
    ]);
  });

  it('reads the power of the connection and of each phase in each direction', () => {
    const power = r.values.filter((v) => v.measure === 'power' && v.kind === 'instant').map((v) => [v.direction, v.phase, v.value]);
    expect(power).toEqual([
      ['offtake', null, 0], ['injection', null, 1.874],
      ['offtake', 'L1', 0], ['offtake', 'L2', 0.212], ['offtake', 'L3', 0],
      ['injection', 'L1', 0.951], ['injection', 'L2', 0], ['injection', 'L3', 1.135],
    ]);
    expect(value(r, '1-0:1.7.0')!.unit).toBe('kW');
  });

  it('reads the voltage and the current of each phase, with no direction', () => {
    expect(r.values.filter((v) => v.measure === 'voltage').map((v) => [v.phase, v.value, v.unit, v.direction])).toEqual([
      ['L1', 236.4, 'V', null], ['L2', 235.1, 'V', null], ['L3', 237, 'V', null],
    ]);
    expect(r.values.filter((v) => v.measure === 'current').map((v) => [v.phase, v.value, v.unit])).toEqual([
      ['L1', 4.13, 'A'], ['L2', 1.02, 'A'], ['L3', 4.86, 'A'],
    ]);
  });

  it('reads the demand of the running quarter hour, and the highest of the month at its own stamp', () => {
    expect(value(r, '1-0:1.4.0')).toMatchObject({ measure: 'power', kind: 'average', direction: 'offtake', value: 2.351, at: null });
    expect(value(r, '1-0:1.6.0')).toMatchObject({
      measure: 'power', kind: 'maximum', direction: 'offtake', value: 4.812, local: '261003181500S', at: '2026-10-03T16:15:00.000Z',
    });
  });

  it('reads the gas volume of the bus at the stamp the gas meter sent', () => {
    expect(value(r, '0-1:24.2.3')).toMatchObject({
      measure: 'volume', kind: 'cumulative', channel: 1, value: 872.234, unit: 'm3', at: '2026-10-15T12:30:00.000Z', direction: null,
    });
  });

  it('keeps every object as written, those that are not measures included', () => {
    expect(r.lines).toHaveLength(33);
    expect(r.lines.find((l) => l.obis === '0-0:98.1.0')!.values).toHaveLength(9);
    expect(r.lines.find((l) => l.obis === '0-0:96.13.0')!.values).toEqual(['']);
    // A switch, a limit and a fuse threshold are not measures.
    for (const obis of ['0-0:96.3.10', '0-0:17.0.0', '1-0:31.4.0', '0-0:98.1.0']) expect(value(r, obis)).toBeUndefined();
  });
});

describe('a single-phase telegram of DSMR 5', () => {
  const r = readTelegram(fixture('dsmr5-single-phase.txt'), amsterdam);

  it('reads its winter clock and its gas meter on channel 1', () => {
    expect(r.problems).toEqual([]);
    expect(r).toMatchObject({ version: '50', at: '2026-01-14T07:15:00.000Z', equipment_id: 'E0043007001234560', tariff: '0002' });
    expect(value(r, '0-1:24.2.1')).toMatchObject({ value: 1234.567, unit: 'm3', at: '2026-01-14T07:00:00.000Z', channel: 1 });
    expect(r.values.filter((v) => v.phase === 'L2' || v.phase === 'L3')).toEqual([]);
  });

  it('reads a current written without decimals', () => {
    expect(value(r, '1-0:31.7.0')).toMatchObject({ value: 2, unit: 'A', phase: 'L1' });
  });
});

describe('a telegram of DSMR 2.2', () => {
  const r = readTelegram(fixture('dsmr22.txt'), brussels);

  it('has no clock: the reading is not dated, and says so', () => {
    expect(r.at).toBeNull();
    expect(r.problems.map((p) => p.code)).toEqual(['time_missing']);
    expect(value(r, '1-0:1.8.2')).toMatchObject({ value: 84, direction: 'offtake', tariff: 2 });
  });

  it('keeps a value written on the next line with its object', () => {
    expect(r.lines.find((l) => l.obis === '0-1:24.3.0')!.values).toEqual(['120517020000', '08', '60', '1', '0-1:24.2.1', 'm3', '00124.477']);
  });
});

describe('the message of a P1M5 dongle', () => {
  const text = fixture('p1m5-readings.json');
  const r = readP1m5(text, brussels);

  it('reads the same values as the telegram it came from', () => {
    expect(r.problems).toEqual([]);
    const telegram = readTelegram(fixture('emucs-three-phase.txt'), brussels);
    const shape = (x: DsmrReading) => x.values.filter((v) => v.channel === 0 && v.kind !== 'maximum').map((v) => [v.obis, v.direction, v.phase, v.tariff, v.value, v.unit]).sort();
    expect(shape(r)).toEqual(shape(telegram));
    expect(r).toMatchObject({ header: null, crc: null, equipment_id: '1SAG1234567890', version: '50217', at: '2026-10-15T12:30:00.000Z', tariff: '1' });
  });

  it('keeps the fields that are not OBIS codes as sent, and is never dated by them', () => {
    expect(r.fields).toEqual({ timestamp: 81234, id: '6f1c2a40-0000-4000-8000-000000000001', dongle_id: 'P1000001', sent_timestamp: 81234 });
    const { '0-0:1.0.0': _, ...undated } = JSON.parse(text) as Record<string, unknown>;
    const u = readP1m5(undated, brussels);
    expect(u.at).toBeNull();
    expect(u.problems.map((p) => p.code)).toEqual(['time_missing']);
  });

  it('refuses what is not a JSON object, by name', () => {
    expect(readP1m5('{"1-0:1.8.1"').problems[0]!.code).toBe('telegram_unreadable');
    expect(readP1m5('[1]').problems[0]!.code).toBe('telegram_unreadable');
  });
});

describe("the meter's clock", () => {
  it('needs the zone of the place', () => {
    const r = readTelegram(fixture('emucs-three-phase.txt'));
    expect(r.at).toBeNull();
    expect(r.problems.map((p) => p.code)).toEqual(['time_zone_required']);
  });

  it('tells the two instants of the hour repeated in autumn apart by the season letter', () => {
    expect(meterTime('261025023000S', 'Europe/Brussels')).toEqual({ at: '2026-10-25T00:30:00.000Z' });
    expect(meterTime('261025023000W', 'Europe/Brussels')).toEqual({ at: '2026-10-25T01:30:00.000Z' });
    expect(meterTime('261025023000', 'Europe/Brussels')).toMatchObject({ problem: 'local_time_ambiguous' });
  });

  it('names a time the clocks skipped, a letter the zone contradicts and a stamp that is not a date', () => {
    expect(meterTime('260329023000S', 'Europe/Brussels')).toMatchObject({ problem: 'local_time_nonexistent' });
    expect(meterTime('260115120000S', 'Europe/Brussels')).toMatchObject({ problem: 'season_mismatch' });
    expect(meterTime('260231120000W', 'Europe/Brussels')).toMatchObject({ problem: 'date_unreadable' });
    expect(meterTime('2026-01-15', 'Europe/Brussels')).toMatchObject({ problem: 'date_unreadable' });
  });

  it('reads a zone without summer time on W', () => {
    expect(meterTime('260715120000W', 'Asia/Tokyo')).toEqual({ at: '2026-07-15T03:00:00.000Z' });
  });
});

describe('an OBIS code', () => {
  it('is decoded by its structure, tariff registers beyond the second included', () => {
    expect(obisMeaning('1-0:1.8.3')).toMatchObject({ measure: 'energy', direction: 'offtake', tariff: 3 });
    expect(obisMeaning('1-0:2.8.0')).toMatchObject({ measure: 'energy', direction: 'injection', tariff: 0 });
    expect(obisMeaning('0-2:24.2.1')).toMatchObject({ measure: 'volume', channel: 2 });
  });

  it('is not a measure when it is an identifier, a stamp, a counter or a per-phase register', () => {
    for (const obis of ['0-0:1.0.0', '0-0:96.1.1', '0-0:96.7.21', '1-0:32.32.0', '1-0:21.8.0', '1-0:31.4.0', 'not-obis']) expect(obisMeaning(obis)).toBeNull();
  });
});
