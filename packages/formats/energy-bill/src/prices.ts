// What the lines of a bill add up to: volumes counted once, one price per
// band and season, the price in force at the end, network delivery, taxes and
// contributions.
//
// The rules, each read on figures and dates, never on a label, a supplier or a
// country:
//
//  - lines of one band on CONSECUTIVE sub-periods are a price revision: one
//    price, weighted by the volumes billed at each;
//  - lines of one band that bill the SAME kWh (overlapping periods, or the
//    same volume when undated) are COMPONENTS of its price (energy, capacity,
//    certificates…): their prices add up, and their kWh count once;
//  - a line that bills every hour next to banded lines is a component of every
//    band when it bills the kWh they add up to, a flat price of its own
//    otherwise;
//  - a revised price leaves two figures: what the kWh of the bill cost (the
//    weighted price) and the price in force at its end (the latest dated one);
//    a fixed price revised on a date projects the latest, any other the weighted;
//  - a season exists only where the bill names it, and only as a whole grid:
//    a season that names some bands and not the others is read as no season;
//  - a line with a negative amount takes back what an earlier bill billed: it
//    is no price, no volume and no period of this one.

import type { Remark } from './types.js';

/** A line, brought to energy: kWh and a price per kWh in the invoice's currency. */
export interface Billed {
  id: string;
  label: string | null;
  band: string | null;
  season: string | null;
  start: string | null;
  end: string | null;
  kwh: number | null;
  price: number | null;
  amount: number | null;
}

export type Report = (code: string, message: string, kind?: Remark['kind'], line?: string) => void;

export const round = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const normalizeLabel = (label: string): string =>
  label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Distinct labels, in the order they appear on the bill. */
export function distinctLabels(entries: ReadonlyArray<{ label: string | null }>): string | null {
  const seen = new Map<string, string>();
  for (const entry of entries) {
    if (entry.label && !seen.has(normalizeLabel(entry.label))) seen.set(normalizeLabel(entry.label), entry.label);
  }
  return seen.size > 0 ? [...seen.values()].join(' + ') : null;
}

// ── Weighting ────────────────────────────────────────────────────────────────

/**
 * One price over several lines: weighted by their volumes; identical prices
 * need no volume; different prices without volumes fall back to their plain
 * mean, `weighted: false` so that the caller says so.
 */
export function weightedMean(lines: ReadonlyArray<{ kwh: number | null; price: number | null }>): { price: number | null; weighted: boolean } {
  const priced = lines.filter((line): line is { kwh: number | null; price: number } => line.price !== null);
  if (priced.length === 0) return { price: null, weighted: true };
  const total = priced.reduce((sum, line) => sum + (line.kwh ?? 0), 0);
  if (priced.every((line) => line.kwh !== null && line.kwh >= 0) && total > 0) {
    return { price: priced.reduce((sum, line) => sum + (line.kwh as number) * line.price, 0) / total, weighted: true };
  }
  if (priced.every((line) => line.price === priced[0]!.price)) return { price: priced[0]!.price, weighted: true };
  return { price: priced.reduce((sum, line) => sum + line.price, 0) / priced.length, weighted: false };
}

// ── Lines that bill the same kWh ─────────────────────────────────────────────

type Dated = Pick<Billed, 'season' | 'start' | 'end' | 'kwh'>;

/** Two lines that bill the same kWh print the same volume, to the rounding of a meter read. */
const SAME_KWH = 1;
const SAME_KWH_RATIO = 0.005;
export const sameVolume = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(SAME_KWH, Math.max(a, b) * SAME_KWH_RATIO);

/** Do the periods of two lines overlap? Null when one is undated. Ends are inclusive days; a shared boundary day is no overlap. */
function periodsOverlap(a: Dated, b: Dated): boolean | null {
  if (!a.start || !a.end || !b.start || !b.end) return null;
  if (a.start === b.start && a.end === b.end) return true;
  return a.start < b.end && b.start < a.end;
}

/** Do two lines of one band bill the SAME kWh? Their periods say it; undated, their volumes; two named seasons never do. */
export function coverSameKwh(a: Dated, b: Dated): boolean {
  if (a.season && b.season && a.season !== b.season) return false;
  const overlap = periodsOverlap(a, b);
  if (overlap !== null) return overlap;
  return a.kwh !== null && b.kwh !== null && a.kwh > 0 && sameVolume(a.kwh, b.kwh);
}

