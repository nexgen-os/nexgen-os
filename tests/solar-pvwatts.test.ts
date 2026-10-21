// The `pvwatts` yield profile: each step of the model against values worked
// out by hand, the Open-Meteo archive read in the core's conventions, runs
// on a system of two arrays with a synthetic year of Open-Meteo answers and
// a recorded PVGIS answer, and the acceptance test of decision 0012 at small
// scale: the same roof run through `pvgis_like` and `pvwatts` gives two runs
// whose inputs say why they differ.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { SeriesPoint } from '@nexgen-os/core';
import { openMeteo } from '@nexgen-os/open-meteo';
import { pvgis } from '@nexgen-os/pvgis';
import {
  HOURS_PER_YEAR,
  alignWeather,
  anchoringFactor,
  arrayEnergy,
  cleanWeather,
  faimanCellTemperature,
  finkelsteinSchafer,
  hourOfYear,
  hourlyMean,
  meanAnnualOverCoveredYears,
  multiYearMeanAnnual,
  pvwattsEnergyPerKwp,
  remainingAfterLosses,
  rescaleFactor,
  scaled,
  selectTypicalMonths,
  standardOffsetMinutes,
  toYearGrid,
  total,
  typicalYear,
  withinLocalYears,
} from '../modules/solar/src/pvwatts.js';
import { runYield } from '../modules/solar/src/yield.js';
import { USER_A, freshDatabase, insert, one, organisation, participant } from './helpers/db.js';
import { answering, fixture, syntheticArchive } from './helpers/weather.js';

const FAIMAN = { u0: 25, u1: 6.84 };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** One value per hour from `from` (included) to `to` (excluded), UTC instants. */
const hourly = (from: string, to: string, value: (ms: number) => number): SeriesPoint[] => {
  const out: SeriesPoint[] = [];
  for (let ms = Date.parse(from); ms < Date.parse(to); ms += HOUR) out.push({ at: new Date(ms).toISOString(), value: value(ms) });
  return out;
};

