// A PV yield as a run that says what it was computed from (decision 0012).
//
// Two profiles run here. `pvgis_like` is the cheapest one to verify: PVGIS
// itself does the computation (its irradiance, its DEM horizon, its one
// aggregate loss). `pvwatts` computes here (`pvwatts.ts`): the hourly
// plane-of-array irradiance, temperature and wind of a reanalysis read
// through a weather connector (Open-Meteo's ERA5 archive), a Faiman cell
// temperature, the PVWatts DC model, the profile's losses, a typical year
// chosen month by month in the site's local calendar, and optionally an
// annual anchored on PVGIS.
//
// Either way the run records the system, the arrays, the weather and its
// period, the models and losses, and the conventions the series are written
// in. The hourly energy lands as a `simulated` series on the PV system, the
// air temperature on its site; the run keeps the summary. Engines run
// outside Postgres; the database holds the parameters, the series and the
// run.
//
// With an external engine (decision 0013), the profile and the engine are
// two axes: the profile chooses the weather, the models and the losses, the
// engine computes. The run builds the engine's `pv_yield` request from the
// same system, arrays and profile, reads the weather through the same
// connector, and stores what the engine answers as it comes.

import type { Db } from '@nexgen-os/core';
import type { CollectedSeries, SeriesPoint, WeatherProvider } from '@nexgen-os/core';
import { store } from '@nexgen-os/core';
import { openMeteo } from '@nexgen-os/open-meteo';
import { pvgis, type PvgisSystem } from '@nexgen-os/pvgis';
import { ENGINE_CONTRACT, describeEngine, runEngine, type EngineSpec } from '@nexgen-os/core';
import { PVLIB_ENGINE, type EngineSeries, type PvYieldArray, type PvYieldRequest, type PvYieldResult } from '@nexgen-os/core';
import {
  POA_MAX_W_M2,
  alignWeather,
  anchoringFactor,
  arrayEnergy,
  checkedGamma,
  cleanWeather,
  meanAnnualOverCoveredYears,
  multiYearMeanAnnual,
  remainingAfterLosses,
  rescaleFactor,
  scaled,
  selectTypicalMonths,
  toYearGrid,
  total,
  typicalYear,
  withinLocalYears,
} from './pvwatts.js';
import { sandiaFromOnd } from './inverter.js';

export const ENGINE_VERSION = 'pvgis-5.3+solar-0.1.0';
export const PVWATTS_ENGINE_VERSION = 'solar-pvwatts-0.1.0';

/** The Open-Meteo dataset the `pvwatts` profile reads: ERA5 alone, not Open-Meteo's blend of reanalyses. */
const WEATHER_MODEL = 'era5';

export interface YieldRequest {
  pvSystemId: string;
  years: { from: number; to: number };
  /** Default `pvgis_like`. `pvgis_like` runs through PVGIS, `pvwatts` here. */
  profileCode?: string;
  /** PVGIS radiation database to force (`PVGIS-SARAH3`, `PVGIS-ERA5`); default: PVGIS's choice for the place. */
  raddatabase?: string;
  /** `pvwatts`: temperature coefficient of power, 1/°C, for the arrays whose module product is not a `pvwatts` one with its `gamma_pdc`. */
  gammaPdc?: number;
  /** `pvwatts`: one typical year (default), or with `false` the real years as they are. */
  typicalYear?: boolean;
  /** `pvwatts`: anchor each array's annual on PVGIS's yearly yield for the same array. Default: no anchoring. */
  anchor?: 'pvgis' | 'none';
  /**
   * An external engine that computes the profile (`pvlib`): its name, and
   * the command that starts it unless `NEXGEN_ENGINE_<NAME>` gives it. The
   * profile is then required; any profile whose models the engine has runs.
   */
  engine?: Pick<EngineSpec, 'name' | 'command' | 'timeoutMs'>;
}

export interface YieldResult {
  runId: string;
  seriesId: string;
  annualKwh: number;
  kwhPerKwp: number;
  kwp: number;
  /** The irradiance dataset: PVGIS's radiation database, or the input reanalysis. */
  radiationDb: string;
}

type PvgisClient = ReturnType<typeof pvgis>;

/** The connectors a run reads; each defaults to the open one. */
export interface YieldClients {
  pvgis?: PvgisClient;
  weather?: WeatherProvider;
}