function volumeOf(lines: ReadonlyArray<{ kwh: number | null }>): number | null {
  return lines.length > 0 && lines.every((line) => line.kwh !== null) ? lines.reduce((sum, line) => sum + (line.kwh as number), 0) : null;
}

/**
 * The lines of one band sorted into the COMPONENTS of its price: each a run
 * of lines that bill different kWh (one line, or the sub-periods of a
 * revision). Components cover the same kWh; when their volumes disagree, the
 * periods were misread and the lines are one component (`conflicting`). A
 * line of 0 kWh is left out when another bills something.
 */
export function componentsOf<T extends Dated>(billed: readonly T[]): { components: T[][]; conflicting: boolean } {
  const billing = billed.some((line) => (line.kwh ?? 0) > 0) ? billed.filter((line) => line.kwh !== 0) : [...billed];
  if (billing.length === 0) return { components: [], conflicting: false };
  const components: T[][] = [];
  for (const line of billing) {
    const home = components.find((component) => !component.some((placed) => coverSameKwh(placed, line)));
    if (home) home.push(line);
    else components.push([line]);
  }
  const volumes = components.map(volumeOf);
  const conflicting = components.length > 1 && volumes.every((v): v is number => v !== null) && volumes.some((v) => !sameVolume(v as number, volumes[0] as number));
  return conflicting ? { components: [billing], conflicting } : { components, conflicting };
}

/** What the sub-periods of one component say about its price over time. */
export interface PriceRevision {
  latest: number | null;
  since: string | null;
  changes: number | null;
}

const UNTOLD: PriceRevision = { latest: null, since: null, changes: null };

/**
 * The price a component ends on, read on the dates of its lines. Nothing is
 * guessed: undated lines, two prices from one date, or two seasons leave it
 * untold.
 */
export function priceRevision(lines: ReadonlyArray<Pick<Billed, 'season' | 'start' | 'price'>>): PriceRevision {
  const priced = lines.filter((line): line is Pick<Billed, 'season' | 'start'> & { price: number } => line.price !== null);
  if (priced.length === 0) return UNTOLD;
  if (priced.every((line) => line.price === priced[0]!.price)) return { latest: priced[0]!.price, since: null, changes: 0 };
  if (priced.some((line) => line.start === null || line.season !== priced[0]!.season)) return UNTOLD;
  const ordered = [...priced].sort((a, b) => (a.start as string).localeCompare(b.start as string));
  let since: string | null = null;
  let changes = 0;
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i]!.price === ordered[i - 1]!.price) continue;
    if (ordered[i]!.start === ordered[i - 1]!.start) return UNTOLD;
    since = ordered[i]!.start;
    changes += 1;
  }
  return { latest: ordered[ordered.length - 1]!.price, since, changes };
}

/** What a kWh costs on lines of one band: each component weighted (or at its latest), the components added up. Not rounded. */
function stackedPrice(billed: readonly Billed[], pick: 'weighted' | 'latest') {
  const { components, conflicting } = componentsOf(billed.filter((line) => line.price !== null));
  const revisions = components.map(priceRevision);
  let price: number | null = null;
  let weighted = true;
  let untold = false;
  components.forEach((component, i) => {
    if (pick === 'latest') {
      const latest = revisions[i]!.latest;
      if (latest === null) untold = true;
      else price = (price ?? 0) + latest;
      return;
    }
    const mean = weightedMean(component);
    if (mean.price === null) return;
    price = (price ?? 0) + mean.price;
    weighted = weighted && mean.weighted;
  });
  return { price: untold ? null : (price as number | null), weighted, conflicting, untold, revisions };
}

/** The kWh the lines of one band cover: a kWh billed by several components counts once. */
export function coveredKwh(billed: readonly Billed[]): number | null {
  const { components } = componentsOf(billed.filter((line) => line.kwh !== null));
  if (components.length === 0) return null;
  return round(Math.max(...components.map((component) => volumeOf(component) as number)), 3);
}

/**
 * The lines that bill every hour, next to banded lines: those billed on the
 * kWh of the banded lines are components of every band's price, the others
 * a flat price of their own. Without banded lines, every-hour is the band.
 */
