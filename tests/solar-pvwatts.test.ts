// The `pvwatts` yield profile: each step of the model against values worked
// out by hand, the Open-Meteo archive read in the core's conventions, a run
// on a system of two arrays with recorded Open-Meteo and PVGIS answers, and
// the acceptance test of decision 0012 at small scale: the same roof run
// through `pvgis_like` and `pvwatts` gives two runs whose inputs say why
// they differ.
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { SeriesPoint } from '../connectors/index.js';
import { openMeteo } from '../connectors/open-meteo/index.js';
import { pvgis } from '../connectors/pvgis/index.js';
import type { Fetch } from '../formats/geocoding/index.js';
import {
  alignWeather,
  anchoringFactor,
  arrayEnergy,
  cleanWeather,
  faimanCellTemperature,
  finkelsteinSchafer,
  hourOfYear,
  lossFactor,
  multiYearMeanAnnual,
  pvwattsEnergyPerKwp,
  rescaleFactor,
  scaled,
  selectTypicalMonths,
  toYearGrid,
  total,
  typicalYear,
} from '../modules/solar/pvwatts.js';
import { runYield } from '../modules/solar/yield.js';
import { USER_A, freshDatabase, insert, one, organisation, repoRoot, square } from './helpers/db.js';

const FAIMAN = { u0: 25, u1: 6.84 };

