// The `pvwatts` yield profile: the physics, as pure functions.
//
// From hourly plane-of-array irradiance, air temperature and wind speed to
// the energy of an array, hour by hour, then to a typical year:
//
//   1. align   the irradiance of an hour (an interval mean) with the
//              temperature and the wind over that hour (instants);
//   2. clean   irradiance below zero or missing to 0, above a physical bound
//              to the bound; temperature and wind gaps filled with the last
//              value read;
//   3. convert Faiman cell temperature, Tcell = Tair + G / (U0 + U1 · v),
//              then the PVWatts DC model, E = G/1000 × [1 + γ (Tcell − 25)],
//              then the profile's losses, in their order;
//   4. a typical year, month by month: for each calendar month, the real
//              month whose daily energies are distributed most like those
//              of every year (Finkelstein-Schafer), so that the year keeps
//              the alternation of sunny and overcast days an hour-by-hour
//              mean of several years would smooth away; an hour the chosen
//              month lacks takes the multi-year mean of that hour; then
//              scaled so that its total equals the mean annual total over
//              the years used;
//   5. anchor  optionally, every hour multiplied by one factor so that the
//              annual equals a reference (PVGIS), the hourly shape kept.
//
// Conventions: every value is dated at the start of its hour, in UTC. Days,
// months and years are the site's: they are cut in the local standard time
// of its time zone (no daylight-saving shift, as in TMY files), so that a
// sunlit day is never split by UTC midnight. A typical year is laid on a
// 365-day grid (8,760 hours), 29 February left out. Nothing here reads a
// database or the network.

import type { SeriesPoint } from '../../connectors/index.js';

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
export const HOURS_PER_YEAR = 8760;
const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** First hour of each month on the 365-day grid. */
const MONTH_START = DAYS_PER_MONTH.reduce<number[]>((acc, d, m) => [...acc, acc[m] + d * 24], [0]);

/**
 * Upper bound of an hourly mean of plane-of-array irradiance, W/m². The sun
 * gives 1,361 W/m² above the atmosphere; cloud edges and ground reflection
 * push a few minutes above it, never an hourly mean much beyond. A value
 * above the bound is an error of the source.
 */
export const POA_MAX_W_M2 = 1400;

/** Standard test conditions: the cell temperature the power of a module is rated at, °C. */
const T_REF_C = 25;

/**
 * Bounds of the temperature coefficient of power, 1/°C. Crystalline modules
 * lie near −0.003 to −0.005, thin films near −0.002; a positive value is a
 * sign error and would raise the yield on hot hours.
 */
export const GAMMA_PDC_MIN = -0.01;
export const GAMMA_PDC_MAX = 0;

// ---------------------------------------------------------------------------
// 1. Align
// ---------------------------------------------------------------------------

/** One hour of weather, dated at its start (UTC), as read: a value may be missing. */
export interface WeatherHour {
  at: string;
  /** Plane-of-array irradiance, W/m², mean over the hour. */
  poa: number | null;
  /** Air temperature over the hour, °C. */
  temperature: number | null;
  /** Wind speed over the hour, m/s. */
  wind: number | null;
}

/**
 * The hours of the irradiance series, each with the temperature and the
 * wind over it. Irradiance is an interval mean dated at the start of the
 * hour; temperature and wind are instants. The mean over the hour of a
 * quantity read at its start and its end is estimated as the mean of the
 * two readings, or the one present.
 */
export function alignWeather(poa: SeriesPoint[], temperature: SeriesPoint[], wind: SeriesPoint[]): WeatherHour[] {
  const overHour = (instants: SeriesPoint[]) => {
    const byTime = new Map(instants.map((p) => [Date.parse(p.at), p.value]));
    return (start: number): number | null => {
      const read = [byTime.get(start), byTime.get(start + HOUR_MS)].filter((v): v is number => v !== undefined && v !== null && Number.isFinite(v));
      return read.length === 0 ? null : read.reduce((a, b) => a + b, 0) / read.length;
    };
  };
  const t = overHour(temperature);
  const w = overHour(wind);
  return [...poa]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .map((p) => {
      const start = Date.parse(p.at);
      return { at: new Date(start).toISOString(), poa: p.value, temperature: t(start), wind: w(start) };
    });
}

// ---------------------------------------------------------------------------
// 2. Clean
// ---------------------------------------------------------------------------

export interface CleanHour {
  at: string;
  poa: number;
  temperature: number;
  wind: number;
}

