/**
 * What the schema cannot say about a pack: the checks between its sections
 * and between the packs of a checkout. Each problem has a name, printed first.
 *
 * - every region a row names is declared in the identity, with its parent;
 * - every time zone exists, and a region's is one the country declares;
 * - every pattern compiles, and an identifier's example matches it;
 * - every value cites a source of its own pack, and its periods do not
 *   overlap: a value that changes is closed and followed, never edited;
 * - a reviewed pack names its reviewer and the day;
 * - a pack with grid operators names the `grid` module;
 * - across packs: one seed number and one code per row.
 */
import type { Problem } from '../doctor.js';
import type { Pack, PackDefault } from './read.js';

/** The property the voltage levels of grid.json are compiled into. */
export const VOLTAGE_LEVELS_PROPERTY = 'voltage_levels';
export const VOLTAGE_UNIT = 'KiloV';

/** Every value of a pack that lands in `defaults`: defaults.json, then the thresholds and voltage levels of grid.json. */
export function valuesOf(pack: Pack): PackDefault[] {
  const grid = pack.grid;
  const levels = grid?.voltage_levels;
  return [
    ...pack.defaults,
    ...(grid?.thresholds ?? []),
    ...(levels
      ? [{
          property: VOLTAGE_LEVELS_PROPERTY,
          value: levels.levels,
          unit: VOLTAGE_UNIT,
          source_code: levels.source_code,
          reference: levels.reference,
          valid_from: levels.valid_from,
          ...(levels.valid_to ? { valid_to: levels.valid_to } : {}),
        }]
      : []),
  ];
}