describe('the pvwatts model, step by step', () => {
  it('a clear-sky hour: 1000 W/m², 20 °C, 2 m/s, γ −0.35 %/K, 14 % losses', () => {
    // Tcell = 20 + 1000 / (25 + 6.84 × 2) = 20 + 1000 / 38.68 = 45.8532 °C
    const tCell = faimanCellTemperature(1000, 20, 2, FAIMAN);
    expect(tCell).toBeCloseTo(45.853154, 5);
    // E = 1 × [1 − 0.0035 × 20.8532] × 0.86 = 0.927014 × 0.86 = 0.797232 kWh per kWp
    expect(pvwattsEnergyPerKwp(1000, tCell, -0.0035, lossFactor([{ code: 'system', pct: 14 }]))).toBeCloseTo(0.797232, 6);
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
    expect(arrayEnergy([{ at: '2023-07-01T12:00:00.000Z', poa: 900, temperature: 35, wind: 0 }], { kwp: 4, gammaPdc: -0.0035 }, { ...FAIMAN, leftAfterLosses: 0.86 })[0].value).toBeCloseTo(4 * 0.649386, 6);
  });

  it('losses apply in their order, each to what the previous ones left; a loss without a value is refused', () => {
    expect(lossFactor([{ code: 'system', pct: 14 }])).toBeCloseTo(0.86, 12);
    // 0.98 × 0.985 × 1.0075 = 0.97253975: a negative loss is a gain.
    expect(lossFactor([{ code: 'soiling', pct: 2 }, { code: 'dc_wiring', pct: 1.5 }, { code: 'module_quality', pct: -0.75 }])).toBeCloseTo(0.97253975, 10);
    expect(lossFactor([])).toBe(1);
    expect(() => lossFactor([{ code: 'iam', pct: null }])).toThrow(/loss_without_value: iam/);
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

  it('lays years on a 365-day grid and leaves 29 February out', () => {
    expect(hourOfYear('2023-01-01T00:00:00Z')).toBe(0);
    expect(hourOfYear('2024-02-29T05:00:00Z')).toBeNull();
    // 1 March is hour 59 × 24 in a leap year as in any other.
    expect(hourOfYear('2024-03-01T00:00:00Z')).toBe(1416);
    expect(hourOfYear('2023-03-01T00:00:00Z')).toBe(1416);
    expect(hourOfYear('2024-12-31T23:00:00Z')).toBe(8759);
    const leapDay = Array.from({ length: 24 }, (_, h) => ({ at: new Date(Date.UTC(2024, 1, 29, h)).toISOString(), value: 1 }));
    const grid = toYearGrid([...leapDay, { at: '2024-03-01T00:00:00Z', value: 5 }]);
    expect(grid.leapHoursLeftOut).toBe(24);
    expect(grid.years.get(2024)![1416]).toBe(5);
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
    const grid = toYearGrid([...covered(2021, (d) => (d % 2 === 0 ? 1 : 3)), ...covered(2022, () => 3), ...covered(2023, () => 1)]);
    const months = selectTypicalMonths(grid);
    expect(months[0]).toBe(2021);
    expect(months.slice(1)).toEqual(Array(11).fill(null));
    // Two identical years: the most recent wins.
    expect(selectTypicalMonths(toYearGrid([...covered(2020, () => 2), ...covered(2021, () => 2)]))[0]).toBe(2021);
    // A year with a few days only is no candidate.
    expect(selectTypicalMonths(toYearGrid([...covered(2020, () => 2), ...january(2024, () => 2)]))[0]).toBe(2020);
  });

  it('builds the typical year on one calendar, from the months chosen or the mean, and leaves missing hours out', () => {
    const grid = toYearGrid([...january(2021, () => 1), ...january(2022, () => 3), { at: '2022-07-01T12:00:00Z', value: 6 }]);
    const year = typicalYear(grid, [2022, ...Array(11).fill(null)], 2025);
    expect(year).toHaveLength(32);
    expect(year[0]).toEqual({ at: '2025-01-01T12:00:00.000Z', value: 3 });
    expect(year[31]).toEqual({ at: '2025-07-01T12:00:00.000Z', value: 6 });
    // With no month chosen, January is the mean of the two years.
    expect(typicalYear(grid, Array(12).fill(null), 2025)[0].value).toBe(2);
  });

  it('rescales the typical year to the mean annual of the years read, and anchors on a reference', () => {
    // Hour 10: 2 then 4 → mean 3; hour 20: only 2023, 6 → mean annual 9.
    const grid = toYearGrid([
      { at: '2022-01-01T10:00:00Z', value: 2 },
      { at: '2023-01-01T10:00:00Z', value: 4 },
      { at: '2023-01-01T20:00:00Z', value: 6 },
    ]);
    expect(multiYearMeanAnnual(grid)).toBe(9);
    const year = typicalYear(grid, [2022, ...Array(11).fill(null)], 2023);
    expect(total(year)).toBe(2);
    const k = rescaleFactor(multiYearMeanAnnual(grid), total(year));
    expect(k).toBe(4.5);
    expect(total(scaled(year, k))).toBe(9);
    expect(rescaleFactor(9, 0)).toBe(1);
    expect(anchoringFactor(950, 1000)).toBe(0.95);
    expect(() => anchoringFactor(950, 0)).toThrow(/anchoring_impossible/);
  });
});

const fixture = async (name: string) => JSON.parse(await readFile(`${repoRoot}/tests/fixtures/${name}`, 'utf8'));
const answering = (body: unknown, asked: string[] = []): Fetch => async (url) => {
  asked.push(url);
  return { ok: true, status: 200, json: async () => body };
};

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
  let south: Record<string, { time: number[]; global_tilted_irradiance: number[]; temperature_2m: number[]; wind_speed_10m: number[] }>;
  let pvcalc: { outputs: { totals: { fixed: { E_y: number } } } };
  const weatherAsked: string[] = [];
  const pvgisAsked: string[] = [];

  beforeAll(async () => {
    db = await freshDatabase(['solar']);
    org = await organisation(db, 'A cooperative', USER_A);
    site = await insert(db, 'sites', { organisation_id: org, name: 'Hall', country: 'BE', time_zone: 'Europe/Brussels', geometry: { type: 'Point', coordinates: [4.35, 50.85] } });
    const building = await insert(db, 'buildings', { organisation_id: org, site_id: site, name: 'Hall', footprint: square(4.35, 50.85, 30, 20), height_m: 8 });
    const southFace = await insert(db, 'surfaces', { organisation_id: org, building_id: building, name: 'South pitch', kind: 'roof', azimuth_deg: 180, tilt_deg: 30 });
    const eastFace = await insert(db, 'surfaces', { organisation_id: org, building_id: building, name: 'East pitch', kind: 'roof', azimuth_deg: 90, tilt_deg: 30 });
    system = await insert(db, 'devices', { organisation_id: org, site_id: site, building_id: building, name: 'Roof PV', device_type: 'solar', rated_power_kw: 30 });
    await db.query('insert into solar.pv_systems (id, kwp_dc) values ($1, 30)', [system]);
    // The south array's modules have PVWatts parameters; the east array's have none.
    const product = await insert(db, 'device_directory', { device_type: 'solar', manufacturer: 'Acme', model_ref: 'Sun 400', unit_power_kw: 0.4, published_by: 'solar' });
    await db.query(`insert into solar.module_products (id, model, parameters) values ($1, 'pvwatts', '{"pdc0": 400, "gamma_pdc": -0.0037}')`, [product]);
    await db.query(`insert into solar.pv_arrays (organisation_id, pv_system_id, surface_id, name, mounting, module_product_id, module_count) values ($1, $2, $3, 'South', 'roof_parallel', $4, 50)`, [org, system, southFace, product]);
    await db.query(`insert into solar.pv_arrays (organisation_id, pv_system_id, surface_id, name, mounting, kwp_dc) values ($1, $2, $3, 'East', 'roof_parallel', 10)`, [org, system, eastFace]);
    south = await fixture('open-meteo-era5-brussels-2023-01-01-03-south30.json');
    pvcalc = await fixture('pvgis-pvcalc-brussels-south30.json');
  });

  afterAll(async () => {
    await db.close();
  });

  const clients = async () => {
    const east = await fixture('open-meteo-era5-brussels-2023-01-01-03-east30.json');
    const weather = openMeteo({ fetch: async (url) => { weatherAsked.push(url); return { ok: true, status: 200, json: async () => (new URL(url).searchParams.get('azimuth') === '0' ? south : east) }; } });
    return { weather, pvgis: pvgis({ fetch: answering(pvcalc, pvgisAsked) }) };
  };

  it('reads the weather per array, adds the energies, stores a typical year anchored on PVGIS and records everything it used', async () => {
    const result = await runYield(db, { pvSystemId: system, years: { from: 2023, to: 2023 }, profileCode: 'pvwatts', gammaPdc: -0.0035, anchor: 'pvgis' }, await clients());

    // One weather read and one PVGIS yearly per array, for whole years.
    expect(weatherAsked).toHaveLength(2);
    expect(weatherAsked.map((u) => [new URL(u).searchParams.get('azimuth'), new URL(u).searchParams.get('start_date'), new URL(u).searchParams.get('end_date')])).toEqual([['0', '2023-01-01', '2024-01-01'], ['-90', '2023-01-01', '2024-01-01']]);
    expect(pvgisAsked.map((u) => [new URL(u).pathname.endsWith('/PVcalc'), new URL(u).searchParams.get('peakpower'), new URL(u).searchParams.get('loss')])).toEqual([[true, '20', '14'], [true, '10', '14']]);

    // The anchored annual of each array is PVGIS's answer: the recorded 1 kWp one is served to both.
    const pvgisAnnual = pvcalc.outputs.totals.fixed.E_y;
    expect(result.kwp).toBe(30);
    expect(result.annualKwh).toBeCloseTo(2 * pvgisAnnual, 3);
    expect(result.radiationDb).toBe('ERA5');

    // The south array's factor, worked out again from the recorded weather with the module's own γ.
    const read = await openMeteo({ fetch: answering(south) }).history!({ lon: 4.35, lat: 50.85 }, '2023-01-01', '2023-12-31', { tilt_deg: 30, azimuth_deg: 180 });
    const { hours } = cleanWeather(alignWeather(read[0].values, read[1].values, read[2].values));
    const modelledSouth = total(arrayEnergy(hours, { kwp: 20, gammaPdc: -0.0037 }, { ...FAIMAN, leftAfterLosses: 0.86 }));

    const series = await one<{ kind: string; source: string; name: string; n: number }>(
      db,
      `select s.kind, s.source_code source, s.name, count(v.*)::int n from series s join series_values v on v.series_id = s.id where s.id = $1 group by s.kind, s.source_code, s.name`,
      [result.seriesId],
    );
    // Three recorded days, the first hour of 3 January's day after left out: 71 hours, none invented for the rest of the year.
    expect(series).toEqual({ kind: 'simulated', source: 'open_meteo', name: 'typical year 2023-2023', n: 71 });
    const temperature = await one<{ n: number }>(db, `select count(v.*)::int n from series s join series_values v on v.series_id = s.id where s.object_id = $1 and s.quantity_code = 'temperature'`, [site]);
    expect(temperature.n).toBe(72);

    const run = await one<{ module_code: string; engine_version: string; inputs: Record<string, any>; results: Record<string, any> }>(db, 'select module_code, engine_version, inputs, results from runs where id = $1', [result.runId]);
    expect(run.module_code).toBe('solar');
    expect(run.engine_version).toBe('solar-pvwatts-0.1.0');
    expect(run.inputs).toMatchObject({
      profile: 'pvwatts',
      weather: { source: 'open_meteo', model: 'era5', years: { from: 2023, to: 2023 }, period: { from: '2023-01-01', to: '2023-12-31' } },
      arrays: [
        { name: 'South', kwp: 20, azimuth_deg: 180, tilt_deg: 30, gamma_pdc: -0.0037, gamma_source: 'module_product', hours: 71 },
        { name: 'East', kwp: 10, azimuth_deg: 90, tilt_deg: 30, gamma_pdc: -0.0035, gamma_source: 'request', hours: 71 },
      ],
      model: { temperature: { model: 'faiman', u0: 25, u1: 6.84 }, dc: 'pvwatts, reference 25 °C' },
      losses: [{ code: 'system', pct: 14 }],
      loss_factor: 0.86,
      typical_year: { months: Array(12).fill(null), rescale_factor: 1, dated_in: 2023 },
      anchoring: { source: 'pvgis', radiation_db: 'PVGIS-SARAH3', annual_kwh: 2 * pvgisAnnual },
      conventions: { azimuth: 'degrees clockwise from true north', time: 'interval start, UTC' },
    });
    expect(run.inputs.arrays[0].modelled_annual_kwh).toBeCloseTo(modelledSouth, 5);
    expect(run.inputs.arrays[0].anchoring_factor).toBeCloseTo(pvgisAnnual / modelledSouth, 5);
    expect(run.inputs.anchoring.factor).toBeCloseTo((2 * pvgisAnnual) / run.inputs.anchoring.modelled_annual_kwh, 5);
    expect(run.results).toMatchObject({ series_id: result.seriesId, kwp: 30 });
  });

  it('keeps the real years as they are when asked, in a series apart from the typical year', async () => {
    const typical = await runYield(db, { pvSystemId: system, years: { from: 2023, to: 2023 }, profileCode: 'pvwatts', gammaPdc: -0.0035, anchor: 'pvgis' }, await clients());
    const real = await runYield(db, { pvSystemId: system, years: { from: 2023, to: 2023 }, profileCode: 'pvwatts', gammaPdc: -0.0035, typicalYear: false }, await clients());
    expect(real.seriesId).not.toBe(typical.seriesId);
    const run = await one<{ inputs: Record<string, any> }>(db, 'select inputs from runs where id = $1', [real.runId]);
    expect(run.inputs.typical_year).toBeNull();
    expect(run.inputs.anchoring).toEqual({ source: 'none' });
    // Not anchored: the annual is the model's own, far below PVGIS's on three days of January.
    expect(real.annualKwh).toBeCloseTo(run.inputs.arrays[0].modelled_annual_kwh + run.inputs.arrays[1].modelled_annual_kwh, 3);
    expect(real.annualKwh).toBeLessThan(typical.annualKwh / 10);
  });

  it('refuses an array whose γ nobody gives, by name', async () => {
    await expect(runYield(db, { pvSystemId: system, years: { from: 2023, to: 2023 }, profileCode: 'pvwatts' }, await clients())).rejects.toThrow(/gamma_unknown: array East/);
  });

  it('runs the same roof through pvgis_like and pvwatts: two runs, two sources, the difference written in their inputs', async () => {
    const seriescalc = await fixture('pvgis-seriescalc-brussels-2023-48h.json');
    const viaPvgis = await runYield(db, { pvSystemId: system, years: { from: 2023, to: 2023 } }, pvgis({ fetch: answering(seriescalc) }));
    const viaPvwatts = await runYield(db, { pvSystemId: system, years: { from: 2023, to: 2023 }, profileCode: 'pvwatts', gammaPdc: -0.0035 }, await clients());

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