export interface CleaningStats {
  /** Irradiance below zero (night-time noise of a model), set to 0. */
  negative_irradiance: number;
  /** Irradiance above `poa_max`, set to it. */
  capped_irradiance: number;
  /** Irradiance missing, set to 0. */
  missing_irradiance: number;
  /** Temperature or wind missing (or a negative wind speed), filled with the nearest earlier value. */
  filled_temperature: number;
  filled_wind: number;
}

const usable = (v: number | null): v is number => v !== null && Number.isFinite(v);

/**
 * Makes every hour computable. Irradiance: missing or negative → 0, above
 * `poaMax` → `poaMax`. Temperature and wind: a gap takes the last value read
 * before it; gaps at the very start take the first value read. A series with
 * no temperature or no wind at all throws a named error
 * (`weather_without_temperature`, `weather_without_wind`): a cell
 * temperature cannot be computed without them, and no value is invented.
 */
export function cleanWeather(hours: WeatherHour[], poaMax = POA_MAX_W_M2): { hours: CleanHour[]; stats: CleaningStats } {
  const stats: CleaningStats = { negative_irradiance: 0, capped_irradiance: 0, missing_irradiance: 0, filled_temperature: 0, filled_wind: 0 };
  if (hours.length === 0) return { hours: [], stats };
  let lastTemperature = hours.map((h) => h.temperature).find(usable);
  let lastWind = hours.map((h) => h.wind).find((v) => usable(v) && v >= 0);
  if (lastTemperature === undefined) throw new Error('weather_without_temperature: no air temperature in the period');
  if (lastWind === undefined) throw new Error('weather_without_wind: no wind speed in the period');

  const clean = hours.map((h) => {
    let poa = h.poa;
    if (!usable(poa)) {
      poa = 0;
      stats.missing_irradiance++;
    } else if (poa < 0) {
      poa = 0;
      stats.negative_irradiance++;
    } else if (poa > poaMax) {
      poa = poaMax;
      stats.capped_irradiance++;
    }
    if (usable(h.temperature)) lastTemperature = h.temperature;
    else stats.filled_temperature++;
    if (usable(h.wind) && h.wind >= 0) lastWind = h.wind;
    else stats.filled_wind++;
    return { at: h.at, poa, temperature: lastTemperature!, wind: lastWind! };
  });
  return { hours: clean, stats };
}

// ---------------------------------------------------------------------------
// 3. Convert
// ---------------------------------------------------------------------------

/**
 * Faiman's module temperature (IEC 61853-2; pvlib `temperature.faiman`):
 * Tcell = Tair + G / (U0 + U1 · v), with U0 in W/(m²·K), U1 in W·s/(m³·K),
 * G in W/m², v in m/s at 10 m.
 */
export function faimanCellTemperature(poa: number, airTemperature: number, windSpeed: number, params: { u0: number; u1: number }): number {
  return airTemperature + poa / (params.u0 + params.u1 * windSpeed);
}

/**
 * The fraction of energy that remains after an ordered list of losses: each
 * percentage applies to what the previous ones left, so the factors
 * multiply (PVsyst's loss diagram, PVWatts's own combination of its loss
 * categories). A negative percentage is a gain. A loss without a value
 * throws a named error (`loss_without_value`): the profile leaves it to a
 * model this engine does not have, or to the run.
 */
export function remainingAfterLosses(losses: { code: string; pct: number | null }[]): number {
  return losses.reduce((factor, l) => {
    if (l.pct === null || l.pct === undefined || !Number.isFinite(Number(l.pct))) throw new Error(`loss_without_value: ${l.code}`);
    return factor * (1 - Number(l.pct) / 100);
  }, 1);
}

/**
 * γ as given, when it lies in [`GAMMA_PDC_MIN`, `GAMMA_PDC_MAX`]; otherwise
 * throws a named error (`gamma_out_of_range`).
 */
export function checkedGamma(gammaPdc: number): number {
  if (!(gammaPdc >= GAMMA_PDC_MIN && gammaPdc <= GAMMA_PDC_MAX)) {
    throw new Error(`gamma_out_of_range: ${gammaPdc}; gamma_pdc is in 1/°C, between ${GAMMA_PDC_MIN} and ${GAMMA_PDC_MAX} (a positive value is a sign error)`);
  }
  return gammaPdc;
}