export function allHoursLines(lines: readonly Billed[], report: Report = () => {}): { components: Billed[][]; flat: Billed[] } {
  const allHours = lines.filter((line) => line.band === null);
  const banded = lines.filter((line) => line.band !== null);
  if (banded.length === 0 || allHours.length === 0) return { components: [], flat: allHours };
  const bandedKwh = banded.every((line) => line.kwh !== null)
    ? bandsOf(banded).reduce((sum, band) => sum + (coveredKwh(banded.filter((line) => line.band === band)) ?? 0), 0)
    : null;
  const components: Billed[][] = [];
  const flat: Billed[] = [];
  for (const candidate of componentsOf(allHours).components) {
    const kwh = volumeOf(candidate);
    const overlaps = candidate.flatMap((line) => banded.map((other) => periodsOverlap(line, other)));
    const overlap = overlaps.some((o) => o === true) ? true : overlaps.some((o) => o === false) ? false : null;
    const described = distinctLabels(candidate) ?? 'no label';
    let isComponent: boolean;
    if (kwh !== null && bandedKwh !== null && bandedKwh > 0) {
      isComponent = sameVolume(kwh, bandedKwh);
      if (!isComponent && overlap === true) {
        report('all_hours_other_kwh', `Every-hour line(s) "${described}" are billed over the period of the banded lines but on ${kwh} kWh, not their ${bandedKwh} kWh: kept as a flat price of their own, to be checked.`);
      }
    } else if (overlap !== null) {
      isComponent = overlap;
    } else {
      isComponent = false;
      report('all_hours_undecided', `Every-hour line(s) "${described}" are billed next to banded lines, and neither their period nor their volume says whether they bill the same kWh: kept as a flat price of their own, to be checked.`);
    }
    if (isComponent) components.push(candidate);
    else flat.push(...candidate);
  }
  return { components, flat };
}

function bandsOf(lines: readonly Billed[]): string[] {
  return [...new Set(lines.map((line) => line.band).filter((band): band is string => band !== null))];
}

/** The kWh the consumption lines bill, each counted once; null when a line prints no volume. */
export function billedKwh(lines: readonly Billed[]): number | null {
  if (lines.length === 0 || lines.some((line) => line.kwh === null)) return null;
  const { flat } = allHoursLines(lines);
  const banded = lines.filter((line) => line.band !== null);
  const seasons = [...new Set(lines.map((line) => line.season))];
  let total = 0;
  for (const band of bandsOf(banded)) {
    for (const season of seasons) total += coveredKwh(banded.filter((line) => line.band === band && line.season === season)) ?? 0;
  }
  return round(total + (coveredKwh(flat) ?? 0), 3);
}

/** Earliest start and latest end of the dated lines: the union of the sub-periods. */
export function periodOfLines(lines: ReadonlyArray<{ start: string | null; end: string | null }>): { start: string; end: string } | null {
  const starts = lines.map((line) => line.start).filter((d): d is string => d !== null).sort();
  const ends = lines.map((line) => line.end).filter((d): d is string => d !== null).sort();
  if (starts.length === 0 || ends.length === 0) return null;
  const start = starts[0]!;
  const end = ends[ends.length - 1]!;
  return end >= start ? { start, end } : null;
}

// ── Seasons: a whole grid or none ────────────────────────────────────────────

/**
 * Lines whose season is kept: a season is a grid of its own only when it
 * names every band the bill prices; otherwise its lines are read without a
 * season, with a note — half a grid would be filled downstream with another
 * season's prices.
 */
export function wholeSeasons(lines: readonly Billed[], report: Report): Billed[] {
  const priced = lines.filter((line) => line.band !== null && line.price !== null);
  const bands = new Set(priced.map((line) => line.band));
  const partial = new Set<string>();
  for (const season of new Set(priced.map((line) => line.season).filter((s): s is string => s !== null))) {
    const named = new Set(priced.filter((line) => line.season === season).map((line) => line.band));
    if (named.size !== bands.size) partial.add(season);
  }
  for (const season of partial) {
    report('season_grid_incomplete', `Season "${season}" is named on some bands and not on the others: its lines are read without a season.`, 'note');
  }
  return lines.map((line) => (line.season !== null && partial.has(line.season) ? { ...line, season: null } : line));
}

// ── One price per band and season ────────────────────────────────────────────

export interface Grid {
  prices: { band: string | null; season: string | null; billed: number | null; latest: number | null; weighted: boolean }[];
  energy: { band: string | null; season: string | null; kwh: number | null }[];
  revision: { since: string | null; changes: number | null };
  latestTold: boolean;
}

