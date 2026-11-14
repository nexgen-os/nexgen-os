// Reading what a P1 port says: the DSMR telegram a smart meter writes on
// it (DSMR 2.2 to 5.0.2 and the Belgian e-MUCS variant), and the JSON
// message the open P1M5 dongle publishes from it (firmware 1.0.47 and
// later: one key per OBIS code, `{ value, unit }` for a measure).
//
// A telegram is an identification line `/XXX5…`, one object per line,
// `OBIS(group)(group)…`, and a last line `!CRC`: from DSMR 4 on, the
// CRC16 (polynomial 0xA001, reflected, initial value 0) of every character
// from `/` to `!` included, in four hexadecimal digits. A telegram whose
// checksum does not match is read and reported (`crc_mismatch`), never
// repaired; the caller decides what to keep.
//
// The reading is dated by the meter's clock (`0-0:1.0.0`), local time with
// a season letter, turned into UTC with the zone of the meter's place that
// the caller gives; never by the time the message was received.

import { obisMeaning } from './obis.js';
import { meterTime } from './time.js';
import type { DsmrLine, DsmrOptions, DsmrProblem, DsmrReading, DsmrValue } from './types.js';

const OBIS = /^\d+-\d+:\d+\.\d+\.\d+$/;
const OBJECT = /^(\d+-\d+:\d+\.\d+\.\d+)((?:\([^()]*\))*)\s*$/;
const NUMBER = /^([-+]?\d+(?:\.\d+)?)(?:\*(.+))?$/;
const STAMP = /^\d{12}[SW]?$/;

/** The CRC16 of a telegram (CRC-16/ARC: polynomial 0xA001 reflected, initial value 0), as DSMR 4 and 5 compute it. */
export function crc16(text: string): number {
  let crc = 0;
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

/** Reads a DSMR telegram as the meter wrote it on its P1 port. */
export function readTelegram(text: string, options: DsmrOptions = {}): DsmrReading {
  const start = text.indexOf('/');
  const end = start < 0 ? -1 : text.indexOf('!', start);
  if (start < 0 || end < 0) {
    return empty({ code: 'telegram_unreadable', detail: start < 0 ? 'no identification line (/…)' : 'no end line (!…)' }, null);
  }
  const problems: DsmrProblem[] = [];
  const written = /^[0-9A-Fa-f]{4}/.exec(text.slice(end + 1))?.[0] ?? null;
  let crc: DsmrReading['crc'] = 'absent';
  if (written) {
    const computed = crc16(text.slice(start, end + 1));
    crc = computed === parseInt(written, 16) ? 'valid' : 'invalid';
    if (crc === 'invalid') {
      problems.push({ code: 'crc_mismatch', detail: `the telegram says ${written.toUpperCase()}, its characters give ${computed.toString(16).toUpperCase().padStart(4, '0')}` });
    }
  }
  const [first, ...body] = text.slice(start, end).split(/\r?\n/);
  const lines: DsmrLine[] = [];
  for (const raw of body) {
    const line = raw.trim();
    if (!line) continue;
    const previous = lines.at(-1);
    if (line.startsWith('(') && previous) {
      previous.values.push(...groups(line));
      continue;
    }
    const m = OBJECT.exec(line);
    if (!m) {
      problems.push({ code: 'value_unreadable', detail: `the line ${line.slice(0, 60)} is not OBIS(value)` });
      continue;
    }
    lines.push({ obis: m[1]!, values: groups(m[2]!) });
  }
  return interpret(first!.slice(1).trim() || null, crc, lines, {}, options, problems);
}

/** Reads the message a P1M5 dongle publishes (`<dongle>/data/readings`), as text or as JSON already parsed. */
export function readP1m5(input: string | Record<string, unknown>, options: DsmrOptions = {}): DsmrReading {
  let message: Record<string, unknown>;
  if (typeof input === 'string') {
    try {
      message = JSON.parse(input) as Record<string, unknown>;
    } catch (error) {
      return empty({ code: 'telegram_unreadable', detail: error instanceof Error ? error.message : String(error) }, null);
    }
  } else {
    message = input;
  }
  if (message === null || typeof message !== 'object' || Array.isArray(message)) {
    return empty({ code: 'telegram_unreadable', detail: 'the message is not a JSON object' }, null);
  }
  const lines: DsmrLine[] = [];
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(message)) {
    if (!OBIS.test(key)) {
      fields[key] = value;
      continue;
    }
    // A measure is `{ value, unit }`, written back in the telegram's
    // notation, `value*unit`; anything else is its text.
    if (value !== null && typeof value === 'object' && 'value' in value) {
      const v = value as { value: unknown; unit?: unknown };
      lines.push({ obis: key, values: [typeof v.unit === 'string' && v.unit ? `${String(v.value)}*${v.unit}` : String(v.value)] });
    } else {
      lines.push({ obis: key, values: [String(value)] });
    }
  }
  return interpret(null, null, lines, fields, options, []);
}