interface SystemRow {
  organisation_id: string;
  site_id: string;
  /** IANA time zone of the site. */
  time_zone: string | null;
  kwp_dc: string | null;
  lon: number | null;
  lat: number | null;
  device_azimuth: string | null;
  device_tilt: string | null;
}

interface ArrayRow {
  /** Null for the one array of a system described without arrays. */
  id: string | null;
  name: string;
  azimuth_deg: string | null;
  tilt_deg: string | null;
  mounting: string;
  kwp_dc: string | null;
  /** From the array's module product when it is a `pvwatts` one. */
  gamma_pdc: number | null;
  bifacial: boolean;
  albedo: string | null;
  module_model: string | null;
  module_parameters: Record<string, unknown> | null;
  module_count: number | null;
  modules_per_string: number | null;
  strings: number | null;
  inverter_product_id: string | null;
  inverter_model: string | null;
  inverter_parameters: Record<string, unknown> | null;
  inverter_count: number | null;
}

interface PvArray extends Omit<ArrayRow, 'azimuth_deg' | 'tilt_deg' | 'kwp_dc' | 'albedo'> {
  kwp: number;
  azimuth_deg: number;
  tilt_deg: number;
  albedo: number | null;
}

interface ProfileRow {
  losses: { code: string; pct: number | null }[];
  decomposition_model: string | null;
  transposition_model: string | null;
  iam_model: string | null;
  spectral_model: string | null;
  temperature_model: string | null;
  temperature_params: Record<string, number>;
}

interface Context {
  system: SystemRow;
  where: { lon: number; lat: number };
  profile: ProfileRow;
  arrays: PvArray[];
  kwp: number;
}

const CONVENTIONS = { azimuth: 'degrees clockwise from true north', time: 'interval start, UTC', energy: 'kWh per hour' };

/** PVGIS knows two mountings: on a building, or free-standing. */
const PVGIS_MOUNTING: Record<string, PvgisSystem['mounting']> = {
  open_rack: 'free',
  tracker: 'free',
  floating: 'free',
  roof_parallel: 'building',
  semi_integrated: 'building',
  insulated: 'building',
};

export async function runYield(db: Db, request: YieldRequest, clients: YieldClients | PvgisClient = {}): Promise<YieldResult> {
  // A PVGIS client alone is what the `pvgis_like` profile needs.
  const given: YieldClients = 'hourly' in clients ? { pvgis: clients } : clients;
  if (request.engine && !request.profileCode) throw new Error('profile_required: a run with an engine names the yield profile the engine computes');
  const profileCode = request.profileCode ?? 'pvgis_like';
  if (!request.engine && profileCode !== 'pvgis_like' && profileCode !== 'pvwatts') {
    throw new Error(`profile_not_runnable_here: ${profileCode} needs an engine; pvgis_like runs through PVGIS, pvwatts here`);
  }
  if (!(request.years.from <= request.years.to)) throw new Error(`years_reversed: ${request.years.from} to ${request.years.to}`);
  // `pvwatts` and the engines cut days and months in the site's local calendar.
  const context = await loadContext(db, request.pvSystemId, profileCode, profileCode === 'pvwatts' || request.engine !== undefined);
  if (request.engine) return runWithEngine(db, request, profileCode, context, given.weather ?? openMeteo());
  return profileCode === 'pvgis_like'
    ? runPvgisLike(db, request, context, given.pvgis ?? pvgis())
    : runPvwatts(db, request, context, given.weather ?? openMeteo(), given.pvgis ?? pvgis());
}