/**
 * The prices of a bill, one per band and season, each the components of the
 * band added up — an every-hour component added to each band — once weighted,
 * once at its latest; and the kWh of each band, counted once.
 */
export function bandGrid(lines: readonly Billed[], order: readonly string[], report: Report): Grid {
  const seen: PriceRevision[] = [];
  const allHours = allHoursLines(lines, report);
  const bandedPriced = lines.some((line) => line.band !== null && line.price !== null);
  const flat = bandedPriced ? allHours.flat : lines.filter((line) => line.band === null);
  const onEvery = bandedPriced ? allHours.components : [];

  const priceOf = (band: string | null, group: readonly Billed[], pick: 'weighted' | 'latest') => {
    const own = stackedPrice(group, pick);
    if (pick === 'weighted') {
      seen.push(...own.revisions);
      if (own.price !== null && !own.weighted) report('price_without_volumes', `Band "${band ?? 'every hour'}" is billed at several prices without volumes: plain mean used instead of a weighted price.`);
      if (own.price !== null && own.conflicting) {
        report('components_disagree', `Band "${band ?? 'every hour'}": lines dated over the same period do not bill the same volume — read as sub-periods of one price, not as components that add up. To be checked.`);
      }
    }
    if (own.price === null) return { price: null, weighted: own.weighted };
    let price = own.price;
    if (band !== null) {
      for (const component of onEvery) {
        const added = stackedPrice(component, pick);
        if (pick === 'weighted') seen.push(...added.revisions);
        if (added.price === null) return { price: null, weighted: own.weighted };
        price += added.price;
      }
    }
    return { price: round(price, 5), weighted: own.weighted };
  };

  const groups: { band: string | null; season: string | null; lines: Billed[] }[] = [];
  const key = (line: Billed) => `${line.band ?? ''}\u0000${line.season ?? ''}`;
  for (const line of [...lines.filter((l) => l.band !== null), ...flat]) {
    const group = groups.find((g) => `${g.band ?? ''}\u0000${g.season ?? ''}` === key(line));
    if (group) group.lines.push(line);
    else groups.push({ band: line.band, season: line.season, lines: [line] });
  }
  const rank = (band: string | null) => (band === null ? order.length + 1 : order.includes(band) ? order.indexOf(band) : order.length);
  groups.sort((a, b) => rank(a.band) - rank(b.band) || (a.season ?? '').localeCompare(b.season ?? ''));

  const prices = groups.map((g) => {
    const billed = priceOf(g.band, g.lines, 'weighted');
    return { band: g.band, season: g.season, billed: billed.price, latest: priceOf(g.band, g.lines, 'latest').price, weighted: billed.weighted };
  });
  const energy = groups.map((g) => ({ band: g.band, season: g.season, kwh: coveredKwh(g.lines) }));
  const dates = seen.map((r) => r.since).filter((d): d is string => d !== null).sort();
  return {
    prices,
    energy,
    revision: {
      since: dates.length > 0 ? dates[dates.length - 1]! : null,
      changes: seen.some((r) => r.changes === null) ? null : seen.reduce((most, r) => Math.max(most, r.changes as number), 0),
    },
    latestTold: prices.every((p) => p.billed === null || p.latest !== null),
  };
}

/**
 * Which price stands for the kWh to come. A fixed price revised on a date no
 * longer applies before its revision: the latest stands. A price that follows
 * a market or an index, or a contract the bill does not name: the weighted
 * price, the widest sample the lines give.
 */
export function projection(contract: string | null, revised: boolean, latestTold: boolean): 'latest' | 'weighted' {
  return contract === 'fixed' && revised && latestTold ? 'latest' : 'weighted';
}

// ── A line's three figures ───────────────────────────────────────────────────

/** Cents of rounding on a printed amount, and the drift of a price printed with fewer decimals than it is billed at. */
export const AMOUNT_TOLERANCE = 0.02;
const AMOUNT_TOLERANCE_RATIO = 0.001;

export function lineDisagrees(line: { kwh: number | null; price: number | null; amount: number | null }): boolean {
  if (line.kwh === null || line.price === null || line.amount === null) return false;
  return Math.abs(line.kwh * line.price - line.amount) > Math.max(AMOUNT_TOLERANCE, Math.abs(line.amount) * AMOUNT_TOLERANCE_RATIO);
}