/**
 * Energy of one hour per kWp of DC power, kWh: the PVWatts DC model
 * (pvlib `pvsystem.pvwatts_dc`), Pdc = G/1000 × Pdc0 × [1 + γ (Tcell − 25)],
 * over one hour, times the fraction that remains after the losses. Never
 * below zero. γ out of its bounds throws a named error (`gamma_out_of_range`).
 */
export function pvwattsEnergyPerKwp(poa: number, cellTemperature: number, gammaPdc: number, remainingFraction: number): number {
  checkedGamma(gammaPdc);
  if (poa <= 0) return 0;
  return Math.max(0, (poa / 1000) * (1 + gammaPdc * (cellTemperature - T_REF_C)) * remainingFraction);
}

/** The energy of an array, kWh per hour, dated at the start of each hour. */
export function arrayEnergy(
  hours: CleanHour[],
  array: { kwp: number; gammaPdc: number },
  model: { u0: number; u1: number; remainingFraction: number },
): SeriesPoint[] {
  checkedGamma(array.gammaPdc);
  return hours.map((h) => {
    const tCell = faimanCellTemperature(h.poa, h.temperature, h.wind, model);
    return { at: h.at, value: array.kwp * pvwattsEnergyPerKwp(h.poa, tCell, array.gammaPdc, model.remainingFraction) };
  });
}

// ---------------------------------------------------------------------------
// 4. Typical year
// ---------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();
const standardOffsets = new Map<string, number>();

/** Offset of a time zone from UTC at an instant, minutes east (Brussels in winter: 60). */
function offsetAt(timeZone: string, ms: number): number {
  let format = formatters.get(timeZone);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
    } catch {
      throw new Error(`time_zone_unknown: ${timeZone} is not an IANA time zone`);
    }
    formatters.set(timeZone, format);
  }
  const name = format.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name);
  if (!m) throw new Error(`time_zone_unknown: ${timeZone} gives the offset ${name}`);
  return m[1] ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/**
 * The standard offset of a time zone in a year, minutes east of UTC: the
 * smaller of its offsets on 1 January and 1 July, daylight-saving time being
 * ahead of standard time in either hemisphere. Throws a named error
 * (`time_zone_required`) without a time zone, (`time_zone_unknown`) for a
 * name that is not an IANA time zone.
 */
export function standardOffsetMinutes(timeZone: string, year: number): number {
  if (!timeZone) throw new Error('time_zone_required: days and months of a yield are cut in the site\'s time zone');
  const key = `${timeZone}|${year}`;
  let offset = standardOffsets.get(key);
  if (offset === undefined) {
    offset = Math.min(offsetAt(timeZone, Date.UTC(year, 0, 1)), offsetAt(timeZone, Date.UTC(year, 6, 1)));
    standardOffsets.set(key, offset);
  }
  return offset;
}

/** The local standard clock of an instant: a Date whose UTC fields read it. */
function localStandard(at: string, timeZone: string): Date {
  const ms = Date.parse(at);
  return new Date(ms + standardOffsetMinutes(timeZone, new Date(ms).getUTCFullYear()) * MINUTE_MS);
}

/**
 * The local standard year of an instant, and its hour on the 365-day grid,
 * 0 to 8759; the hour is null on 29 February.
 */
export function hourOfYear(at: string, timeZone: string): { year: number; hour: number | null } {
  const d = localStandard(at, timeZone);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  if (month === 1 && day === 29) return { year, hour: null };
  return { year, hour: MONTH_START[month] + (day - 1) * 24 + d.getUTCHours() };
}

/** The instant, UTC, of hour `hour` of the 365-day grid laid on the local standard calendar of `calendarYear`. */
export function instantOfGridHour(calendarYear: number, hour: number, timeZone: string): string {
  let month = 11;
  while (MONTH_START[month] > hour) month--;
  const i = hour - MONTH_START[month];
  const local = Date.UTC(calendarYear, month, 1 + Math.floor(i / 24), i % 24);
  return new Date(local - standardOffsetMinutes(timeZone, calendarYear) * MINUTE_MS).toISOString();
}

/** The points whose local standard year lies in `years`, both included. */
export function withinLocalYears(points: SeriesPoint[], timeZone: string, years: { from: number; to: number }): SeriesPoint[] {
  return points.filter((p) => {
    const { year } = hourOfYear(p.at, timeZone);
    return year >= years.from && year <= years.to;
  });
}

/** Hourly values per year on the 365-day grid; NaN where a year has no value. */
export interface YearGrid {
  years: Map<number, Float64Array>;
  /** Values of 29 February, left out of the grid. */
  leapHoursLeftOut: number;
}