describe('the pvwatts model, step by step', () => {
  it('a clear-sky hour: 1000 W/m², 20 °C, 2 m/s, γ −0.35 %/K, 14 % losses', () => {
    // Tcell = 20 + 1000 / (25 + 6.84 × 2) = 20 + 1000 / 38.68 = 45.8532 °C
    const tCell = faimanCellTemperature(1000, 20, 2, FAIMAN);
    expect(tCell).toBeCloseTo(45.853154, 5);
    // E = 1 × [1 − 0.0035 × 20.8532] × 0.86 = 0.927014 × 0.86 = 0.797232 kWh per kWp
    expect(pvwattsEnergyPerKwp(1000, tCell, -0.0035, remainingAfterLosses([{ code: 'system', pct: 14 }]))).toBeCloseTo(0.797232, 6);
    // At 25 °C and without losses, the module gives its rating times G / 1000.
    expect(pvwattsEnergyPerKwp(1000, 25, -0.0035, 1)).toBe(1);
    expect(pvwattsEnergyPerKwp(0, 40, -0.0035, 1)).toBe(0);
  });

  it('a hot hour, without wind: the cell heats up and the module gives less', () => {
    // Tcell = 35 + 900 / 25 = 71 °C; E = 0.9 × [1 − 0.0035 × 46] × 0.86 = 0.9 × 0.839 × 0.86 = 0.649386
    const tCell = faimanCellTemperature(900, 35, 0, FAIMAN);
    expect(tCell).toBe(71);
    expect(pvwattsEnergyPerKwp(900, tCell, -0.0035, 0.86)).toBeCloseTo(0.649386, 6);
    // The same hour on a 4 kWp array, through `arrayEnergy`.
    expect(arrayEnergy([{ at: '2023-07-01T12:00:00.000Z', poa: 900, temperature: 35, wind: 0 }], { kwp: 4, gammaPdc: -0.0035 }, { ...FAIMAN, remainingFraction: 0.86 })[0].value).toBeCloseTo(4 * 0.649386, 6);
  });

  it('bounds γ to [−0.01, 0]: a positive value is a sign error and throws a named error', () => {
    expect(pvwattsEnergyPerKwp(1000, 25, 0, 1)).toBe(1);
    expect(pvwattsEnergyPerKwp(1000, 35, -0.01, 1)).toBeCloseTo(0.9, 12);
    expect(() => pvwattsEnergyPerKwp(1000, 60, 0.0035, 1)).toThrow(/gamma_out_of_range: 0.0035/);
    expect(() => pvwattsEnergyPerKwp(1000, 60, -0.02, 1)).toThrow(/gamma_out_of_range/);
    expect(() => pvwattsEnergyPerKwp(1000, 60, NaN, 1)).toThrow(/gamma_out_of_range/);
    // Even on an array whose hours are all dark.
    expect(() => arrayEnergy([], { kwp: 4, gammaPdc: 0.004 }, { ...FAIMAN, remainingFraction: 1 })).toThrow(/gamma_out_of_range/);
  });

  it('the fraction that remains after ordered losses: each applies to what the previous ones left; a loss without a value throws', () => {
    expect(remainingAfterLosses([{ code: 'system', pct: 14 }])).toBeCloseTo(0.86, 12);
    // 0.98 × 0.985 × 1.0075 = 0.97253975: a negative loss is a gain.
    expect(remainingAfterLosses([{ code: 'soiling', pct: 2 }, { code: 'dc_wiring', pct: 1.5 }, { code: 'module_quality', pct: -0.75 }])).toBeCloseTo(0.97253975, 10);
    expect(remainingAfterLosses([])).toBe(1);
    expect(() => remainingAfterLosses([{ code: 'iam', pct: null }])).toThrow(/loss_without_value: iam/);
  });

  it('aligns the irradiance of an hour with the mean of the instants that bound it', () => {
    const hours = alignWeather(
      [{ at: '2023-01-01T11:00:00Z', value: 200 }, { at: '2023-01-01T10:00:00Z', value: 100 }],
      [{ at: '2023-01-01T10:00:00Z', value: 10 }, { at: '2023-01-01T11:00:00Z', value: 12 }],
      [{ at: '2023-01-01T10:00:00Z', value: 3 }],
    );
    expect(hours).toEqual([
      { at: '2023-01-01T10:00:00.000Z', poa: 100, temperature: 11, wind: 3 },
      { at: '2023-01-01T11:00:00.000Z', poa: 200, temperature: 12, wind: null },
    ]);
  });

  it('cleans: irradiance below zero or missing to 0, above 1400 W/m² to 1400; a gap takes the last value read', () => {
    const at = (h: number) => `2023-06-01T${String(h).padStart(2, '0')}:00:00.000Z`;
    const { hours, stats } = cleanWeather([
      { at: at(0), poa: -3, temperature: null, wind: null },
      { at: at(1), poa: null, temperature: 14, wind: 2 },
      { at: at(2), poa: 1500, temperature: null, wind: -1 },
      { at: at(3), poa: 300, temperature: 16, wind: 4 },
    ]);
    // The leading gap takes the first value read, the others the last one.
    expect(hours).toEqual([
      { at: at(0), poa: 0, temperature: 14, wind: 2 },
      { at: at(1), poa: 0, temperature: 14, wind: 2 },
      { at: at(2), poa: 1400, temperature: 14, wind: 2 },
      { at: at(3), poa: 300, temperature: 16, wind: 4 },
    ]);
    expect(stats).toEqual({ negative_irradiance: 1, capped_irradiance: 1, missing_irradiance: 1, filled_temperature: 2, filled_wind: 2 });
    expect(() => cleanWeather([{ at: at(0), poa: 10, temperature: null, wind: 1 }])).toThrow(/weather_without_temperature/);
    expect(() => cleanWeather([{ at: at(0), poa: 10, temperature: 9, wind: null }])).toThrow(/weather_without_wind/);
  });

  it('cuts years at the local standard midnight of the site, and lays them on a 365-day grid without 29 February', () => {
    expect(hourOfYear('2023-01-01T00:00:00Z', 'UTC')).toEqual({ year: 2023, hour: 0 });
    expect(hourOfYear('2024-02-29T05:00:00Z', 'UTC')).toEqual({ year: 2024, hour: null });
    // 1 March is hour 59 × 24 in a leap year as in any other.
    expect(hourOfYear('2024-03-01T00:00:00Z', 'UTC').hour).toBe(1416);
    expect(hourOfYear('2023-03-01T00:00:00Z', 'UTC').hour).toBe(1416);
    expect(hourOfYear('2024-12-31T23:00:00Z', 'UTC').hour).toBe(8759);
    // Brussels, UTC+1 in standard time: its year starts at 23:00 UTC the day before.
    expect(hourOfYear('2022-12-31T23:00:00Z', 'Europe/Brussels')).toEqual({ year: 2023, hour: 0 });
    // Los Angeles, UTC−8 in standard time, also in summer: no daylight-saving shift.
    expect(hourOfYear('2023-01-01T07:00:00Z', 'America/Los_Angeles')).toEqual({ year: 2022, hour: 8759 });
    expect(hourOfYear('2023-07-01T08:00:00Z', 'America/Los_Angeles')).toEqual({ year: 2023, hour: 181 * 24 });
    // Sydney is UTC+11 in January (daylight saving), UTC+10 in standard time.
    expect(standardOffsetMinutes('Australia/Sydney', 2023)).toBe(600);
    expect(standardOffsetMinutes('Europe/Brussels', 2023)).toBe(60);
    expect(() => toYearGrid([], '')).toThrow(/time_zone_required/);
    expect(() => toYearGrid([], 'Mars/Olympus')).toThrow(/time_zone_unknown/);

    const leapDay = Array.from({ length: 24 }, (_, h) => ({ at: new Date(Date.UTC(2024, 1, 29, h)).toISOString(), value: 1 }));
    const grid = toYearGrid([...leapDay, { at: '2024-03-01T00:00:00Z', value: 5 }], 'UTC');
    expect(grid.leapHoursLeftOut).toBe(24);
    expect(grid.years.get(2024)![1416]).toBe(5);
    // Only the points of the local years asked are kept.
    expect(withinLocalYears([{ at: '2022-12-31T22:00:00Z', value: 1 }, { at: '2022-12-31T23:00:00Z', value: 2 }], 'Europe/Brussels', { from: 2023, to: 2023 })).toEqual([{ at: '2022-12-31T23:00:00Z', value: 2 }]);
  });

  it('measures how far a month is from the long term (Finkelstein-Schafer)', () => {
    expect(finkelsteinSchafer([1, 3], [1, 3, 1, 3])).toBe(0);
    // Candidate always 1; long term half 1, half 3: |1 − 0.5| at both 1s, 0 at both 3s → 0.25.
    expect(finkelsteinSchafer([1, 1], [1, 1, 3, 3])).toBe(0.25);
  });

  /** One value per day at noon, for the January of `year`. */
  const january = (year: number, daily: (day: number) => number): SeriesPoint[] =>
    Array.from({ length: 31 }, (_, d) => ({ at: new Date(Date.UTC(year, 0, d + 1, 12)).toISOString(), value: daily(d) }));
  /** Every hour of January, so that a year counts as covering the month. */
  const covered = (year: number, daily: (day: number) => number): SeriesPoint[] =>
    Array.from({ length: 31 * 24 }, (_, i) => ({ at: new Date(Date.UTC(year, 0, 1, i)).toISOString(), value: i % 24 === 12 ? daily(Math.floor(i / 24)) : 0 }));

  it('chooses, for each month, the real month closest to all years', () => {
    // 2021 alternates 1 and 3 kWh days; 2022 has only sunny days, 2023 only grey ones.
    // Together: 47 days at 1, 46 at 3, which 2021 resembles most.
    const grid = toYearGrid([...covered(2021, (d) => (d % 2 === 0 ? 1 : 3)), ...covered(2022, () => 3), ...covered(2023, () => 1)], 'UTC');
    const months = selectTypicalMonths(grid);
    expect(months[0]).toBe(2021);
    expect(months.slice(1)).toEqual(Array(11).fill(null));
    // Two identical years: the most recent wins.
    expect(selectTypicalMonths(toYearGrid([...covered(2020, () => 2), ...covered(2021, () => 2)], 'UTC'))[0]).toBe(2021);
    // A year with a few days only is no candidate.
    expect(selectTypicalMonths(toYearGrid([...covered(2020, () => 2), ...january(2024, () => 2)], 'UTC'))[0]).toBe(2020);
  });

  it('fills an hour the chosen month lacks with the multi-year mean of that hour: always 8,760 values', () => {
    // 2021 gives 1 every hour, 2022 gives 3 but lacks 12:00 on 5 January.
    const hole = '2022-01-05T12:00:00.000Z';
    const points = [...hourly('2021-01-01', '2022-01-01', () => 1), ...hourly('2022-01-01', '2023-01-01', () => 3).filter((p) => p.at !== hole)];
    const grid = toYearGrid(points, 'UTC');
    const k = hourOfYear(hole, 'UTC').hour!;
    const year = typicalYear(grid, Array(12).fill(2022), 2025, 'UTC');
    expect(year.points).toHaveLength(HOURS_PER_YEAR);
    expect(year.fromMean).toBe(1);
    expect(year.points[k]).toEqual({ at: '2025-01-05T12:00:00.000Z', value: hourlyMean(grid)[k] });
    expect(year.points[k].value).toBe(1);
    expect(year.points[k - 1].value).toBe(3);
    // A month no year was chosen for is the mean across years.
    expect(typicalYear(grid, [null, ...Array(11).fill(2022)], 2025, 'UTC').points[0].value).toBe(2);
    // An hour no year has: nothing to fill it with, nothing invented.
    expect(() => typicalYear(toYearGrid(points.filter((p) => !p.at.endsWith('-01-05T12:00:00.000Z')), 'UTC'), Array(12).fill(2022), 2025, 'UTC')).toThrow(/period_not_covered: no year has the hour 2025-01-05T12:00:00.000Z/);
  });

  it('a site at −120° (Los Angeles): every month of the typical year starts and ends at night', () => {
    // A sunlit day centred on 12:00 local solar time, i.e. 20:00 UTC; each
    // day's height varies with the day and the year, so that months come
    // from different years.
    const sun = (ms: number) => {
      const solarHour = ((((ms + HOUR / 2) / HOUR - 8) % 24) + 24) % 24;
      const day = Math.floor((ms - 8 * HOUR) / DAY);
      return Math.max(0, Math.sin((Math.PI * (solarHour - 6)) / 12)) * (1 + ((day * 7919) % 11) / 10);
    };
    const tz = 'America/Los_Angeles';
    const energy = hourly('2021-01-01T08:00:00Z', '2023-01-01T08:00:00Z', sun);
    const grid = toYearGrid(energy, tz);
    expect([...grid.years.keys()]).toEqual([2021, 2022]);
    // The two years alternate month by month: every junction joins two years.
    const months = Array.from({ length: 12 }, (_, m) => (m % 2 === 0 ? 2021 : 2022));
    const { points, fromMean } = typicalYear(grid, months, 2023, tz);
    expect(points).toHaveLength(HOURS_PER_YEAR);
    expect(fromMean).toBe(0);
    // Laid on the local calendar, dated in UTC: the year starts at 08:00 UTC.
    expect(points[0].at).toBe('2023-01-01T08:00:00.000Z');
    expect(points[HOURS_PER_YEAR - 1].at).toBe('2024-01-01T07:00:00.000Z');
    const starts = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30].reduce<number[]>((acc, d, m) => [...acc, (m === 0 ? 0 : acc[m - 1]) + d * 24], []).slice(1);
    for (const k of starts) {
      expect(points[k - 1].value).toBe(0);
      expect(points[k].value).toBe(0);
    }
    // Cut at UTC midnight instead, the junctions would fall at 16:00 local, in full sun.
    expect(sun(Date.parse('2023-02-01T00:00:00Z'))).toBeGreaterThan(0);
    expect(selectTypicalMonths(grid).every((y) => y === 2021 || y === 2022)).toBe(true);
  });

  it('rescales the typical year to the mean annual total over the years used, and anchors on a reference', () => {
    // 2022 gives 1 every hour, 2023 gives 3: mean annual 2 × 8,760.
    const grid = toYearGrid([...hourly('2022-01-01', '2023-01-01', () => 1), ...hourly('2023-01-01', '2024-01-01', () => 3)], 'UTC');
    expect(multiYearMeanAnnual(grid)).toBe(2 * HOURS_PER_YEAR);
    const year = typicalYear(grid, Array(12).fill(2022), 2023, 'UTC').points;
    expect(total(year)).toBe(HOURS_PER_YEAR);
    const k = rescaleFactor(multiYearMeanAnnual(grid), total(year));
    expect(k).toBe(2);
    expect(total(scaled(year, k))).toBe(2 * HOURS_PER_YEAR);
    expect(rescaleFactor(9, 0)).toBe(1);
    expect(anchoringFactor(950, 1000)).toBe(0.95);
    expect(() => anchoringFactor(950, 0)).toThrow(/anchoring_impossible/);
  });

  it('real years: the mean annual total over the years covered, a year counting with 95 % of its hours', () => {
    // 2022 complete; 2023 without its last 30 days (91.8 % of its hours); 2024 complete, 8,784 hours.
    const points = [
      ...hourly('2022-01-01', '2023-01-01', () => 1),
      ...hourly('2023-01-01', '2023-12-02', () => 5),
      ...hourly('2024-01-01', '2025-01-01', () => 2),
    ];
    expect(meanAnnualOverCoveredYears(points, 'UTC', { from: 2022, to: 2023 })).toEqual({ annual: 8760, yearsCovered: [2022] });
    expect(meanAnnualOverCoveredYears(points, 'UTC', { from: 2022, to: 2024 })).toEqual({ annual: (8760 + 2 * 8784) / 2, yearsCovered: [2022, 2024] });
    expect(() => meanAnnualOverCoveredYears(points, 'UTC', { from: 2023, to: 2023 })).toThrow(/period_not_covered/);
  });
});

