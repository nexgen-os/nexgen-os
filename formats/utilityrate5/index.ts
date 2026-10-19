// The energy rates of SAM's `utilityrate5` ⇄ price intervals.
//
// SAM (System Advisor Model) and PySAM compute the bill of a site with the
// compute module `utilityrate5`, from a flat table of named inputs; the US
// Utility Rate Database publishes its tariffs in the same shape. Two of its
// ways of saying what a kWh costs are written and read here:
//
// - a schedule: a period number for each month and each hour of the day,
//   one 12 × 24 matrix for weekdays and one for weekends
//   (`ur_ec_sched_weekday`, `ur_ec_sched_weekend`), and for each period its
//   buy and sell rate (`ur_ec_tou_mat`);
// - a time series: one buy rate and one sell rate for each step of the year
//   (`ur_en_ts_buy_rate` / `ur_ts_buy_rate`, `ur_en_ts_sell_rate` /
//   `ur_ts_sell_rate`).
//
// A price interval is a fixed price on an interval of time, start included,
// end excluded, in the shape of a row of `contracts.price_signals`; a row
// passes as it is. SAM's year runs in local standard time, without summer
// time, on 8760 hours: the caller gives the year and the UTC offset of the
// place's standard time, never guessed, and on a leap year 29 February is
// left out. Rates are per kWh, as the format defines them; the format holds
// no currency, so the writer returns it and the reader is told it.
//
// Nothing here reads a database or computes a price: an indexed price, a cap
// or a floor is resolved by a run before it is written.

/** The units of energy a price is quoted per, and their kWh. */
export const PRICE_UNITS = { 'KiloW-HR': 1, 'MegaW-HR': 1000 } as const;

/** A fixed price on an interval: start included, end excluded, no end until further notice. */
export interface PriceInterval {
  /** `contracts.price_signals.kind`; when given, only `fixed` is written. */
  kind?: string;
  starts_at: string;
  ends_at: string | null;
  price: number;
  /** ISO 4217. */
  currency: string;
  per_unit: keyof typeof PRICE_UNITS;
}

/** The year SAM runs on, in the place's local standard time. */
export interface Year {
  year: number;
  /** The offset of local standard time from UTC, in hours (1 for Brussels and Paris, -5 for New York). */
  utc_offset_hours: number;
}

export interface WriteOptions extends Year {
  /** What a kWh taken from the grid costs. */
  buy: PriceInterval[];
  /** What a kWh given to the grid earns; none given, the sell rate is 0. */
  sell?: PriceInterval[];
}

/** The rates as a schedule, ready for `UtilityRate5.ElectricityRates`. */
export interface Schedule {
  /** One row per period: period, tier, max usage, max usage unit (0 = kWh), buy rate, sell rate. */
  ur_ec_tou_mat: number[][];
  /** 12 months × 24 hours of the day, the period in force. */
  ur_ec_sched_weekday: number[][];
  ur_ec_sched_weekend: number[][];
  ur_en_ts_buy_rate: 0;
  ur_en_ts_sell_rate: 0;
}

/** The rates as a time series, ready for `UtilityRate5.ElectricityRates`. */
export interface TimeSeries {
  ur_en_ts_buy_rate: 1;
  /** One rate per step, 8760 × steps per hour. */
  ur_ts_buy_rate: number[];
  ur_en_ts_sell_rate: 0 | 1;
  ur_ts_sell_rate: number[];
}

export interface Written<T> {
  rates: T;
  /** The currency of every rate, which the format does not hold. */
  currency: string;
}

export interface ReadOptions extends Year {
  /** The currency the rates are in (ISO 4217). */
  currency: string;
}

export interface Read {
  buy: PriceInterval[];
  sell: PriceInterval[];
}

/** SAM's value for a tier without a limit. */
export const NO_LIMIT = 1e38;
const HOUR_MS = 3_600_000;
const HOURS_IN_YEAR = 8760;
const MAX_PERIODS = 12;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------------------------------------------------------------------------
// The year
// ---------------------------------------------------------------------------

/** One step of SAM's year: its instant in UTC and its local standard clock. */
interface Step {
  at: number;
  month: number;
  hour: number;
  weekend: boolean;
}