/** Points laid on the 365-day grid of their local standard year. */
export function toYearGrid(points: SeriesPoint[], timeZone: string): YearGrid {
  // Checks the time zone even when there is no point.
  standardOffsetMinutes(timeZone, 2000);
  const years = new Map<number, Float64Array>();
  let leapHoursLeftOut = 0;
  for (const p of points) {
    const { year, hour: k } = hourOfYear(p.at, timeZone);
    if (k === null) {
      leapHoursLeftOut++;
      continue;
    }
    let grid = years.get(year);
    if (!grid) years.set(year, (grid = new Float64Array(HOURS_PER_YEAR).fill(NaN)));
    grid[k] = p.value;
  }
  return { years, leapHoursLeftOut };
}

/** Mean, across the years that have it, of each hour of the grid; NaN where no year has it. */
export function hourlyMean(grid: YearGrid): Float64Array {
  const mean = new Float64Array(HOURS_PER_YEAR);
  for (let k = 0; k < HOURS_PER_YEAR; k++) {
    let sum = 0;
    let n = 0;
    for (const values of grid.years.values()) {
      if (!Number.isNaN(values[k])) {
        sum += values[k];
        n++;
      }
    }
    mean[k] = n > 0 ? sum / n : NaN;
  }
  return mean;
}

/** The mean annual total over the years used: the sum, over the hours of the grid, of their mean across years. */
export function multiYearMeanAnnual(grid: YearGrid): number {
  return hourlyMean(grid).reduce((s, v) => (Number.isNaN(v) ? s : s + v), 0);
}

/** Share of `sorted` at or below `x`. */
function cdf(sorted: number[], x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}

/**
 * The Finkelstein-Schafer statistic of a candidate month against the
 * long-term distribution: the mean, over the long-term values, of the
 * absolute gap between the two cumulative distributions. 0 when they are
 * the same. Sandia's typical-year method (TMY, 1978) evaluates it at the
 * candidate's own values and weighs nine daily indices; this evaluates it
 * at every long-term value and reads one index, the daily energy, which is
 * what a yield is made of.
 */
export function finkelsteinSchafer(candidate: number[], longTerm: number[]): number {
  if (candidate.length === 0 || longTerm.length === 0) throw new Error('finkelstein_schafer_needs_values');
  const c = [...candidate].sort((a, b) => a - b);
  const l = [...longTerm].sort((a, b) => a - b);
  return l.reduce((acc, x) => acc + Math.abs(cdf(c, x) - cdf(l, x)), 0) / l.length;
}

/** Daily totals (local days) of one month of one year, from the hours present; null when the year lacks more than `1 − minCoverage` of the month's hours. */
function monthDays(values: Float64Array, month: number, minCoverage: number): number[] | null {
  const days = new Array<number>(DAYS_PER_MONTH[month]).fill(0);
  let covered = 0;
  for (let i = 0; i < DAYS_PER_MONTH[month] * 24; i++) {
    const v = values[MONTH_START[month] + i];
    if (!Number.isNaN(v)) {
      covered++;
      days[Math.floor(i / 24)] += v;
    }
  }
  return covered >= minCoverage * DAYS_PER_MONTH[month] * 24 ? days : null;
}

/**
 * For each calendar month, the year whose daily energies are distributed
 * most like the daily energies of that month in every candidate year
 * (smallest Finkelstein-Schafer statistic). A year is a candidate for a
 * month when it has at least `minCoverage` of the month's hours. On a tie,
 * the most recent year. Null for a month no year covers.
 */
export function selectTypicalMonths(grid: YearGrid, minCoverage = 0.95): (number | null)[] {
  return DAYS_PER_MONTH.map((_, month) => {
    const candidates = [...grid.years.entries()]
      .map(([year, values]) => ({ year, days: monthDays(values, month, minCoverage) }))
      .filter((c): c is { year: number; days: number[] } => c.days !== null)
      .sort((a, b) => b.year - a.year);
    if (candidates.length === 0) return null;
    const longTerm = candidates.flatMap((c) => c.days);
    let best: number | null = null;
    let bestScore = Infinity;
    for (const c of candidates) {
      const score = finkelsteinSchafer(c.days, longTerm);
      if (score < bestScore - 1e-12) {
        bestScore = score;
        best = c.year;
      }
    }
    return best;
  });
}