/**
 * Consumption lines whose price was misread, put right from the two other
 * figures — only when the bill's energy subtotal confirms both the amounts and
 * the volumes; otherwise the price is kept as read and said.
 */
export function reconcileLines(lines: readonly Billed[], printed: { kwh: number | null; amount: number | null }, report: Report): Billed[] {
  if (!lines.some(lineDisagrees)) return [...lines];
  const kwh = billedKwh(lines);
  const amounts = lines.every((line) => line.amount !== null) ? lines.reduce((sum, line) => sum + (line.amount as number), 0) : null;
  const confirmed = kwh !== null && printed.kwh !== null && Math.abs(kwh - printed.kwh) < 0.5
    && amounts !== null && printed.amount !== null && Math.abs(amounts - printed.amount) <= AMOUNT_TOLERANCE;
  return lines.map((line) => {
    if (!lineDisagrees(line)) return line;
    const { kwh: volume, price, amount } = line as { kwh: number; price: number; amount: number };
    if (confirmed && volume > 0 && amount > 0) {
      const derived = round(amount / volume, 5);
      report('price_misread', `Line ${line.id}: ${volume} kWh at ${price} do not give the ${amount} printed; the bill's energy subtotal confirms its amounts and volumes, so the price was misread: ${derived} used.`, 'warning', line.id);
      return { ...line, price: derived };
    }
    report('line_disagrees', `Line ${line.id}: ${volume} kWh at ${price} do not give the ${amount} printed, and the bill does not say which figure was misread — price kept as read, to be checked.`, 'warning', line.id);
    return line;
  });
}

// ── Network delivery ─────────────────────────────────────────────────────────

export interface Delivery {
  label: string | null;
  kind: 'fixed' | 'variable' | null;
  kwh: number | null;
  price: number | null;
  amount: number | null;
  /** A line of the total (true) or stated as information (false). */
  inTotal: boolean;
}

/** The component a label names: the label up to its last separator, so that an advance and its take-back are one component. */
function componentStem(label: string | null): string | null {
  if (!label) return null;
  const parts = normalizeLabel(label).split(/\s+[-–—]\s+|\s*:\s+/);
  const stem = (parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0]!).trim();
  return stem || null;
}

/** A line of no kind takes the kind of the lines of its component, when they all have one. */
function withComponentKinds(group: readonly Delivery[]): Delivery[] {
  return group.map((line) => {
    if (line.kind !== null) return line;
    const stem = componentStem(line.label);
    if (stem === null) return line;
    const kinds = new Set(group.filter((o) => o.kind !== null && componentStem(o.label) === stem).map((o) => o.kind));
    return kinds.size === 1 ? { ...line, kind: [...kinds][0]! } : line;
  });
}

const amountOf = (line: { kwh: number | null; price: number | null; amount: number | null }): number | null =>
  line.amount !== null ? line.amount : line.kwh !== null && line.price !== null ? round(line.kwh * line.price, 2) : null;

/**
 * Is network delivery billed on top of the energy price, or included in it?
 * Billed lines of the total: billed separately. Only amounts stated as
 * information: included, the split kept. Lines that bill no variable part
 * while the statement gives one: partly billed, the variable part inside the
 * energy price — included. The variable part per kWh is the variable amounts
 * over the kWh of the period.
 */