function checkYear({ year, utc_offset_hours }: Year): void {
  if (!Number.isInteger(year)) throw new Error(`utilityrate5_year_required: ${year} is not a year`);
  if (!Number.isFinite(utc_offset_hours) || Math.abs(utc_offset_hours) > 14) {
    throw new Error(`utilityrate5_utc_offset_required: ${utc_offset_hours} is not an offset from UTC in hours`);
  }
}

/** The steps of SAM's year: 8760 hours of local standard time, 29 February left out. */
function stepsOf(y: Year, perHour: number): Step[] {
  checkYear(y);
  const offset = y.utc_offset_hours * HOUR_MS;
  const stepMs = HOUR_MS / perHour;
  const steps: Step[] = [];
  for (let local = Date.UTC(y.year, 0, 1); local < Date.UTC(y.year + 1, 0, 1); local += stepMs) {
    const d = new Date(local);
    if (d.getUTCMonth() === 1 && d.getUTCDate() === 29) continue;
    const day = d.getUTCDay();
    steps.push({ at: local - offset, month: d.getUTCMonth(), hour: d.getUTCHours(), weekend: day === 0 || day === 6 });
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Price intervals
// ---------------------------------------------------------------------------

interface Span {
  from: number;
  to: number;
  /** Per kWh. */
  rate: number;
}

function instant(s: string, what: string): number {
  const t = Date.parse(s);
  if (!Number.isFinite(t)) throw new Error(`utilityrate5_price_unreadable: ${what} ${s} is not an instant`);
  return t;
}

/** The intervals as spans per kWh, in order, with their one currency. */
function spansOf(prices: PriceInterval[], side: string): { spans: Span[]; currency: string | null } {
  const currencies = new Set<string>();
  const spans = prices.map((p) => {
    if (p.kind !== undefined && p.kind !== 'fixed') {
      throw new Error(`utilityrate5_price_not_fixed: a ${p.kind} ${side} price from ${p.starts_at}; resolve it to a fixed price in a run first`);
    }
    if (!(p.per_unit in PRICE_UNITS)) throw new Error(`utilityrate5_price_unreadable: unit ${p.per_unit} from ${p.starts_at}`);
    if (typeof p.price !== 'number' || !Number.isFinite(p.price)) throw new Error(`utilityrate5_price_unreadable: no ${side} price from ${p.starts_at}`);
    currencies.add(p.currency);
    const from = instant(p.starts_at, 'start');
    const to = p.ends_at === null ? Infinity : instant(p.ends_at, 'end');
    if (to <= from) throw new Error(`utilityrate5_price_unreadable: the ${side} price from ${p.starts_at} ends before it starts`);
    return { from, to, rate: p.price / PRICE_UNITS[p.per_unit] };
  });
  if (currencies.size > 1) throw new Error(`utilityrate5_mixed_currencies: ${side} prices in ${[...currencies].sort().join(', ')}`);
  spans.sort((a, b) => a.from - b.from);
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].from < spans[i - 1].to) {
      throw new Error(`utilityrate5_prices_overlap: two ${side} prices at ${new Date(spans[i].from).toISOString()}`);
    }
  }
  return { spans, currency: [...currencies][0] ?? null };
}

/** The rate of each step, the spans read once in order; a price that changes inside a step is refused. */
function ratesAt(steps: Step[], stepMs: number, spans: Span[], side: string): number[] {
  const first = steps[0].at;
  const end = steps[steps.length - 1].at + stepMs;
  for (const s of spans) {
    for (const edge of [s.from, s.to]) {
      if (edge > first && edge < end && (edge - first) % stepMs !== 0) {
        throw new Error(`utilityrate5_price_misaligned: a ${side} price changes at ${new Date(edge).toISOString()}, inside a step of ${stepMs / 60_000} minutes`);
      }
    }
  }
  let i = 0;
  return steps.map((step) => {
    while (i < spans.length && spans[i].to <= step.at) i++;
    const s = spans[i];
    if (!s || s.from > step.at) throw new Error(`utilityrate5_price_missing: no ${side} price at ${new Date(step.at).toISOString()}`);
    return s.rate;
  });
}