/**
 * The typical year laid on the local standard calendar of `calendarYear`,
 * 8,760 values: each month taken from the year chosen for it, or the mean
 * across years for a month none was chosen for. An hour the chosen month
 * lacks takes the multi-year mean of that hour (`fromMean` counts them). An
 * hour no year has throws a named error (`period_not_covered`): no value is
 * invented. In a leap `calendarYear`, 29 February has no value.
 */
export function typicalYear(grid: YearGrid, months: (number | null)[], calendarYear: number, timeZone: string): { points: SeriesPoint[]; fromMean: number } {
  const mean = hourlyMean(grid);
  const points: SeriesPoint[] = [];
  let fromMean = 0;
  for (let month = 0; month < 12; month++) {
    const chosen = months[month] === null ? undefined : grid.years.get(months[month]!);
    for (let k = MONTH_START[month]; k < MONTH_START[month + 1]; k++) {
      let v = chosen ? chosen[k] : NaN;
      if (Number.isNaN(v)) {
        v = mean[k];
        fromMean++;
      }
      if (Number.isNaN(v)) throw new Error(`period_not_covered: no year has the hour ${instantOfGridHour(calendarYear, k, timeZone)} of the typical year`);
      points.push({ at: instantOfGridHour(calendarYear, k, timeZone), value: v });
    }
  }
  return { points, fromMean };
}

/**
 * The mean annual total over the years a series covers, real years as they
 * are (29 February included): a year counts when at least `minCoverage` of
 * its hours (8,760 or 8,784, local standard time) have a value. Throws a
 * named error (`period_not_covered`) when no year of `years` does.
 */
export function meanAnnualOverCoveredYears(
  points: SeriesPoint[],
  timeZone: string,
  years: { from: number; to: number },
  minCoverage = 0.95,
): { annual: number; yearsCovered: number[] } {
  const totals = annualTotals(points, timeZone, years, minCoverage);
  if (totals.length === 0) {
    throw new Error(`period_not_covered: no year from ${years.from} to ${years.to} has ${minCoverage * 100} % of its hours`);
  }
  return { annual: totals.reduce((s, t) => s + t.total, 0) / totals.length, yearsCovered: totals.map((t) => t.year) };
}

/**
 * The total of each year of `years` (local standard time) that has at least
 * `minCoverage` of its hours, in order; the others are left out.
 */
export function annualTotals(
  points: SeriesPoint[],
  timeZone: string,
  years: { from: number; to: number },
  minCoverage = 0.95,
): { year: number; total: number }[] {
  const byYear = new Map<number, { hours: number; sum: number }>();
  for (const p of points) {
    const { year } = hourOfYear(p.at, timeZone);
    const y = byYear.get(year) ?? { hours: 0, sum: 0 };
    y.hours++;
    y.sum += p.value;
    byYear.set(year, y);
  }
  const out: { year: number; total: number }[] = [];
  for (let year = years.from; year <= years.to; year++) {
    const hoursInYear = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / HOUR_MS;
    const y = byYear.get(year);
    if (y && y.hours >= minCoverage * hoursInYear) out.push({ year, total: y.sum });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4b, 5. Rescale and anchor
// ---------------------------------------------------------------------------

/** Every value times `factor`. */
export function scaled(points: SeriesPoint[], factor: number): SeriesPoint[] {
  return points.map((p) => ({ at: p.at, value: p.value * factor }));
}

export function total(points: SeriesPoint[]): number {
  return points.reduce((s, p) => s + p.value, 0);
}

/**
 * The factor that brings a typical year's total to the mean annual total
 * over the years it was chosen from: a typical month is a real month, and twelve of
 * them do not add up to the mean. 1 when the typical year is empty.
 */
export function rescaleFactor(meanAnnual: number, typicalTotal: number): number {
  return typicalTotal > 0 ? meanAnnual / typicalTotal : 1;
}

/**
 * The factor that anchors a modelled annual on a reference annual (PVGIS's
 * satellite-based yield for the same array): applied to every hour, it
 * keeps the hourly shape of the input weather and takes the annual of the
 * reference. Throws a named error (`anchoring_impossible`) when the model
 * gives nothing to anchor.
 */
export function anchoringFactor(referenceAnnual: number, modelledAnnual: number): number {
  if (!(modelledAnnual > 0)) throw new Error('anchoring_impossible: the modelled annual is zero');
  if (!(referenceAnnual >= 0)) throw new Error('anchoring_impossible: the reference annual is not a number');
  return referenceAnnual / modelledAnnual;
}