/** The system, its position, its arrays (or one for the whole system) and the profile, checked. */
async function loadContext(db: Db, pvSystemId: string, profileCode: string, needsTimeZone: boolean): Promise<Context> {
  const system = (
    await db.query<SystemRow>(
      `select d.organisation_id, d.site_id, s.time_zone, p.kwp_dc,
              ST_X(ST_Centroid(s.geometry)) lon, ST_Y(ST_Centroid(s.geometry)) lat,
              f.azimuth_deg device_azimuth, f.tilt_deg device_tilt
         from solar.pv_systems p
         join devices d on d.id = p.id
         join sites s on s.id = d.site_id
         left join surfaces f on f.id = d.surface_id
        where p.id = $1`,
      [pvSystemId],
    )
  ).rows[0];
  if (!system) throw new Error(`pv_system_not_found: ${pvSystemId}`);
  if (system.lon === null || system.lat === null) throw new Error('site_without_position: the site of the PV system has no geometry');
  if (needsTimeZone && !system.time_zone) throw new Error(`time_zone_required: the site of the PV system has no time zone; ${profileCode} cuts days and months in it`);

  const profile = (
    await db.query<ProfileRow>(
      `select losses, decomposition_model, transposition_model, iam_model, spectral_model, temperature_model, temperature_params
         from solar.yield_profiles where code = $1`,
      [profileCode],
    )
  ).rows[0];
  if (!profile) throw new Error(`yield_profile_unknown: ${profileCode}`);

  let rows = (
    await db.query<ArrayRow>(
      `select a.id, a.name, a.azimuth_deg, a.tilt_deg, a.mounting, a.kwp_dc, a.bifacial, a.albedo,
              case when m.model = 'pvwatts' then (m.parameters ->> 'gamma_pdc')::float8 end gamma_pdc,
              m.model module_model, m.parameters module_parameters, a.module_count, a.modules_per_string, a.strings,
              a.inverter_product_id, i.model inverter_model, i.parameters inverter_parameters, a.inverter_count
         from solar.pv_arrays a
         left join solar.module_products m on m.id = a.module_product_id
         left join solar.inverter_products i on i.id = a.inverter_product_id
        where a.pv_system_id = $1
        order by a.created_at, a.id`,
      [pvSystemId],
    )
  ).rows;
  if (rows.length === 0) {
    // A system described without arrays: one array on the device's own surface, with the system's power.
    rows = [{
      id: null, name: 'whole system', azimuth_deg: system.device_azimuth, tilt_deg: system.device_tilt, mounting: 'roof_parallel', kwp_dc: system.kwp_dc, gamma_pdc: null, bifacial: false, albedo: null,
      module_model: null, module_parameters: null, module_count: null, modules_per_string: null, strings: null, inverter_product_id: null, inverter_model: null, inverter_parameters: null, inverter_count: null,
    }];
  }
  const arrays = rows.map((a) => {
    if (a.azimuth_deg === null || a.tilt_deg === null) throw new Error(`array_without_orientation: ${a.name}`);
    if (a.kwp_dc === null || Number(a.kwp_dc) <= 0) throw new Error(`array_without_power: ${a.name}`);
    return {
      ...a, kwp: Number(a.kwp_dc), azimuth_deg: Number(a.azimuth_deg), tilt_deg: Number(a.tilt_deg),
      gamma_pdc: a.gamma_pdc === null ? null : Number(a.gamma_pdc), albedo: a.albedo === null ? null : Number(a.albedo),
    };
  });
  return { system, where: { lon: system.lon, lat: system.lat }, profile, arrays, kwp: arrays.reduce((s, a) => s + a.kwp, 0) };
}

/** The days of weather a run reads for whole local years: one day more on each side, the values outside cut later. */
function weatherPeriod(years: { from: number; to: number }): { from: string; to: string } {
  return { from: `${years.from - 1}-12-31`, to: `${years.to + 1}-01-01` };
}

/** γ of an array: its `pvwatts` module product's, else the request's, checked. */
function gammaOf(a: PvArray, request: YieldRequest): { gamma: number; source: 'module_product' | 'request' } {
  const gamma = a.gamma_pdc ?? request.gammaPdc;
  if (gamma === undefined || !Number.isFinite(gamma)) throw new Error(`gamma_unknown: array ${a.name} has no pvwatts module product with gamma_pdc, and the request gives no gammaPdc`);
  return { gamma: checkedGamma(gamma), source: a.gamma_pdc !== null ? 'module_product' : 'request' };
}

/** What PVGIS is told about an array. */
function pvgisSpec(a: PvArray, systemLossPct: number): PvgisSystem {
  return { kwp: a.kwp, azimuth_deg: a.azimuth_deg, tilt_deg: a.tilt_deg, mounting: PVGIS_MOUNTING[a.mounting] ?? 'building', system_loss_pct: systemLossPct };
}