function interpret(
  header: string | null,
  crc: DsmrReading['crc'],
  lines: DsmrLine[],
  fields: Record<string, unknown>,
  options: DsmrOptions,
  problems: DsmrProblem[],
): DsmrReading {
  const text = (obis: string) => lines.find((l) => l.obis === obis)?.values[0] ?? null;
  const values: DsmrValue[] = [];
  let at: string | null = null;
  const local = text('0-0:1.0.0');
  if (local === null) {
    problems.push({ code: 'time_missing', detail: 'the telegram carries no meter time (0-0:1.0.0)' });
  } else {
    at = dated(local, '0-0:1.0.0', options, problems);
  }
  for (const line of lines) {
    const meaning = obisMeaning(line.obis);
    if (!meaning) continue;
    const measure = line.values.at(-1) ?? '';
    const m = NUMBER.exec(measure.trim());
    if (!m) {
      problems.push({ code: 'value_unreadable', detail: `${line.obis}: ${measure.slice(0, 40)} is not a number` });
      continue;
    }
    const own = line.values.length > 1 && STAMP.test(line.values[0]!.trim()) ? line.values[0]!.trim() : null;
    values.push({
      obis: line.obis,
      ...meaning,
      value: Number(m[1]),
      unit: m[2]?.trim() || null,
      at: own === null ? null : dated(own, line.obis, options, problems),
      local: own,
    });
  }
  if (values.length === 0) problems.push({ code: 'no_values', detail: 'no measure was read' });
  const id = text('0-0:96.1.1');
  return {
    header,
    equipment_id: id === null ? null : decodeOctets(id),
    version: text('0-0:96.1.4') ?? text('1-3:0.2.8'),
    at,
    local,
    tariff: text('0-0:96.14.0'),
    crc,
    values,
    lines,
    fields,
    problems: dedupe(problems),
  };
}

/** A meter stamp in UTC, or null with its problem. */
function dated(stamp: string, obis: string, options: DsmrOptions, problems: DsmrProblem[]): string | null {
  const t = meterTime(stamp, options.timeZone);
  if ('at' in t) return t.at;
  problems.push({ code: t.problem, detail: `${obis}: ${t.detail}` });
  return null;
}

/** The text of each `(…)` group of an object. */
function groups(s: string): string[] {
  return [...s.matchAll(/\(([^()]*)\)/g)].map((g) => g[1]!);
}

/** An identifier the meter writes as the hexadecimal of its ASCII characters, decoded; as written otherwise. */
function decodeOctets(hex: string): string {
  if (!/^(?:[0-9A-Fa-f]{2})+$/.test(hex)) return hex;
  const chars = hex.match(/../g)!.map((h) => parseInt(h, 16));
  return chars.every((c) => c >= 0x20 && c <= 0x7e) ? String.fromCharCode(...chars) : hex;
}

/** One problem per code and detail: a zone missing is said once for every stamp of the telegram. */
function dedupe(problems: DsmrProblem[]): DsmrProblem[] {
  const seen = new Set<string>();
  const out: DsmrProblem[] = [];
  for (const p of problems) {
    const key = p.code === 'time_zone_required' ? p.code : `${p.code} ${p.detail}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

function empty(problem: DsmrProblem, crc: DsmrReading['crc']): DsmrReading {
  return { header: null, equipment_id: null, version: null, at: null, local: null, tariff: null, crc, values: [], lines: [], fields: {}, problems: [problem] };
}