describe('the Open-Meteo archive', () => {
  it('asks ERA5 on the plane in its conventions and dates every value at the start of its hour, in UTC', async () => {
    const recorded = await fixture('open-meteo-era5-brussels-2023-01-01-03-south30.json');
    const asked: string[] = [];
    const got = await openMeteo({ fetch: answering(recorded, asked) }).history!({ lon: 4.35, lat: 50.85 }, '2023-01-01', '2023-01-02', { tilt_deg: 30, azimuth_deg: 180, model: 'era5' });

    const params = Object.fromEntries(new URL(asked[0]).searchParams);
    expect(asked[0]).toMatch(/^https:\/\/archive-api\.open-meteo\.com\/v1\/archive\?/);
    expect(params).toMatchObject({
      start_date: '2023-01-01', end_date: '2023-01-03', tilt: '30', azimuth: '0', models: 'era5',
      hourly: 'global_tilted_irradiance,temperature_2m,wind_speed_10m', wind_speed_unit: 'ms', timezone: 'GMT', timeformat: 'unixtime',
    });
    expect(got.map((s) => [s.quantity_code, s.value_kind, s.step, s.values.length])).toEqual([
      ['poa_irradiance', 'interval', '1 hour', 48],
      ['temperature', 'instant', '1 hour', 48],
      ['wind_speed', 'instant', '1 hour', 48],
    ]);
    // The irradiance stamped 01:00 is the mean of 00:00–01:00; the temperature stamped 00:00 is read at 00:00.
    expect(got[0].values[0]).toEqual({ at: '2023-01-01T00:00:00.000Z', value: recorded.hourly.global_tilted_irradiance[1] });
    expect(got[1].values[0]).toEqual({ at: '2023-01-01T00:00:00.000Z', value: recorded.hourly.temperature_2m[0] });
    // The last hour of the period is the mean stamped at midnight after it.
    expect(got[0].values[47]).toEqual({ at: '2023-01-02T23:00:00.000Z', value: recorded.hourly.global_tilted_irradiance[48] });
  });

  it('turns an azimuth from north into one from south, and refuses a plane it is not given', async () => {
    const asked: string[] = [];
    const provider = openMeteo({ fetch: answering(await fixture('open-meteo-era5-brussels-2023-01-01-03-east30.json'), asked) });
    await provider.history!({ lon: 4.35, lat: 50.85 }, '2023-01-01', '2023-01-02', { tilt_deg: 30, azimuth_deg: 90 });
    expect(new URL(asked[0]).searchParams.get('azimuth')).toBe('-90');
    expect(new URL(asked[0]).searchParams.has('models')).toBe(false);
    await expect(provider.history!({ lon: 4.35, lat: 50.85 }, '2023-01-01', '2023-01-02', { quantities: ['poa_irradiance'] })).rejects.toThrow(/orientation_required/);
  });
});