async function runPvgisLike(db: Db, request: YieldRequest, { system, where, profile, arrays, kwp }: Context, client: PvgisClient): Promise<YieldResult> {
  // PVGIS takes one aggregate loss.
  const systemLoss = profile.losses.reduce((sum, l) => sum + Number(l.pct), 0);
  const perArray = [];
  for (const a of arrays) {
    const spec = pvgisSpec(a, systemLoss);
    perArray.push({ spec, answer: await client.hourly(where, spec, request.years, { raddatabase: request.raddatabase }) });
  }

  // Energies add up across arrays, hour by hour; the temperature is the site's, taken once.
  const energy = sumSeries(perArray.map((x) => x.answer.series.find((s) => s.quantity_code === 'production_energy')!));
  const temperature = perArray[0].answer.series.find((s) => s.quantity_code === 'temperature')!;
  const owned: OwnedSeries[] = [
    { key: 'production', objectId: request.pvSystemId, sourceCode: client.source_code, series: energy },
    { key: 'temperature', objectId: system.site_id, sourceCode: client.source_code, series: temperature },
  ];

  const nYears = request.years.to - request.years.from + 1;
  const annualKwh = round(energy.values.reduce((s, v) => s + v.value, 0) / nYears);
  const radiationDb = perArray[0].answer.meta.radiation_db;
  const { runId, results } = await recordRun(
    db,
    ENGINE_VERSION,
    request.pvSystemId,
    {
      profile: 'pvgis_like',
      weather: { source: client.source_code, radiation_db: radiationDb, meteo_db: perArray[0].answer.meta.meteo_db, years: request.years, horizon: perArray[0].answer.meta.horizon },
      arrays: perArray.map((x) => ({ kwp: x.spec.kwp, azimuth_deg: x.spec.azimuth_deg, tilt_deg: x.spec.tilt_deg, mounting: x.spec.mounting })),
      losses: profile.losses,
      conventions: CONVENTIONS,
    },
    owned,
    (ids) => ({ series_id: ids.production, annual_kwh: annualKwh, kwh_per_kwp: round(annualKwh / kwp), kwp }),
  );
  return { runId, seriesId: results.series_id as string, annualKwh, kwhPerKwp: round(annualKwh / kwp), kwp, radiationDb };
}

