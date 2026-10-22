// Reading an R63 (load curve) or R64 (index) file of Enedis, in JSON or in
// XML, as published (Enedis R6X guide, enedis.fr/media/3751).
//
// A file holds measures per metering point (`mesures`, `idPrm`), each with
// its quantities (`grandeur`: `grandeurMetier` CONS or PROD,
// `grandeurPhysique` PA, PRI, PRC, E or EA, `unite`) and its points: for a
// load curve `points[] { v, d, p, n, tc, iv, ec }`, for an index the
// readings of each dial (`calendrier[].classeTemporelle[].valeur[]`).
//
// The R63 dates each step at its START, in the legal time of the
// operator without an offset. The zone is the caller's (never written
// here); the hour repeated when the clocks go back is told apart by the
// order of the lines, as the file has nothing else. Every step is given at
// its start in UTC. A step the file does not carry is a missing point. The
// nature letter of each point is mapped to a quality code by the table
// the caller passes in.

import { parseXml, type XmlNode } from './xml.js';
import { durationMs, instantsOf } from './time.js';
import type { R6xFile, R6xOptions, R6xPoint, R6xProblem, R6xSeries } from './types.js';

type Json = Record<string, unknown>;

/** Reads an R63 or R64 file, JSON or XML, as text or as JSON already parsed. */
export function readR6x(input: string | Json, options: R6xOptions): R6xFile {
  let doc: Json;
  if (typeof input === 'string') {
    const text = input.replace(/^﻿/, '').trimStart();
    try {
      doc = text.startsWith('<') ? xmlToJson(parseXml(text)) : (JSON.parse(text) as Json);
    } catch (error) {
      const detail = error instanceof Error ? error.message.replace(/^xml_unreadable: /, '') : String(error);
      return { header: {}, series: [], problems: [{ code: 'file_unreadable', detail }] };
    }
  } else {
    doc = input;
  }
  const problems: R6xProblem[] = [];
  const header = (doc.header ?? doc.entete ?? {}) as Json;
  const series: R6xSeries[] = [];
  for (const measure of list(doc.mesures)) {
    const m = measure as Json;
    const prm = str(m.idPrm) ?? '';
    const stage = str(m.etapeMetier);
    const period = (m.periode ?? null) as Json | null;
    for (const quantity of list(m.grandeur)) {
      const g = quantity as Json;
      const base = {
        prm, stage, business: str(g.grandeurMetier) ?? '', physical: str(g.grandeurPhysique) ?? '', unit: str(g.unite),
      };
      if (g.points !== undefined) {
        series.push(loadCurve(base, list(g.points) as Json[], period, options, problems));
      }
      for (const calendar of list(g.calendrier)) {
        const c = calendar as Json;
        for (const timeClass of list(c.classeTemporelle)) {
          const t = timeClass as Json;
          series.push(index({
            ...base, calendar: str(c.idCalendrier), time_class: str(t.idClasseTemporelle), dial: str(t.codeCadran),
          }, list(t.valeur) as Json[], options, problems));
        }
      }
    }
  }
  if (series.length === 0 && problems.length === 0) problems.push({ code: 'no_measures', detail: 'the file holds no measures' });
  return { header, series, problems };
}

function loadCurve(
  base: Pick<R6xSeries, 'prm' | 'stage' | 'business' | 'physical' | 'unit'>,
  points: Json[],
  period: Json | null,
  options: R6xOptions,
  problems: R6xProblem[],
): R6xSeries {
  const where = `${base.prm} ${base.business} ${base.physical}`;
  const steps = new Set(points.map((p) => stepOf(p.p)).filter((s): s is string => s !== null));
  const step = steps.size === 1 ? [...steps][0]! : null;
  if (steps.size > 1) problems.push({ code: 'step_irregular', detail: `${where}: steps ${[...steps].join(', ')} in one quantity; no missing step is added` });
  const read: R6xPoint[] = [];
  let previous = -Infinity;
  for (const p of points) {
    const local = str(p.d);
    if (local === null) {
      problems.push({ code: 'date_unreadable', detail: `${where}: a point without a date` });
      continue;
    }
    const at = instant(local, options.timeZone, previous, where, problems);
    if (at === null) continue;
    previous = at;
    read.push(point(at, local, p, options, where, problems));
  }
  read.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const stepMs = step ? durationMs(step) : null;
  const filled = stepMs ? withMissing(read, stepMs, bounds(period, options.timeZone), options) : read;
  return { ...base, kind: 'load_curve', step, calendar: null, time_class: null, dial: null, points: filled };
}

function index(
  base: Pick<R6xSeries, 'prm' | 'stage' | 'business' | 'physical' | 'unit' | 'calendar' | 'time_class' | 'dial'>,
  values: Json[],
  options: R6xOptions,
  problems: R6xProblem[],
): R6xSeries {
  const where = `${base.prm} ${base.business} ${base.physical} ${base.calendar ?? ''}/${base.time_class ?? ''}`;
  const points: R6xPoint[] = [];
  let previous = -Infinity;
  for (const v of values) {
    const local = str(v.d);
    if (local === null) continue;
    const at = instant(local, options.timeZone, previous, where, problems);
    if (at === null) continue;
    previous = at;
    points.push(point(at, local, v, options, where, problems));
  }
  return { ...base, kind: 'index', step: null, points };
}