export function deliveryBilling(lines: readonly Delivery[], periodKwh: number | null, report: Report): { included: boolean | null; fixed: number | null; variable: number | null; variablePerKwh: number | null; label: string | null } {
  const none = { included: null, fixed: null, variable: null, variablePerKwh: null, label: null };
  if (lines.length === 0) return none;
  const billed = withComponentKinds(lines.filter((line) => line.inTotal && amountOf(line) !== null));
  const stated = withComponentKinds(lines.filter((line) => !line.inTotal && amountOf(line) !== null));
  if (billed.length === 0 && stated.length === 0) return none;
  const ofKind = (group: readonly Delivery[], kind: 'fixed' | 'variable') => group.filter((line) => line.kind === kind);
  const partly = billed.length > 0 && ofKind(billed, 'variable').length === 0 && ofKind(stated, 'variable').length > 0;
  const included = billed.length === 0 || partly;
  const basis = billed.length === 0 ? stated : partly ? [...billed, ...stated] : billed;
  const unknown = basis.filter((line) => line.kind === null);
  if (unknown.length > 0) {
    report('network_kind_unknown', `Network delivery: ${unknown.length} amount(s) are neither fixed nor variable (${distinctLabels(unknown) ?? 'no label'}) — left out of both parts.`);
  }
  const sum = (group: readonly Delivery[]): number | null => (group.length > 0 ? round(group.reduce((t, line) => t + (amountOf(line) as number), 0), 2) : null);
  const sumOf = (kind: 'fixed' | 'variable') => sum(ofKind(partly ? stated : basis, kind));

  let fixed = partly ? sum(ofKind(billed, 'fixed')) : sumOf('fixed');
  if (partly && ofKind(stated, 'fixed').length > 0) {
    const statedFixed = ofKind(stated, 'fixed');
    const statedAmount = sum(statedFixed) as number;
    const billedStems = new Set(ofKind(billed, 'fixed').map((line) => componentStem(line.label)));
    if (fixed === null) fixed = statedAmount;
    else if (Math.abs(statedAmount - fixed) <= AMOUNT_TOLERANCE) {
      // The statement restates the billed lines: counted once.
    } else if (statedFixed.some((line) => line.label === null || billedStems.has(componentStem(line.label)))) {
      report('network_stated_other_amount', `Network delivery: the fixed part stated as information (${statedAmount}) names a component billed for another amount (${fixed}) — only the billed lines are counted, to be checked.`);
    } else {
      report('network_stated_added', `Network delivery: the fixed part adds the billed lines (${fixed}) and the amounts stated as information (${statedAmount}, ${distinctLabels(statedFixed)}) — to be checked if the statement already covers the billed lines.`);
      fixed = round(fixed + statedAmount, 2);
    }
  }
  const variable = sumOf('variable');
  const variableLines = ofKind(partly ? stated : basis, 'variable');
  let perKwh: number | null = null;
  if (variable !== null && variable > 0) {
    if (periodKwh !== null && periodKwh > 0) perKwh = round(variable / periodKwh, 5);
    else if (new Set(variableLines.map((line) => (line.label ? normalizeLabel(line.label) : ''))).size === 1) {
      const mean = weightedMean(variableLines).price;
      perKwh = mean === null ? null : round(mean, 5);
    }
    if (perKwh === null) report('network_per_kwh_unknown', 'Network delivery: the consumption of the period is unknown, so its variable part is not brought to a price per kWh.');
  }
  return { included, fixed, variable, variablePerKwh: perKwh !== null && perKwh > 0 ? perKwh : null, label: distinctLabels(variableLines.length > 0 ? variableLines : basis) };
}

// ── Taxes and contributions ──────────────────────────────────────────────────

/** The per-kWh taxes as one rate: each tax weighted over its own sub-periods, distinct taxes added up (they are levied on the same kWh). */
export function taxPerKwh(lines: ReadonlyArray<{ label: string | null; kwh: number | null; price: number | null }>): number | null {
  const byLabel = new Map<string, typeof lines[number][]>();
  for (const line of lines) {
    const key = line.label ? normalizeLabel(line.label) : '';
    byLabel.set(key, [...(byLabel.get(key) ?? []), line]);
  }
  let total = 0;
  let found = false;
  for (const group of byLabel.values()) {
    const { price } = weightedMean(group);
    if (price !== null) {
      total += price;
      found = true;
    }
  }
  return found ? round(total, 5) : null;
}

/** Contributions on a fixed base as one rate, weighted by base, and one amount; a lump sum has an amount and no rate. */
export function contributionSummary(lines: ReadonlyArray<{ base: number | null; rate: number | null; amount: number | null }>): { rate: number | null; amount: number | null } {
  if (lines.length === 0) return { rate: null, amount: null };
  const amount = lines.every((c) => c.amount !== null) ? round(lines.reduce((s, c) => s + (c.amount as number), 0), 2) : null;
  const totalBase = lines.reduce((s, c) => s + (c.base ?? 0), 0);
  const allBased = lines.every((c) => c.base !== null) && totalBase > 0;
  let rate: number | null = null;
  if (allBased && lines.every((c) => c.rate !== null)) rate = lines.reduce((s, c) => s + (c.rate as number) * (c.base as number), 0) / totalBase;
  else if (allBased && amount !== null) rate = amount / totalBase;
  else if (lines.every((c) => c.rate !== null && c.rate === lines[0]!.rate)) rate = lines[0]!.rate;
  return { rate: rate !== null && rate > 0 && rate < 1 ? round(rate, 4) : null, amount };
}