function currencyOf(buy: string | null, sell: string | null): string {
  if (buy === null) throw new Error('utilityrate5_price_missing: no buy price');
  if (sell !== null && sell !== buy) throw new Error(`utilityrate5_mixed_currencies: buy prices in ${buy}, sell prices in ${sell}`);
  return buy;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * The prices as a schedule: each period a pair of buy and sell rates,
 * numbered in the order they first appear (weekdays, January, midnight
 * first). Refused when an hour of a month does not hold one price on every
 * weekday (or every weekend day) of the month, or when the year needs more
 * than twelve periods: the time series says it then.
 */
export function writeSchedule(options: WriteOptions): Written<Schedule> {
  const steps = stepsOf(options, 1);
  const buy = spansOf(options.buy, 'buy');
  const sell = spansOf(options.sell ?? [], 'sell');
  const currency = currencyOf(buy.currency, options.sell ? sell.currency : null);
  const buyRates = ratesAt(steps, HOUR_MS, buy.spans, 'buy');
  const sellRates = options.sell ? ratesAt(steps, HOUR_MS, sell.spans, 'sell') : steps.map(() => 0);

  // The pair of rates each cell holds, and the first instant that set it.
  const cells = new Map<string, { buy: number; sell: number; at: number }>();
  steps.forEach((step, i) => {
    const key = `${step.weekend ? 'weekend' : 'weekday'} ${MONTHS[step.month]} hour ${step.hour}`;
    const seen = cells.get(key);
    if (!seen) cells.set(key, { buy: buyRates[i], sell: sellRates[i], at: step.at });
    else if (seen.buy !== buyRates[i] || seen.sell !== sellRates[i]) {
      throw new Error(
        `utilityrate5_not_a_schedule: ${key} holds ${seen.buy}/${seen.sell} on ${new Date(seen.at).toISOString()} ` +
          `and ${buyRates[i]}/${sellRates[i]} on ${new Date(step.at).toISOString()}; write it as a time series`,
      );
    }
  });

  const periods: { buy: number; sell: number }[] = [];
  const periodOf = (cell: { buy: number; sell: number }): number => {
    let p = periods.findIndex((q) => q.buy === cell.buy && q.sell === cell.sell);
    if (p < 0) {
      periods.push({ buy: cell.buy, sell: cell.sell });
      p = periods.length - 1;
      if (periods.length > MAX_PERIODS) throw new Error(`utilityrate5_too_many_periods: more than ${MAX_PERIODS} pairs of rates; write it as a time series`);
    }
    return p + 1;
  };
  const matrix = (kind: string) =>
    MONTHS.map((month) => Array.from({ length: 24 }, (_, hour) => periodOf(cells.get(`${kind} ${month} hour ${hour}`)!)));
  const weekday = matrix('weekday');
  const weekend = matrix('weekend');

  return {
    currency,
    rates: {
      ur_ec_tou_mat: periods.map((p, i) => [i + 1, 1, NO_LIMIT, 0, p.buy, p.sell]),
      ur_ec_sched_weekday: weekday,
      ur_ec_sched_weekend: weekend,
      ur_en_ts_buy_rate: 0,
      ur_en_ts_sell_rate: 0,
    },
  };
}

/** The prices as one buy rate (and one sell rate when given) for each step of SAM's year. */
export function writeTimeSeries(options: WriteOptions & { steps_per_hour?: number }): Written<TimeSeries> {
  const perHour = options.steps_per_hour ?? 1;
  if (!Number.isInteger(perHour) || perHour < 1 || 60 % perHour !== 0) {
    throw new Error(`utilityrate5_step_unsupported: ${perHour} steps per hour; SAM takes a whole number of minutes per step`);
  }
  const steps = stepsOf(options, perHour);
  const stepMs = HOUR_MS / perHour;
  const buy = spansOf(options.buy, 'buy');
  const sell = spansOf(options.sell ?? [], 'sell');
  const currency = currencyOf(buy.currency, options.sell ? sell.currency : null);
  return {
    currency,
    rates: {
      ur_en_ts_buy_rate: 1,
      ur_ts_buy_rate: ratesAt(steps, stepMs, buy.spans, 'buy'),
      ur_en_ts_sell_rate: options.sell ? 1 : 0,
      ur_ts_sell_rate: options.sell ? ratesAt(steps, stepMs, sell.spans, 'sell') : [],
    },
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Consecutive steps at one rate as one interval per kWh; the last one ends with the year. */
function intervalsOf(steps: Step[], stepMs: number, rates: number[], currency: string): PriceInterval[] {
  const out: PriceInterval[] = [];
  let start = 0;
  for (let i = 1; i <= steps.length; i++) {
    const contiguous = i < steps.length && steps[i].at === steps[i - 1].at + stepMs;
    if (i < steps.length && contiguous && rates[i] === rates[start]) continue;
    out.push({
      kind: 'fixed',
      starts_at: new Date(steps[start].at).toISOString(),
      ends_at: new Date(steps[i - 1].at + stepMs).toISOString(),
      price: rates[start],
      currency,
      per_unit: 'KiloW-HR',
    });
    start = i;
  }
  return out;
}

function checkCurrency(currency: string): void {
  if (!/^[A-Z]{3}$/.test(currency ?? '')) throw new Error(`utilityrate5_currency_required: ${currency} is not an ISO 4217 code`);
}

function matrixOf(value: unknown, name: string): number[][] {
  const ok =
    Array.isArray(value) &&
    value.length === 12 &&
    value.every((row) => Array.isArray(row) && row.length === 24 && row.every((p) => Number.isInteger(p)));
  if (!ok) throw new Error(`utilityrate5_unreadable: ${name} is not 12 rows of 24 period numbers`);
  return value as number[][];
}

/** A schedule read back as the buy and sell prices of each hour of the year, consecutive hours at one price merged. */
export function readSchedule(rates: Pick<Schedule, 'ur_ec_tou_mat' | 'ur_ec_sched_weekday' | 'ur_ec_sched_weekend'>, options: ReadOptions): Read {
  checkCurrency(options.currency);
  const weekday = matrixOf(rates.ur_ec_sched_weekday, 'ur_ec_sched_weekday');
  const weekend = matrixOf(rates.ur_ec_sched_weekend, 'ur_ec_sched_weekend');
  if (!Array.isArray(rates.ur_ec_tou_mat) || rates.ur_ec_tou_mat.some((r) => !Array.isArray(r) || r.length < 6)) {
    throw new Error('utilityrate5_unreadable: ur_ec_tou_mat is not rows of period, tier, max usage, unit, buy rate, sell rate');
  }
  const periods = new Map<number, { buy: number; sell: number }>();
  for (const [period, tier, , , buy, sell] of rates.ur_ec_tou_mat) {
    if (periods.has(period) || tier !== 1) {
      throw new Error(`utilityrate5_tiered_rate_unsupported: period ${period} has more than one tier; a price interval has none`);
    }
    periods.set(period, { buy, sell });
  }
  const steps = stepsOf(options, 1);
  const cellOf = steps.map((s) => {
    const period = (s.weekend ? weekend : weekday)[s.month][s.hour];
    const p = periods.get(period);
    if (!p) throw new Error(`utilityrate5_period_unknown: period ${period} (${MONTHS[s.month]}, hour ${s.hour}) has no rates in ur_ec_tou_mat`);
    return p;
  });
  return {
    buy: intervalsOf(steps, HOUR_MS, cellOf.map((p) => p.buy), options.currency),
    sell: intervalsOf(steps, HOUR_MS, cellOf.map((p) => p.sell), options.currency),
  };
}

/** A time series read back as price intervals; the steps per hour follow from its length. */
export function readTimeSeries(rates: Partial<TimeSeries> & Pick<TimeSeries, 'ur_ts_buy_rate'>, options: ReadOptions): Read {
  checkCurrency(options.currency);
  const series = (values: unknown, name: string): number[] => {
    if (!Array.isArray(values) || values.length === 0 || values.length % HOURS_IN_YEAR !== 0 || !values.every((v) => Number.isFinite(v))) {
      throw new Error(`utilityrate5_unreadable: ${name} is not ${HOURS_IN_YEAR} rates, or a multiple of it`);
    }
    return values as number[];
  };
  const buy = series(rates.ur_ts_buy_rate, 'ur_ts_buy_rate');
  const perHour = buy.length / HOURS_IN_YEAR;
  const steps = stepsOf(options, perHour);
  const stepMs = HOUR_MS / perHour;
  const withSell = rates.ur_en_ts_sell_rate === 1;
  const sell = withSell ? series(rates.ur_ts_sell_rate, 'ur_ts_sell_rate') : [];
  if (withSell && sell.length !== buy.length) throw new Error('utilityrate5_unreadable: ur_ts_sell_rate and ur_ts_buy_rate differ in length');
  return {
    buy: intervalsOf(steps, stepMs, buy, options.currency),
    sell: withSell ? intervalsOf(steps, stepMs, sell, options.currency) : [],
  };
}