function point(at: number, local: string, p: Json, options: R6xOptions, where: string, problems: R6xProblem[]): R6xPoint {
  const raw = p.v;
  const value = raw === null || raw === undefined || raw === '' ? Number.NaN : Number(raw);
  if (Number.isNaN(value) && raw !== null && raw !== undefined && raw !== '') {
    problems.push({ code: 'value_unreadable', detail: `${where} at ${local}: ${JSON.stringify(raw)}` });
  }
  const nature = str(p.n);
  let quality: number | null;
  if (Number.isNaN(value)) {
    quality = options.qualityCodes.missing ?? null;
  } else if (nature === null) {
    quality = options.qualityCodes.none ?? null;
  } else {
    quality = options.qualityCodes[nature] ?? null;
  }
  if (quality === null) problems.push({ code: 'quality_unknown', detail: `${where} at ${local}: nature ${JSON.stringify(nature)} is not in the table given` });
  return {
    start: new Date(at).toISOString(), local, value, nature, quality,
    correction: str(p.tc), likelihood: str(p.iv), state: str(p.ec),
  };
}

/**
 * The instant a stamp names: its own offset when it has one, otherwise the
 * wall-clock time in the caller's zone; of two instants (the hour repeated
 * in autumn), the first after the previous line.
 */
function instant(stamp: string, timeZone: string | undefined, previous: number, where: string, problems: R6xProblem[]): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(stamp.trim());
  if (!m) {
    problems.push({ code: 'date_unreadable', detail: `${where}: ${stamp}` });
    return null;
  }
  const wall = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  if (m[7]) {
    if (m[7] === 'Z') return wall;
    const sign = m[7].startsWith('-') ? -1 : 1;
    const digits = m[7].slice(1).replace(':', '');
    return wall - sign * (+digits.slice(0, 2) * 60 + +digits.slice(2)) * 60_000;
  }
  if (!timeZone) {
    problems.push({ code: 'time_zone_required', detail: `${where}: ${stamp} carries no offset and no zone was given` });
    return null;
  }
  const candidates = instantsOf(timeZone, wall);
  if (candidates.length === 0) {
    problems.push({ code: 'local_time_nonexistent', detail: `${where}: ${stamp} does not exist in ${timeZone}` });
    return null;
  }
  return candidates.find((c) => c > previous) ?? candidates[candidates.length - 1]!;
}

/** The first and last instants a period of local days covers (`dateFin` excluded). */
function bounds(period: Json | null, timeZone: string | undefined): { from: number; to: number } | null {
  const from = str(period?.dateDebut);
  const to = str(period?.dateFin);
  if (!from || !to || !timeZone) return null;
  const day = (d: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
    return m ? instantsOf(timeZone, Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!))[0] ?? null : null;
  };
  const a = day(from);
  const b = day(to);
  return a !== null && b !== null && b > a ? { from: a, to: b } : null;
}

/** The points with a missing point at each step the file does not carry, over the period when it gives one. */
function withMissing(points: R6xPoint[], stepMs: number, period: { from: number; to: number } | null, options: R6xOptions): R6xPoint[] {
  if (points.length === 0 && !period) return points;
  const have = new Map(points.map((p) => [Date.parse(p.start), p]));
  const first = period ? Math.min(period.from, ...have.keys()) : Math.min(...have.keys());
  const last = period ? Math.max(period.to - stepMs, ...have.keys()) : Math.max(...have.keys());
  const out: R6xPoint[] = [];
  for (let t = first; t <= last; t += stepMs) {
    out.push(have.get(t) ?? {
      start: new Date(t).toISOString(), local: null, value: Number.NaN, nature: null, quality: options.qualityCodes.missing ?? null,
      correction: null, likelihood: null, state: null,
    });
  }
  // A point off the grid of the step is kept where it is.
  for (const [t, p] of have) if ((t - first) % stepMs !== 0) out.push(p);
  return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

function stepOf(p: unknown): string | null {
  if (typeof p === 'number') return `PT${p}M`;
  const s = str(p);
  if (s === null) return null;
  if (/^\d+$/.test(s)) return `PT${s}M`;
  return s.toUpperCase() === 'PT60M' ? 'PT1H' : s.toUpperCase();
}

function list(v: unknown): unknown[] {
  return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
}

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** An XML tree as the JSON of the same file: an element of text is its text, a repeated element an array. */
function xmlToJson(node: XmlNode): Json {
  const out: Json = {};
  for (const child of node.children) {
    const value = child.children.length === 0 ? child.text.trim() : xmlToJson(child);
    const existing = out[child.name];
    out[child.name] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return out;
}