describe('a pvwatts yield run', () => {
  let db: PGlite;
  let org: string;
  let site: string;
  let system: string;
  let pvcalc: { outputs: { totals: { fixed: { E_y: number } } } };
  let weatherAsked: string[] = [];
  const pvgisAsked: string[] = [];

  beforeAll(async () => {
    db = await freshDatabase(['solar']);
    org = await organisation(db, 'A cooperative', USER_A);
    site = await participant(db, { organisation_id: org, name: 'Hall', country: 'BE', time_zone: 'Europe/Brussels', geometry: { type: 'Point', coordinates: [4.35, 50.85] } });
    system = await insert(db, 'devices', { organisation_id: org, participant_id: site, name: 'Roof PV', device_type: 'solar', rated_power_kw: 30 });
    await db.query('insert into solar.pv_systems (id, kwp_dc) values ($1, 30)', [system]);
    // The south array's modules have PVWatts parameters; the east array's have none and are bifacial.
    const product = await insert(db, 'device_directory', { device_type: 'solar', manufacturer: 'Acme', model_ref: 'Sun 400', unit_power_kw: 0.4, published_by: 'solar' });
    await db.query(`insert into solar.module_products (id, model, parameters) values ($1, 'pvwatts', '{"pdc0": 400, "gamma_pdc": -0.0037}')`, [product]);
    await db.query(`insert into solar.pv_arrays (organisation_id, pv_system_id, azimuth_deg, tilt_deg, name, mounting, module_product_id, module_count) values ($1, $2, 180, 30, 'South', 'roof_parallel', $3, 50)`, [org, system, product]);
    await db.query(`insert into solar.pv_arrays (organisation_id, pv_system_id, azimuth_deg, tilt_deg, name, mounting, kwp_dc, bifacial) values ($1, $2, 90, 30, 'East', 'roof_parallel', 10, true)`, [org, system]);
    pvcalc = await fixture('pvgis-pvcalc-brussels-south30.json');
  });

  afterAll(async () => {
    await db.close();
  });

  const clients = (missingFrom?: string) => {
    weatherAsked = [];
    return { weather: openMeteo({ fetch: syntheticArchive(4.35, weatherAsked, missingFrom) }), pvgis: pvgis({ fetch: answering(pvcalc, pvgisAsked) }) };
  };

  it('reads the weather per array for the local years, adds the energies, stores a typical year anchored on PVGIS and records everything it used', async () => {
    const result = await runYield(db, { pvSystemId: system, years: { from: 2023, to: 2023 }, profileCode: 'pvwatts', gammaPdc: -0.0035, anchor: 'pvgis' }, clients());

    // One weather request and one PVGIS yearly per array; a day more on each side, for Brussels' year starts at 23:00 UTC.
    expect(weatherAsked.map((u) => [new URL(u).searchParams.get('azimuth'), new URL(u).searchParams.get('start_date'), new URL(u).searchParams.get('end_date')])).toEqual([['0', '2022-12-31', '2024-01-02'], ['-90', '2022-12-31', '2024-01-02']]);
    expect(pvgisAsked.map((u) => [new URL(u).pathname.endsWith('/PVcalc'), new URL(u).searchParams.get('peakpower'), new URL(u).searchParams.get('loss')])).toEqual([[true, '20', '14'], [true, '10', '14']]);

    // The anchored annual of each array is PVGIS's answer: the recorded 1 kWp one is served to both.
    const pvgisAnnual = pvcalc.outputs.totals.fixed.E_y;
    expect(result.kwp).toBe(30);
    expect(result.annualKwh).toBeCloseTo(2 * pvgisAnnual, 3);
    expect(result.radiationDb).toBe('ERA5');

    // The south array's factor, worked out again from the same weather with the module's own γ.
    const read = await openMeteo({ fetch: syntheticArchive(4.35, []) }).history!({ lon: 4.35, lat: 50.85 }, '2022-12-31', '2024-01-01', { tilt_deg: 30, azimuth_deg: 180 });
    const { hours } = cleanWeather(alignWeather(withinLocalYears(read[0].values, 'Europe/Brussels', { from: 2023, to: 2023 }), read[1].values, read[2].values));
    expect(hours).toHaveLength(8760);
    const modelledSouth = total(arrayEnergy(hours, { kwp: 20, gammaPdc: -0.0037 }, { ...FAIMAN, remainingFraction: 0.86 }));

    // The local year 2023, every hour of it, dated at its start in UTC.
    const series = await one<{ kind: string; source: string; name: string; n: number; first: Date; last: Date }>(
      db,
      `select s.kind, s.source_code source, s.name, count(v.*)::int n, min(v.at) first, max(v.at) last
         from series s join series_values v on v.series_id = s.id where s.id = $1 group by s.kind, s.source_code, s.name`,
      [result.seriesId],
    );
    expect(series).toMatchObject({ kind: 'simulated', source: 'open_meteo', name: 'typical year 2023-2023', n: 8760 });
    expect([new Date(series.first).toISOString(), new Date(series.last).toISOString()]).toEqual(['2022-12-31T23:00:00.000Z', '2023-12-31T22:00:00.000Z']);
    const temperature = await one<{ n: number }>(db, `select count(v.*)::int n from series s join series_values v on v.series_id = s.id where s.object_id = $1 and s.quantity_code = 'temperature'`, [site]);
    expect(temperature.n).toBe(8760);

    const run = await one<{ module_code: string; engine_version: string; inputs: Record<string, any>; results: Record<string, any> }>(db, 'select module_code, engine_version, inputs, results from runs where id = $1', [result.runId]);
    expect(run.module_code).toBe('solar');
    expect(run.engine_version).toBe('solar-pvwatts-0.1.0');
    expect(run.inputs).toMatchObject({
      profile: 'pvwatts',
      weather: { source: 'open_meteo', model: 'era5', years: { from: 2023, to: 2023 }, period: { from: '2022-12-31', to: '2024-01-01' }, time_zone: 'Europe/Brussels' },
      years_covered: null,
      arrays: [
        { name: 'South', kwp: 20, azimuth_deg: 180, tilt_deg: 30, gamma_pdc: -0.0037, gamma_source: 'module_product', hours: 8760 },
        { name: 'East', kwp: 10, azimuth_deg: 90, tilt_deg: 30, bifacial: 'not modelled', gamma_pdc: -0.0035, gamma_source: 'request', hours: 8760 },
      ],
      model: { temperature: { model: 'faiman', u0: 25, u1: 6.84 }, dc: 'pvwatts, reference 25 °C' },
      losses: [{ code: 'system', pct: 14 }],
      remaining_fraction: 0.86,
      typical_year: { months: Array(12).fill(2023), hours_from_mean: 0, rescale_factor: 1, calendar_year: 2023, leap_hours_left_out: 0 },
      anchoring: { source: 'pvgis', radiation_db: 'PVGIS-SARAH3', annual_kwh: 2 * pvgisAnnual },
      conventions: { azimuth: 'degrees clockwise from true north', time: 'interval start, UTC', days: "local standard time of the site's time zone" },
    });
    // A monofacial array says nothing about a rear side.
    expect(run.inputs.arrays[0]).not.toHaveProperty('bifacial');
    expect(run.inputs.model.not_modelled).toContain('bifacial rear-side gain');
    expect(run.inputs.arrays[0].modelled_annual_kwh).toBeCloseTo(modelledSouth, 5);
    expect(run.inputs.arrays[0].anchoring_factor).toBeCloseTo(pvgisAnnual / modelledSouth, 5);
    expect(run.inputs.anchoring.factor).toBeCloseTo((2 * pvgisAnnual) / run.inputs.anchoring.modelled_annual_kwh, 5);
    expect(run.results).toMatchObject({ series_id: result.seriesId, kwp: 30 });
  });

  it('keeps the real years as they are when asked, in a series apart from the typical year', async () => {
    const typical = await runYield(db, { pvSystemId: system, years: { from: 2023, to: 2023 }, profileCode: 'pvwatts', gammaPdc: -0.0035 }, clients());
    const real = await runYield(db, { pvSystemId: system, years: { from: 2023, to: 2023 }, profileCode: 'pvwatts', gammaPdc: -0.0035, typicalYear: false }, clients());
    expect(real.seriesId).not.toBe(typical.seriesId);
    const run = await one<{ inputs: Record<string, any>; results: Record<string, any> }>(db, 'select inputs, results from runs where id = $1', [real.runId]);
    expect(run.inputs.typical_year).toBeNull();
    expect(run.inputs.anchoring).toEqual({ source: 'none' });
    expect(run.inputs.years_covered).toEqual([2023]);
    expect(run.results.years_covered).toEqual([2023]);
    // Not anchored, one whole year: the annual is the model's own, the typical year's too.
    expect(real.annualKwh).toBeCloseTo(run.inputs.arrays[0].modelled_annual_kwh + run.inputs.arrays[1].modelled_annual_kwh, 3);
    expect(real.annualKwh).toBeCloseTo(typical.annualKwh, 3);
  });

  it('real years divide by the years covered: the last 30 days missing leave 2023 out', async () => {
    const whole2022 = await runYield(db, { pvSystemId: system, years: { from: 2022, to: 2022 }, profileCode: 'pvwatts', gammaPdc: -0.0035, typicalYear: false }, clients());
    const twoYears = await runYield(db, { pvSystemId: system, years: { from: 2022, to: 2023 }, profileCode: 'pvwatts', gammaPdc: -0.0035, typicalYear: false }, clients('2023-12-01T22:00:00Z'));
    const run = await one<{ inputs: Record<string, any> }>(db, 'select inputs from runs where id = $1', [twoYears.runId]);
    expect(run.inputs.years_covered).toEqual([2022]);
    expect(twoYears.annualKwh).toBeCloseTo(whole2022.annualKwh, 6);
    await expect(
      runYield(db, { pvSystemId: system, years: { from: 2023, to: 2023 }, profileCode: 'pvwatts', gammaPdc: -0.0035, typicalYear: false }, clients('2023-12-01T22:00:00Z')),
    ).rejects.toThrow(/period_not_covered/);
  });

  it('throws named errors for an array whose γ nobody gives, a γ out of its bounds, and a site without a time zone', async () => {
    await expect(runYield(db, { pvSystemId: system, years: { from: 2023, to: 2023 }, profileCode: 'pvwatts' }, clients())).rejects.toThrow(/gamma_unknown: array East/);
    await expect(runYield(db, { pvSystemId: system, years: { from: 2023, to: 2023 }, profileCode: 'pvwatts', gammaPdc: 0.0035 }, clients())).rejects.toThrow(/gamma_out_of_range: 0.0035/);
    const somewhere = await participant(db, { organisation_id: org, name: 'Somewhere', country: 'BE', geometry: { type: 'Point', coordinates: [4.35, 50.85] } });
    const device = await insert(db, 'devices', { organisation_id: org, participant_id: somewhere, name: 'PV', device_type: 'solar', rated_power_kw: 5 });
    await db.query('insert into solar.pv_systems (id, kwp_dc) values ($1, 5)', [device]);
    await expect(runYield(db, { pvSystemId: device, years: { from: 2023, to: 2023 }, profileCode: 'pvwatts', gammaPdc: -0.0035 }, clients())).rejects.toThrow(/time_zone_required/);
  });

  it('runs the same roof through pvgis_like and pvwatts: two runs, two sources, the difference written in their inputs', async () => {
    const seriescalc = await fixture('pvgis-seriescalc-brussels-2023-48h.json');
    const viaPvgis = await runYield(db, { pvSystemId: system, years: { from: 2023, to: 2023 } }, pvgis({ fetch: answering(seriescalc) }));
    const viaPvwatts = await runYield(db, { pvSystemId: system, years: { from: 2023, to: 2023 }, profileCode: 'pvwatts', gammaPdc: -0.0035 }, clients());

    const runs = await db.query<{ id: string; engine_version: string; inputs: Record<string, any> }>('select id, engine_version, inputs from runs where id = any($1) order by engine_version', [[viaPvgis.runId, viaPvwatts.runId]]);
    const [pvgisLike, pvwatts] = runs.rows;
    expect(pvgisLike.id).toBe(viaPvgis.runId);
    expect([pvgisLike.inputs.profile, pvwatts.inputs.profile]).toEqual(['pvgis_like', 'pvwatts']);
    expect([pvgisLike.inputs.weather.source, pvwatts.inputs.weather.source]).toEqual(['pvgis', 'open_meteo']);
    // What the irradiance is: PVGIS's satellite database against a reanalysis.
    expect(pvgisLike.inputs.weather.radiation_db).toBe('PVGIS-SARAH3');
    expect(pvwatts.inputs.weather.model).toBe('era5');
    // The same roof: the same arrays, read by both.
    expect(pvgisLike.inputs.arrays.map((a: any) => [a.kwp, a.azimuth_deg, a.tilt_deg])).toEqual(pvwatts.inputs.arrays.map((a: any) => [a.kwp, a.azimuth_deg, a.tilt_deg]));
    // How it was computed: PVGIS's own model, against the one this run states.
    expect(pvgisLike.inputs.model).toBeUndefined();
    expect(pvwatts.inputs.model.temperature).toEqual({ model: 'faiman', u0: 25, u1: 6.84 });

    // Both land on the system, apart, each with its source.
    const stored = await db.query<{ source_code: string; name: string | null }>(`select source_code, name from series where id = any($1) order by source_code`, [[viaPvgis.seriesId, viaPvwatts.seriesId]]);
    expect(stored.rows).toEqual([{ source_code: 'open_meteo', name: 'typical year 2023-2023' }, { source_code: 'pvgis', name: null }]);
    expect(viaPvwatts.annualKwh).not.toBeCloseTo(viaPvgis.annualKwh, 1);
  });
});
