// Weather files read into hourly series and written back, with no database:
// an EPW or TMY3 hour, stamped at its end in local standard time, becomes an
// interval dated at its start (irradiance) or an instant (temperature, wind)
// in UTC; a typical year lands on one calendar year; a file whose hours are
// off is told by name; and an EPW written from the series reads back the same.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { readEpw, readTmy3, writeEpw, type WeatherFile } from '@nexgen-os/weather-files';

const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const valuesOf = (file: WeatherFile, quantity: string) => file.series.find((s) => s.quantity_code === quantity)!.values;
const at = (file: WeatherFile, quantity: string, instant: string) => valuesOf(file, quantity).find((v) => v.at === instant)?.value;

describe('reading an EPW file', () => {
  it('reads the header, tells a typical year and lays it on the latest year it was made from', async () => {
    const file = readEpw(await fixture('pvgis-tmy-brussels-3-days.epw'));
    expect(file.format).toBe('epw');
    expect(file.location).toEqual({ name: null, region: null, country: null, data_source: 'ECMWF/ERA', station_id: null, lat: 50.85, lon: 4.35, utc_offset_hours: 1, elevation_m: 30 });
    expect([file.typical, file.years, file.year]).toEqual([true, [2005, 2020], 2020]);
    expect(file.series.map((s) => [s.quantity_code, s.value_kind, s.step, s.values.length])).toEqual([
      ['ghi', 'interval', '1 hour', 72],
      ['dni', 'interval', '1 hour', 72],
      ['dhi', 'interval', '1 hour', 72],
      ['temperature', 'instant', '1 hour', 72],
      ['wind_speed', 'instant', '1 hour', 72],
    ]);
    expect(file.skipped).toEqual(expect.arrayContaining(['dew_point_temperature', 'relative_humidity', 'atmospheric_pressure', 'wind_direction']));
    expect(file.missing).toEqual({});
  });

  it('dates an hour ending at 01:00 at UTC+1 as an interval from 23:00 UTC the day before, and a temperature at its instant', async () => {
    const file = readEpw(await fixture('pvgis-tmy-brussels-3-days.epw'));
    expect(valuesOf(file, 'ghi')[0]).toEqual({ at: '2019-12-31T23:00:00.000Z', value: 0 });
    expect(valuesOf(file, 'temperature')[0]).toEqual({ at: '2020-01-01T00:00:00.000Z', value: 5.26 });
    expect(Object.is(valuesOf(file, 'dni')[0].value, -0)).toBe(false); // PVGIS prints -0.00 at night
  });

  it('says by name when the irradiance peaks an hour away from the header, and reads a PVGIS file at UTC when told', async () => {
    const text = await fixture('pvgis-tmy-brussels-3-days.epw');
    expect(readEpw(text).warnings).toEqual([expect.objectContaining({ code: 'time_offset_suspect', implied_utc_offset_hours: 0 })]);

    const utc = readEpw(text, { utcOffsetHours: 0, year: 2023 });
    expect(utc.warnings).toEqual([]);
    expect(at(utc, 'ghi', '2023-06-21T08:00:00.000Z')).toBe(635); // hour 9 of 21 June, 08:00 to 09:00 UTC
    expect(at(utc, 'dhi', '2023-06-21T19:00:00.000Z')).toBe(32);
    expect(at(utc, 'wind_speed', '2023-06-21T23:00:00.000Z')).toBe(3.7);
  });

  it('keeps a real year as it is and leaves the missing values out', async () => {
    const lines = (await fixture('pvgis-tmy-brussels-3-days.epw')).split('\n');
    const realYear = [...lines.slice(0, 8), ...lines.slice(8, 32).map((l, i) => {
      const f = l.split(',');
      f[0] = '2023';
      if (i === 12) f[13] = '9999';
      if (i === 13) f[6] = '99.9';
      return f.join(',');
    })].join('\n');
    const file = readEpw(realYear, { utcOffsetHours: 0 });
    expect([file.typical, file.years, file.year]).toEqual([false, [2023], null]);
    expect(file.missing).toEqual({ ghi: 1, temperature: 1 });
    expect(valuesOf(file, 'ghi')).toHaveLength(23);
    expect(at(file, 'ghi', '2023-01-01T12:00:00.000Z')).toBeUndefined();
  });

  it('refuses what it cannot read, by name', async () => {
    expect(() => readEpw('Date,Time\n1,2')).toThrow(/^epw_unreadable/);
    const text = await fixture('pvgis-tmy-brussels-3-days.epw');
    expect(() => readEpw(text.replace('DATA PERIODS,1,1,', 'DATA PERIODS,1,4,'))).toThrow(/^epw_subhourly_unsupported/);
    const lines = text.split('\n');
    expect(() => readEpw([...lines.slice(0, 9), ...lines.slice(8, 12)].join('\n'))).toThrow(/^epw_duplicate_hour/);
  });
});