/** The problems of one pack that read correctly against the schema. */
export function checkPack(pack: Pack): Problem[] {
  const problems: Problem[] = [];
  const say = (code: string, file: string, detail: string) => problems.push({ code, detail: `packs/${pack.slug}/${file}: ${detail}` });
  const { manifest } = pack;
  const identity = manifest.identity;

  // Identity: the regions, their parents and time zones.
  const regions = new Set<string>();
  for (const zone of identity.time_zones) if (!isTimeZone(zone)) say('time_zone_unknown', 'pack.json', `identity.time_zones: ${zone} is not an IANA time zone`);
  for (const region of identity.regions) {
    if (regions.has(region.code)) say('duplicate_code', 'pack.json', `identity.regions: ${region.code} twice`);
    regions.add(region.code);
    if (!region.code.startsWith(`${manifest.country}-`)) say('region_foreign', 'pack.json', `identity.regions: ${region.code} is not a subdivision of ${manifest.country}`);
    if (region.time_zone !== undefined && !identity.time_zones.includes(region.time_zone)) {
      say('time_zone_undeclared', 'pack.json', `identity.regions: ${region.code} is in ${region.time_zone}, which identity.time_zones does not list`);
    }
  }
  const region = (file: string, where: string, code: string | undefined) => {
    if (code !== undefined && !regions.has(code)) say('region_undeclared', file, `${where} names ${code}, which identity.regions does not declare`);
  };
  for (const r of identity.regions) region('pack.json', `identity.regions ${r.code} (parent)`, r.parent);
  if (identity.postal_code_pattern !== undefined && !compiles(identity.postal_code_pattern)) {
    say('pattern_invalid', 'pack.json', `identity.postal_code_pattern does not compile: ${identity.postal_code_pattern}`);
  }
  if (manifest.certification.status === 'reviewed' && (manifest.certification.reviewer === undefined || manifest.certification.date === undefined)) {
    say('certification_incomplete', 'pack.json', 'a reviewed pack names its reviewer and the day they read it');
  }

  // Identifiers: one code each, a pattern that compiles and matches its example.
  unique(pack.identifiers.map((i) => i.code), (code) => say('duplicate_code', 'identifiers.json', `${code} twice`));
  for (const scheme of pack.identifiers) {
    if (scheme.pattern === undefined) continue;
    if (!compiles(scheme.pattern)) say('pattern_invalid', 'identifiers.json', `${scheme.code}: ${scheme.pattern} does not compile`);
    else if (!new RegExp(scheme.pattern, 'u').test(scheme.example)) say('example_mismatch', 'identifiers.json', `${scheme.code}: ${scheme.example} does not match ${scheme.pattern}`);
  }

  // Sources.
  unique(pack.sources.map((s) => s.code), (code) => say('duplicate_code', 'sources.json', `${code} twice`));
  pack.sources.forEach((s) => (s.regions ?? []).forEach((r) => region('sources.json', `source ${s.code}`, r)));

  // Grid.
  if (pack.grid !== null) {
    const grid = pack.grid;
    unique(grid.operators.map((o) => o.code), (code) => say('duplicate_code', 'grid.json', `operator ${code} twice`));
    grid.operators.forEach((o) => (o.regions ?? []).forEach((r) => region('grid.json', `operator ${o.code}`, r)));
    if (grid.operators.length > 0 && !(manifest.modules ?? []).includes('grid')) {
      say('module_required', 'pack.json', 'grid.json lists operators, which live in the grid module: add "grid" to modules');
    }
    const levels = grid.voltage_levels?.levels ?? [];
    unique(levels.map((l) => l.code), (code) => say('duplicate_code', 'grid.json', `voltage level ${code} twice`));
    for (const level of levels) {
      if (level.min_kv >= level.max_kv) say('voltage_range_invalid', 'grid.json', `voltage level ${level.code}: ${level.min_kv} kV is not below ${level.max_kv} kV`);
    }
  }

  // Values: cited from the pack's own sources, dated, never two at once.
  const sources = new Set(pack.sources.map((s) => s.code));
  const periods = new Map<string, PackDefault[]>();
  for (const value of valuesOf(pack)) {
    const file = pack.defaults.includes(value) ? 'defaults.json' : 'grid.json';
    const name = `${value.property}${value.region ? ` (${value.region})` : ''} from ${value.valid_from}`;
    region(file, name, value.region);
    if (!sources.has(value.source_code)) say('source_undeclared', file, `${name} cites ${value.source_code}, which sources.json does not declare`);
    if (value.valid_to !== undefined && value.valid_to <= value.valid_from) say('validity_invalid', file, `${name}: valid_to ${value.valid_to} is not after valid_from`);
    const key = `${value.property}|${value.region ?? ''}`;
    periods.set(key, [...(periods.get(key) ?? []), value]);
  }
  for (const rows of periods.values()) {
    const sorted = [...rows].sort((a, b) => (a.valid_from < b.valid_from ? -1 : a.valid_from > b.valid_from ? 1 : 0));
    for (let i = 1; i < sorted.length; i += 1) {
      const before = sorted[i - 1]!;
      const after = sorted[i]!;
      if (before.valid_to === undefined || after.valid_from < before.valid_to) {
        const where = `${after.property}${after.region ? ` (${after.region})` : ''}`;
        say('validity_overlap', pack.defaults.includes(after) ? 'defaults.json' : 'grid.json',
          `${where} from ${after.valid_from} starts before the value from ${before.valid_from} ends; close that one with valid_to ${after.valid_from}`);
      }
    }
  }
  return problems;
}

/** The problems only the whole checkout shows: two packs on one seed number, one code claimed twice. */
export function checkAcross(packs: Pack[]): Problem[] {
  const problems: Problem[] = [];
  const claim = (kind: string, owners: Map<string, string>, code: string, slug: string, name = 'code_taken') => {
    const other = owners.get(code);
    if (other !== undefined && other !== slug) problems.push({ code: name, detail: `packs/${slug}: ${kind} ${code} is already published by packs/${other}` });
    else owners.set(code, slug);
  };
  const sequences = new Map<string, string>();
  const sources = new Map<string, string>();
  const schemes = new Map<string, string>();
  const operators = new Map<string, string>();
  for (const pack of packs) {
    claim('seed_sequence', sequences, String(pack.manifest.seed_sequence), pack.slug, 'seed_sequence_taken');
    pack.sources.forEach((s) => claim('source', sources, s.code, pack.slug));
    pack.identifiers.forEach((i) => claim('id scheme', schemes, i.code, pack.slug));
    (pack.grid?.operators ?? []).forEach((o) => claim('operator', operators, o.code, pack.slug));
  }
  return problems;
}

function unique(codes: string[], twice: (code: string) => void): void {
  const seen = new Set<string>();
  for (const code of codes) {
    if (seen.has(code)) twice(code);
    seen.add(code);
  }
}

function compiles(pattern: string): boolean {
  try {
    new RegExp(pattern, 'u');
    return true;
  } catch {
    return false;
  }
}

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