async function runPvwatts(db: Db, request: YieldRequest, { system, where, profile, arrays, kwp }: Context, weather: WeatherProvider, reference: PvgisClient): Promise<YieldResult> {
  if (!weather.history) throw new Error(`weather_without_history: ${weather.source_code} gives no past weather`);
  if (profile.temperature_model !== 'faiman') throw new Error(`temperature_model_not_runnable_here: ${profile.temperature_model}; this engine has Faiman`);
  const u0 = Number(profile.temperature_params.u0);
  const u1 = Number(profile.temperature_params.u1);
  if (!Number.isFinite(u0) || !Number.isFinite(u1)) throw new Error('temperature_params_missing: the faiman model needs u0 and u1');
  const remainingFraction = remainingAfterLosses(profile.losses);
  const anchored = request.anchor === 'pvgis';
  const typical = request.typicalYear !== false;
  const timeZone = system.time_zone!;
  const years = request.years;
  // The years are the site's: one day more on each side is read, then
  // every value outside the local years is left out.
  const period = weatherPeriod(years);
  const local = (points: SeriesPoint[]) => withinLocalYears(points, timeZone, years);

  let siteTemperature: CollectedSeries | null = null;
  const perArray = [];
  for (const a of arrays) {
    const { gamma, source: gammaSource } = gammaOf(a, request);
    const answer = await weather.history(where, period.from, period.to, {
      quantities: ['poa_irradiance', 'temperature', 'wind_speed'], tilt_deg: a.tilt_deg, azimuth_deg: a.azimuth_deg, model: WEATHER_MODEL,
    });
    const read = (q: string) => answer.find((s) => s.quantity_code === q)?.values ?? [];
    if (!siteTemperature) {
      const t = answer.find((s) => s.quantity_code === 'temperature');
      if (t) siteTemperature = { ...t, values: local(t.values) };
    }
    const { hours, stats } = cleanWeather(alignWeather(local(read('poa_irradiance')), read('temperature'), read('wind_speed')));
    const energy = arrayEnergy(hours, { kwp: a.kwp, gammaPdc: gamma }, { u0, u1, remainingFraction });
    const modelled = multiYearMeanAnnual(toYearGrid(energy, timeZone));
    let anchoring: { annual_kwh: number; factor: number; radiation_db: string; meteo_db: string } | null = null;
    if (anchored) {
      const yearly = await reference.yearly(where, pvgisSpec(a, round((1 - remainingFraction) * 100)), { raddatabase: request.raddatabase });
      anchoring = { annual_kwh: yearly.annual_kwh, factor: anchoringFactor(yearly.annual_kwh, modelled), radiation_db: yearly.meta.radiation_db, meteo_db: yearly.meta.meteo_db };
    }
    perArray.push({ array: a, gamma, gammaSource, hours: hours.length, stats, modelled, anchoring, energy: anchoring ? scaled(energy, anchoring.factor) : energy });
  }

  // Energies add up across arrays, hour by hour. The typical months are
  // chosen once, on the system's energy, so that every array reads the
  // weather of the same days.
  const realYears = sumPoints(perArray.map((x) => x.energy));
  const grid = toYearGrid(realYears, timeZone);
  const months = typical ? selectTypicalMonths(grid) : null;
  let energy = realYears;
  let temperature = siteTemperature?.values ?? [];
  let rescale = 1;
  let fromMean = 0;
  let annual: number;
  let yearsCovered: number[] | null = null;
  if (months) {
    const year = typicalYear(grid, months, years.to, timeZone);
    rescale = rescaleFactor(multiYearMeanAnnual(grid), total(year.points));
    energy = scaled(year.points, rescale);
    fromMean = year.fromMean;
    annual = total(energy);
    if (siteTemperature) temperature = typicalYear(toYearGrid(temperature, timeZone), months, years.to, timeZone).points;
  } else {
    const covered = meanAnnualOverCoveredYears(realYears, timeZone, years);
    annual = covered.annual;
    yearsCovered = covered.yearsCovered;
  }

  const name = months ? `typical year ${years.from}-${years.to}` : null;
  const owned: OwnedSeries[] = [
    { key: 'production', objectId: request.pvSystemId, sourceCode: weather.source_code, name, series: { quantity_code: 'production_energy', value_kind: 'interval', step: '1 hour', values: rounded(energy) } },
    ...(siteTemperature ? [{ key: 'temperature', objectId: system.site_id, sourceCode: weather.source_code, name, series: { ...siteTemperature, values: rounded(temperature) } }] : []),
  ];

  const annualKwh = round(annual);
  const modelledTotal = perArray.reduce((s, x) => s + x.modelled, 0);
  const anchoredTotal = perArray.reduce((s, x) => s + (x.anchoring?.annual_kwh ?? 0), 0);
  const { runId, results } = await recordRun(
    db,
    PVWATTS_ENGINE_VERSION,
    request.pvSystemId,
    {
      profile: 'pvwatts',
      weather: {
        source: weather.source_code,
        model: WEATHER_MODEL,
        years,
        period,
        time_zone: timeZone,
        quantities: { poa_irradiance: 'global_tilted_irradiance, transposed by the source', temperature: 'air at 2 m', wind_speed: 'at 10 m' },
        time: 'preceding-hour means dated at the start of their hour; instants averaged over each hour',
        horizon: 'none',
      },
      years_covered: yearsCovered,
      arrays: perArray.map((x) => ({
        name: x.array.name, kwp: x.array.kwp, azimuth_deg: x.array.azimuth_deg, tilt_deg: x.array.tilt_deg, mounting: x.array.mounting,
        ...(x.array.bifacial ? { bifacial: 'not modelled' } : {}),
        gamma_pdc: x.gamma, gamma_source: x.gammaSource, hours: x.hours, cleaning: x.stats,
        modelled_annual_kwh: round(x.modelled), anchoring_factor: x.anchoring ? round(x.anchoring.factor) : null,
      })),
      model: {
        transposition: 'by the weather source',
        temperature: { model: 'faiman', u0, u1 },
        dc: 'pvwatts, reference 25 °C',
        poa_max_w_m2: POA_MAX_W_M2,
        not_modelled: ['inverter efficiency', 'clipping', 'incidence angle', 'spectrum', 'horizon in the hourly shape', 'bifacial rear-side gain'],
      },
      losses: profile.losses,
      remaining_fraction: round(remainingFraction),
      typical_year: months
        ? {
            method: 'month by month in the site\'s local standard time, the real month whose daily energies are closest to all years (Finkelstein-Schafer on daily energy, at least 95 % of the hours, the most recent year on a tie), an hour the chosen month lacks taken from the multi-year mean of that hour, scaled to the mean annual total over the years used',
            months,
            hours_from_mean: fromMean,
            rescale_factor: round(rescale),
            calendar_year: years.to,
            leap_hours_left_out: grid.leapHoursLeftOut,
          }
        : null,
      anchoring: anchored
        ? { source: reference.source_code, radiation_db: perArray[0].anchoring!.radiation_db, meteo_db: perArray[0].anchoring!.meteo_db, annual_kwh: round(anchoredTotal), modelled_annual_kwh: round(modelledTotal), factor: round(anchoredTotal / modelledTotal) }
        : { source: 'none' },
      conventions: {
        ...CONVENTIONS,
        losses: 'each applies to what the previous ones left',
        days: 'local standard time of the site\'s time zone',
        typical_year: 'simulated, 365-day grid, 29 February left out',
        real_years: 'the mean annual total over the years covered, a year counting with at least 95 % of its hours',
      },
    },
    owned,
    (ids) => ({ series_id: ids.production, annual_kwh: annualKwh, kwh_per_kwp: round(annualKwh / kwp), kwp, typical_months: months, years_covered: yearsCovered }),
  );
  return { runId, seriesId: results.series_id as string, annualKwh, kwhPerKwp: round(annualKwh / kwp), kwp, radiationDb: WEATHER_MODEL.toUpperCase() };
}

