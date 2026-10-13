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

import type { Db } from '../../formats/db.js';
import { storeSeries, type CollectedSeries, type SeriesPoint, type SeriesTarget, type WeatherProvider } from '../../connectors/index.js';
import { openMeteo } from '../../connectors/open-meteo/index.js';
import { pvgis, type PvgisSystem } from '../../connectors/pvgis/index.js';
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
  name: string;
  azimuth_deg: string | null;
  tilt_deg: string | null;
  mounting: string;
  kwp_dc: string | null;
  /** From the array's module product when it is a `pvwatts` one. */
  gamma_pdc: number | null;
  bifacial: boolean;
}

interface PvArray {
  name: string;
  kwp: number;
  azimuth_deg: number;
  tilt_deg: number;
  mounting: string;
  gamma_pdc: number | null;
  bifacial: boolean;
}

interface ProfileRow {
  losses: { code: string; pct: number | null }[];
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
  const profileCode = request.profileCode ?? 'pvgis_like';
  if (profileCode !== 'pvgis_like' && profileCode !== 'pvwatts') {
    throw new Error(`profile_not_runnable_here: ${profileCode} needs an engine; pvgis_like runs through PVGIS, pvwatts here`);
  }
  if (!(request.years.from <= request.years.to)) throw new Error(`years_reversed: ${request.years.from} to ${request.years.to}`);
  const context = await loadContext(db, request.pvSystemId, profileCode);
  return profileCode === 'pvgis_like'
    ? runPvgisLike(db, request, context, given.pvgis ?? pvgis())
    : runPvwatts(db, request, context, given.weather ?? openMeteo(), given.pvgis ?? pvgis());
}

/** The system, its position, its arrays (or one for the whole system) and the profile, checked. */
async function loadContext(db: Db, pvSystemId: string, profileCode: string): Promise<Context> {
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
  // `pvwatts` cuts days and months in the site's local calendar.
  if (profileCode === 'pvwatts' && !system.time_zone) throw new Error('time_zone_required: the site of the PV system has no time zone; pvwatts cuts days and months in it');

  const profile = (await db.query<ProfileRow>('select losses, temperature_model, temperature_params from solar.yield_profiles where code = $1', [profileCode])).rows[0];
  if (!profile) throw new Error(`yield_profile_unknown: ${profileCode}`);

  let rows = (
    await db.query<ArrayRow>(
      `select a.name, a.azimuth_deg, a.tilt_deg, a.mounting, a.kwp_dc, a.bifacial,
              case when m.model = 'pvwatts' then (m.parameters ->> 'gamma_pdc')::float8 end gamma_pdc
         from solar.pv_arrays a
         left join solar.module_products m on m.id = a.module_product_id
        where a.pv_system_id = $1
        order by a.created_at, a.id`,
      [pvSystemId],
    )
  ).rows;
  if (rows.length === 0) {
    // A system described without arrays: one array on the device's own surface, with the system's power.
    rows = [{ name: 'whole system', azimuth_deg: system.device_azimuth, tilt_deg: system.device_tilt, mounting: 'roof_parallel', kwp_dc: system.kwp_dc, gamma_pdc: null, bifacial: false }];
  }
  const arrays = rows.map((a) => {
    if (a.azimuth_deg === null || a.tilt_deg === null) throw new Error(`array_without_orientation: ${a.name}`);
    if (a.kwp_dc === null || Number(a.kwp_dc) <= 0) throw new Error(`array_without_power: ${a.name}`);
    return { name: a.name, kwp: Number(a.kwp_dc), azimuth_deg: Number(a.azimuth_deg), tilt_deg: Number(a.tilt_deg), mounting: a.mounting, gamma_pdc: a.gamma_pdc === null ? null : Number(a.gamma_pdc), bifacial: a.bifacial };
  });
  return { system, where: { lon: system.lon, lat: system.lat }, profile, arrays, kwp: arrays.reduce((s, a) => s + a.kwp, 0) };
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
  const target = { organisationId: system.organisation_id, objectId: request.pvSystemId, sourceCode: client.source_code, kind: 'simulated' as const };
  const stored = await storeSeries(db, target, energy);
  await storeSeries(db, { ...target, objectId: system.site_id }, temperature);

  const nYears = request.years.to - request.years.from + 1;
  const annualKwh = round(energy.values.reduce((s, v) => s + v.value, 0) / nYears);
  const radiationDb = perArray[0].answer.meta.radiation_db;
  const runId = await recordRun(
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
    { series_id: stored.seriesId, annual_kwh: annualKwh, kwh_per_kwp: round(annualKwh / kwp), kwp },
  );
  return { runId, seriesId: stored.seriesId, annualKwh, kwhPerKwp: round(annualKwh / kwp), kwp, radiationDb };
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
  const period = { from: `${years.from - 1}-12-31`, to: `${years.to + 1}-01-01` };
  const local = (points: SeriesPoint[]) => withinLocalYears(points, timeZone, years);

  let siteTemperature: CollectedSeries | null = null;
  const perArray = [];
  for (const a of arrays) {
    const gamma = a.gamma_pdc ?? request.gammaPdc;
    if (gamma === undefined || !Number.isFinite(gamma)) throw new Error(`gamma_unknown: array ${a.name} has no pvwatts module product with gamma_pdc, and the request gives no gammaPdc`);
    checkedGamma(gamma);
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
    perArray.push({ array: a, gamma, gammaSource: a.gamma_pdc !== null ? 'module_product' : 'request', hours: hours.length, stats, modelled, anchoring, energy: anchoring ? scaled(energy, anchoring.factor) : energy });
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

  const target: SeriesTarget = {
    organisationId: system.organisation_id,
    objectId: request.pvSystemId,
    sourceCode: weather.source_code,
    kind: 'simulated',
    name: months ? `typical year ${years.from}-${years.to}` : null,
  };
  const stored = await storeSeries(db, target, { quantity_code: 'production_energy', value_kind: 'interval', step: '1 hour', values: rounded(energy) });
  if (siteTemperature) await storeSeries(db, { ...target, objectId: system.site_id }, { ...siteTemperature, values: rounded(temperature) });

  const annualKwh = round(annual);
  const modelledTotal = perArray.reduce((s, x) => s + x.modelled, 0);
  const anchoredTotal = perArray.reduce((s, x) => s + (x.anchoring?.annual_kwh ?? 0), 0);
  const runId = await recordRun(
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
    { series_id: stored.seriesId, annual_kwh: annualKwh, kwh_per_kwp: round(annualKwh / kwp), kwp, typical_months: months, years_covered: yearsCovered },
  );
  return { runId, seriesId: stored.seriesId, annualKwh, kwhPerKwp: round(annualKwh / kwp), kwp, radiationDb: WEATHER_MODEL.toUpperCase() };
}

async function recordRun(db: Db, engineVersion: string, subjectId: string, inputs: unknown, results: unknown): Promise<string> {
  const run = await db.query<{ id: string }>(`select record_run('solar', $1, $2, null, $3::jsonb, $4::jsonb) id`, [engineVersion, subjectId, JSON.stringify(inputs), JSON.stringify(results)]);
  return run.rows[0].id;
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