describe('reading a TMY3 file', () => {
  it('finds the columns by name, reads the station line and dates hours from local standard time', async () => {
    const file = readTmy3(await fixture('tmy3-golden-2-days.csv'));
    expect(file.location).toEqual({ name: 'DENVER/CENTENNIAL [GOLDEN - NREL]', region: 'CO', country: null, data_source: 'TMY3', station_id: '724666', lat: 39.742, lon: -105.179, utc_offset_hours: -7, elevation_m: 1829 });
    expect([file.typical, file.years, file.year, file.warnings]).toEqual([true, [1988, 1991], 1991, []]);
    expect(at(file, 'ghi', '1991-01-01T19:00:00.000Z')).toBe(512); // 12:00 to 13:00 at UTC-7
    expect(at(file, 'temperature', '1991-01-01T20:00:00.000Z')).toBe(1.3); // 13:00 at UTC-7
    expect(file.missing).toEqual({ wind_speed: 1 });
    expect(file.skipped).toEqual(expect.arrayContaining(['Dew-point (C)', 'RHum (%)', 'Pressure (mbar)', 'Alb (unitless)']));
  });

  it('refuses a file without the TMY3 columns', () => {
    expect(() => readTmy3('a,b,c\nx,y,z')).toThrow(/^tmy3_unreadable/);
  });
});

describe('writing an EPW file', () => {
  it('writes every hour of the year, the missing ones with the EPW codes, and reads back the same series', async () => {
    const file = readEpw(await fixture('pvgis-tmy-brussels-3-days.epw'), { utcOffsetHours: 0, year: 2023 });
    const text = writeEpw({ location: file.location, series: file.series, year: 2023 });
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(8 + 8760);
    expect(lines[7]).toBe('DATA PERIODS,1,1,Data,Sunday,1/1,12/31');
    expect(lines[8].split(',').slice(0, 5)).toEqual(['2023', '1', '1', '1', '0']);
    expect(lines[8].split(',')).toHaveLength(35);
    expect(lines[8 + 100].split(',')[13]).toBe('9999'); // 5 January, not in the file

    const back = readEpw(text);
    expect([back.typical, back.years, back.warnings]).toEqual([false, [2023], []]);
    expect(back.location).toEqual(file.location);
    for (const s of file.series) expect(valuesOf(back, s.quantity_code)).toEqual(s.values);
  });

  it('writes 29 February only when the series have it', () => {
    const location = { name: 'Test', region: null, country: null, data_source: null, station_id: null, lat: 0, lon: 0, utc_offset_hours: 0, elevation_m: null };
    const empty = writeEpw({ location, series: [], year: 2024 }).trimEnd().split('\n');
    expect(empty).toHaveLength(8 + 8760);
    const withLeapDay = writeEpw({ location, year: 2024, series: [{ quantity_code: 'ghi', value_kind: 'interval', step: '1 hour', values: [{ at: '2024-02-29T11:00:00.000Z', value: 400 }] }] }).trimEnd().split('\n');
    expect(withLeapDay).toHaveLength(8 + 8784);
    expect(withLeapDay[4]).toBe('HOLIDAYS/DAYLIGHT SAVINGS,Yes,0,0,0');
    expect(withLeapDay.find((l) => l.startsWith('2024,2,29,12,'))!.split(',')[13]).toBe('400');
  });
});