/** The engine's module and layout for an array: its module product's physics, or the PVWatts DC model on its power and γ. */
function engineModule(a: PvArray, request: YieldRequest): Pick<PvYieldArray, 'module' | 'modules_per_string' | 'strings'> {
  if (a.module_model && a.module_model !== 'pvwatts') {
    const perString = a.modules_per_string ?? a.module_count;
    if (perString === null) throw new Error(`array_without_layout: ${a.name} has ${a.module_model} module parameters but no module count or strings`);
    return { module: { model: a.module_model as PvYieldArray['module']['model'], parameters: a.module_parameters ?? {} }, modules_per_string: perString, strings: a.strings ?? 1 };
  }
  // PVWatts scales linearly with pdc0: the array as one module of its whole power.
  return { module: { model: 'pvwatts', parameters: { pdc0: a.kwp * 1000, gamma_pdc: gammaOf(a, request).gamma } }, modules_per_string: 1, strings: 1 };
}

/** The one inverter of the system as the engine sees it, or none (`no_loss`) when no array names one. */
function engineInverter(arrays: PvArray[]): PvYieldRequest['inverter'] {
  const products = new Set(arrays.map((a) => a.inverter_product_id));
  if (products.size > 1) throw new Error('inverters_differ: the arrays name different inverters; one engine request per inverter is not built yet');
  const a = arrays[0];
  if (a.inverter_product_id === null) return { model: 'no_loss' };
  const count = a.inverter_count ?? 1;
  const parameters = { ...(a.inverter_parameters ?? {}) };
  if (count > 1) {
    if (a.inverter_model !== 'pvwatts') throw new Error(`inverter_count_not_runnable: ${count} ${a.inverter_model} inverters; only a pvwatts inverter scales by its count`);
    parameters.pdc0 = Number(parameters.pdc0) * count;
  }
  // An OND file's curves become the Sandia model, fitted as pvlib fits it.
  const model = a.inverter_model === 'ond' ? 'sandia' : (a.inverter_model as PvYieldRequest['inverter']['model']);
  // Sandia and ADR read the DC voltage, which only a one-diode or Sandia module model gives.
  const flat = arrays.find((x) => x.module_model === null || x.module_model === 'pvwatts');
  if ((model === 'sandia' || model === 'adr') && flat) {
    throw new Error(`inverter_needs_voltage: the ${a.inverter_model} inverter reads the DC voltage, which the pvwatts module model of ${flat.name} does not give; name a module product with cec, pvsyst or sapm parameters`);
  }
  if (a.inverter_model === 'ond') return { model, parameters: { ...sandiaFromOnd(parameters) } };
  return { model, parameters };
}

async function runWithEngine(db: Db, request: YieldRequest, profileCode: string, { system, where, profile, arrays, kwp }: Context, weather: WeatherProvider): Promise<YieldResult> {
  if (!weather.history) throw new Error(`weather_without_history: ${weather.source_code} gives no past weather`);
  const spec: EngineSpec = { ...(request.engine!.name === PVLIB_ENGINE.name ? PVLIB_ENGINE : {}), ...request.engine! };
  const described = await describeEngine(spec);
  if (!described.kinds.includes('pv_yield')) throw new Error(`engine_kind_unsupported: ${spec.name} accepts ${described.kinds.join(', ')}, not pv_yield`);
  const timeZone = system.time_zone!;
  const years = request.years;
  const period = weatherPeriod(years);
  const local = (points: SeriesPoint[]) => withinLocalYears(points, timeZone, years);

  // A profile that names a transposition lets the engine transpose the
  // horizontal components; one that names none reads the plane-of-array
  // irradiance the weather source transposed, array by array, as `pvwatts`.
  // Intervals are cut to the local years; instants are sent whole, so that
  // the last interval has its two ends.
  const transposed = profile.transposition_model !== null;
  const sent: EngineSeries[] = [];
  if (transposed) {
    const components = profile.decomposition_model === null || profile.decomposition_model === 'none' ? ['ghi', 'dni', 'dhi'] : ['ghi'];
    for (const s of await weather.history(where, period.from, period.to, { quantities: [...components, 'temperature', 'wind_speed'], model: WEATHER_MODEL })) {
      sent.push(s.value_kind === 'interval' ? { ...s, values: local(s.values) } : s);
    }
  } else {
    for (const [i, a] of arrays.entries()) {
      const quantities = i === 0 ? ['poa_irradiance', 'temperature', 'wind_speed'] : ['poa_irradiance'];
      for (const s of await weather.history(where, period.from, period.to, { quantities, tilt_deg: a.tilt_deg, azimuth_deg: a.azimuth_deg, model: WEATHER_MODEL })) {
        sent.push(s.quantity_code === 'poa_irradiance' ? { ...s, values: local(s.values), array: a.name } : s);
      }
    }
  }

  const engineRequest: PvYieldRequest = {
    kind: 'pv_yield',
    site: { lat: where.lat, lon: where.lon, time_zone: timeZone },
    arrays: arrays.map((a) => ({ name: a.name, azimuth_deg: a.azimuth_deg, tilt_deg: a.tilt_deg, mounting: a.mounting as PvYieldArray['mounting'], albedo: a.albedo, ...engineModule(a, request) })),
    inverter: engineInverter(arrays),
    losses: profile.losses.map((l) => ({ code: l.code, fraction: l.pct === null ? null : Number(l.pct) / 100 })),
    models: {
      decomposition: profile.decomposition_model === 'none' ? null : profile.decomposition_model,
      transposition: profile.transposition_model,
      temperature: profile.temperature_model ?? '',
      ...(Object.keys(profile.temperature_params).length > 0 ? { temperature_parameters: profile.temperature_params } : {}),
      aoi: profile.iam_model ?? 'no_loss',
      spectral: profile.spectral_model ?? 'no_loss',
    },
    weather: sent,
  };
  const answer = await runEngine<PvYieldRequest, PvYieldResult>(spec, engineRequest);
  if (answer.version !== described.version) throw new Error(`engine_contract_mismatch: ${spec.name} described itself as ${described.version} and answered as ${answer.version}`);

  // The answer is stored as it comes: the engine's series are core series.
  const answered = answer.result.series;
  const energy = answered.find((s) => s.quantity_code === 'production_energy' && s.array === undefined);
  if (!energy) throw new Error(`engine_contract_mismatch: ${spec.name} answered no production_energy for the system`);
  const name = `${spec.name} ${years.from}-${years.to}`;
  const owned: OwnedSeries[] = [{ key: 'production', objectId: request.pvSystemId, sourceCode: weather.source_code, name, series: energy }];
  const arrayKeys: { array: string; quantity: string; key: string }[] = [];
  for (const s of answered.filter((x) => x.array !== undefined)) {
    const a = arrays.find((x) => x.name === s.array);
    if (!a) throw new Error(`engine_contract_mismatch: ${spec.name} answered a series for an array the request does not have: ${s.array}`);
    // An array described without its own row: its series hang on the system,
    // told apart by the array's name.
    const key = `array ${a.name}: ${s.quantity_code}`;
    arrayKeys.push({ array: a.name, quantity: s.quantity_code, key });
    owned.push({ key, objectId: a.id ?? request.pvSystemId, sourceCode: weather.source_code, name: a.id ? name : `${name} ${a.name}`, series: s });
  }

  const covered = meanAnnualOverCoveredYears(energy.values, timeZone, years);
  const annualKwh = round(covered.annual);
  const { runId, results } = await recordRun(
    db,
    described.version,
    request.pvSystemId,
    {
      profile: profileCode,
      engine: { name: spec.name, version: described.version, contract: ENGINE_CONTRACT, dependencies: described.dependencies },
      weather: {
        source: weather.source_code,
        model: WEATHER_MODEL,
        years,
        period,
        time_zone: timeZone,
        quantities: transposed ? sent.map((s) => s.quantity_code) : 'poa_irradiance per array, temperature, wind_speed',
        horizon: 'none',
      },
      arrays: arrays.map((a, i) => ({
        name: a.name, kwp: a.kwp, azimuth_deg: a.azimuth_deg, tilt_deg: a.tilt_deg, mounting: a.mounting,
        module_model: engineRequest.arrays[i].module.model, ...(a.bifacial ? { bifacial: 'not modelled' } : {}),
      })),
      inverter: { ...engineRequest.inverter, ...(arrays[0].inverter_model === 'ond' ? { fitted_from: 'ond' } : {}) },
      model: answer.result.meta,
      losses: profile.losses,
      conventions: { ...CONVENTIONS, losses: 'each applies to what the previous ones left', days: 'local standard time of the site\'s time zone' },
    },
    owned,
    (ids) => {
      const perArray: Record<string, Record<string, string>> = {};
      for (const k of arrayKeys) (perArray[k.array] ??= {})[k.quantity] = ids[k.key];
      return { series_id: ids.production, annual_kwh: annualKwh, kwh_per_kwp: round(annualKwh / kwp), kwp, years_covered: covered.yearsCovered, array_series: perArray };
    },
  );
  return { runId, seriesId: results.series_id as string, annualKwh, kwhPerKwp: round(annualKwh / kwp), kwp, radiationDb: WEATHER_MODEL.toUpperCase() };
}

/** A series a run computed, under the key its results name it by. */
interface OwnedSeries {
  key: string;
  objectId: string;
  sourceCode: string;
  name?: string | null;
  series: CollectedSeries;
}

/**
 * Records a run with the series it owns: the run of the same identity when
 * it is already there, untouched; else a new one, whose series are written
 * with its id before it is final, so that no later run ever overwrites them.
 */
async function recordRun(
  db: Db,
  engineVersion: string,
  subjectId: string,
  inputs: unknown,
  owned: OwnedSeries[],
  results: (seriesIds: Record<string, string>) => Record<string, unknown>,
): Promise<{ runId: string; results: Record<string, unknown> }> {
  const started = (await db.query<{ run_id: string; finished: boolean }>(
    `select run_id, finished from start_run('solar', $1, $2, null, $3::jsonb)`, [engineVersion, subjectId, JSON.stringify(inputs)])).rows[0];
  if (started.finished) {
    const done = await db.query<{ results: Record<string, unknown> }>('select results from runs where id = $1', [started.run_id]);
    return { runId: started.run_id, results: done.rows[0].results };
  }
  const ids: Record<string, string> = {};
  // The values are in the quantity's unit, as the engines' contract says:
  // the `unit` an engine answers with is a label, not a conversion.
  for (const o of owned) {
    const stored = await store(db, {
      object_id: o.objectId, quantity_code: o.series.quantity_code, kind: 'simulated', value_kind: o.series.value_kind,
      step: o.series.step, source_code: o.sourceCode, name: o.name ?? null, run_id: started.run_id,
    }, o.series.values);
    ids[o.key] = stored.seriesId;
  }
  const final = results(ids);
  await db.query(`select finish_run($1, $2::jsonb)`, [started.run_id, JSON.stringify(final)]);
  return { runId: started.run_id, results: final };
}

/** Values of several series added up, instant by instant. */
function sumPoints(series: SeriesPoint[][]): SeriesPoint[] {
  const byAt = new Map<string, number>();
  for (const s of series) for (const v of s) byAt.set(v.at, (byAt.get(v.at) ?? 0) + v.value);
  return [...byAt.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([at, value]) => ({ at, value }));
}

function sumSeries(series: CollectedSeries[]): CollectedSeries {
  return { ...series[0], values: rounded(sumPoints(series.map((s) => s.values))) };
}

function rounded(points: SeriesPoint[]): SeriesPoint[] {
  return points.map((p) => ({ at: p.at, value: round(p.value) }));
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
