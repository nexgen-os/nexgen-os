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
 * - a frame of projects cites its text, a municipality is under a declared
 *   region, and a density class is one the pack lists (whether a kind,
 *   a segment or a device type exists, the database says when the seed
 *   is applied: the core's vocabularies are its seed's, not a list here);
 * - across packs: one seed number and one code per row.
 */
import type { Problem } from '../doctor.js';
import type { Pack, PackDefault } from './read.js';

/** The attribute type the density classes of municipalities.json are compiled into. */
export const DENSITY_CLASS_ATTRIBUTE_TYPE = 'density_class';

/** The region code of a municipality: the country, a hyphen, its own code. */
export function municipalityRegion(country: string, code: string): string {
  return `${country}-${code}`;
}

/** The attribute type the voltage levels of grid.json are compiled into. */
export const VOLTAGE_LEVELS_ATTRIBUTE_TYPE = 'voltage_levels';
export const VOLTAGE_UNIT = 'KiloV';

/**
 * Every value of a pack that lands in `defaults`: defaults.json, the density
 * classes of municipalities.json, then the thresholds and voltage levels of
 * grid.json.
 */
export function valuesOf(pack: Pack): PackDefault[] {
  const grid = pack.grid;
  const levels = grid?.voltage_levels;
  const density = pack.municipalities?.density_classes;
  return [
    ...pack.defaults,
    ...(density
      ? (pack.municipalities?.municipalities ?? [])
          .filter((m) => m.density_class !== undefined)
          .map((m) => ({
            attribute_type: DENSITY_CLASS_ATTRIBUTE_TYPE,
            region: municipalityRegion(pack.manifest.country, m.code),
            value: m.density_class,
            unit: 'code',
            source_code: density.source_code,
            reference: density.reference,
            valid_from: density.valid_from,
            ...(density.valid_to ? { valid_to: density.valid_to } : {}),
          }))
      : []),
    ...(grid?.thresholds ?? []),
    ...(levels
      ? [{
          attribute_type: VOLTAGE_LEVELS_ATTRIBUTE_TYPE,
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
    if (code !== undefined && !regions.has(code) && !municipalities.has(code)) {
      say('region_undeclared', file, `${where} names ${code}, which neither identity.regions nor municipalities.json declares`);
    }
  };
  const municipalities = new Set((pack.municipalities?.municipalities ?? []).map((m) => municipalityRegion(manifest.country, m.code)));
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
  const sources = new Set(pack.sources.map((s) => s.code));
  const cite = (file: string, where: string, code: string) => {
    if (!sources.has(code)) say('source_undeclared', file, `${where} cites ${code}, which sources.json does not declare`);
  };

  // Frames of projects: one code each, citing its text.
  unique(pack.project_kinds.map((k) => k.code), (code) => say('duplicate_code', 'project_kinds.json', `${code} twice`));
  for (const kind of pack.project_kinds) {
    if (kind.parent === kind.code) say('project_kind_own_parent', 'project_kinds.json', `${kind.code} refines itself`);
    cite('project_kinds.json', `project kind ${kind.code}`, kind.source_code);
  }

  // Municipalities: under a declared region, with a class the pack lists.
  if (pack.municipalities !== null) {
    const list = pack.municipalities;
    const classes = new Set(list.density_classes?.classes ?? []);
    cite('municipalities.json', 'the list', list.source_code);
    if (list.density_classes) cite('municipalities.json', 'density_classes', list.density_classes.source_code);
    if (identity.municipality_scheme === undefined) say('municipality_scheme_required', 'pack.json', 'municipalities.json lists municipalities: identity.municipality_scheme names their scheme');
    const scheme = pack.identifiers.find((i) => i.code === identity.municipality_scheme);
    unique(list.municipalities.map((m) => m.code), (code) => say('duplicate_code', 'municipalities.json', `${code} twice`));
    for (const m of list.municipalities) {
      if (!regions.has(m.parent)) say('region_undeclared', 'municipalities.json', `${m.code} is under ${m.parent}, which identity.regions does not declare`);
      if (scheme?.pattern !== undefined && compiles(scheme.pattern) && !new RegExp(scheme.pattern, 'u').test(m.code)) {
        say('invalid_identifier', 'municipalities.json', `${m.code} is not a valid ${scheme.code}`);
      }
      if (m.density_class !== undefined && !classes.has(m.density_class)) {
        say('density_class_unknown', 'municipalities.json', `${m.code} is of class ${m.density_class}, which density_classes.classes does not list`);
      }
    }
  }

  // Grid.
  if (pack.grid !== null) {
    const grid = pack.grid;
    unique(grid.operators.map((o) => o.code), (code) => say('duplicate_code', 'grid.json', `operator ${code} twice`));
    grid.operators.forEach((o) => (o.regions ?? []).forEach((r) => region('grid.json', `operator ${o.code}`, r)));
    grid.operators.forEach((o) => (o.municipalities ?? []).forEach((r) => {
      if (!municipalities.has(r)) say('region_undeclared', 'grid.json', `operator ${o.code} serves ${r}, which municipalities.json does not declare`);
    }));
    if (grid.operators.length > 0 && !(manifest.modules ?? []).includes('grid')) {
      say('module_required', 'pack.json', 'grid.json lists operators, which live in the grid module: add "grid" to modules');
    }
    const schemes = grid.support_schemes ?? [];
    unique(schemes.map((x) => x.code), (code) => say('duplicate_code', 'grid.json', `support scheme ${code} twice`));
    for (const x of schemes) {
      cite('grid.json', `support scheme ${x.code}`, x.source_code);
      (x.negative_price_rules ?? []).forEach((r) => {
        if (r.source_code !== undefined) cite('grid.json', `support scheme ${x.code}, rule from ${r.valid_from}`, r.source_code);
        if (r.valid_to !== undefined && r.valid_to <= r.valid_from) say('validity_invalid', 'grid.json', `support scheme ${x.code}, rule from ${r.valid_from}: valid_to is not after valid_from`);
      });
      if (x.min_power_kw !== undefined && x.max_power_kw !== undefined && x.min_power_kw > x.max_power_kw) {
        say('power_range_invalid', 'grid.json', `support scheme ${x.code}: ${x.min_power_kw} kW is above ${x.max_power_kw} kW`);
      }
    }
    if (schemes.length > 0 && !(manifest.modules ?? []).includes('grid')) {
      say('module_required', 'pack.json', 'grid.json lists support schemes, which live in the grid module: add "grid" to modules');
    }
    const levels = grid.voltage_levels?.levels ?? [];
    unique(levels.map((l) => l.code), (code) => say('duplicate_code', 'grid.json', `voltage level ${code} twice`));
    for (const level of levels) {
      if (level.min_kv >= level.max_kv) say('voltage_range_invalid', 'grid.json', `voltage level ${level.code}: ${level.min_kv} kV is not below ${level.max_kv} kV`);
    }
  }

  // Values: cited from the pack's own sources, dated, never two at once for one place and one condition.
  const classes = new Set(pack.municipalities?.density_classes?.classes ?? []);
  const periods = new Map<string, PackDefault[]>();
  for (const value of valuesOf(pack)) {
    const file = fileOf(pack, value);
    const name = `${value.attribute_type}${where(value)} from ${value.valid_from}`;
    region(file, name, value.region);
    if (!sources.has(value.source_code)) say('source_undeclared', file, `${name} cites ${value.source_code}, which sources.json does not declare`);
    if (value.valid_to !== undefined && value.valid_to <= value.valid_from) say('validity_invalid', file, `${name}: valid_to ${value.valid_to} is not after valid_from`);
    const density = value.condition?.density_class;
    if (density !== undefined && !classes.has(density)) {
      say('density_class_unknown', file, `${name} holds for ${density}, which municipalities.json density_classes.classes does not list`);
    }
    const key = `${value.attribute_type}|${value.region ?? ''}|${conditionOf(value)}`;
    periods.set(key, [...(periods.get(key) ?? []), value]);
  }
  for (const rows of periods.values()) {
    const sorted = [...rows].sort((a, b) => (a.valid_from < b.valid_from ? -1 : a.valid_from > b.valid_from ? 1 : 0));
    for (let i = 1; i < sorted.length; i += 1) {
      const before = sorted[i - 1]!;
      const after = sorted[i]!;
      if (before.valid_to === undefined || after.valid_from < before.valid_to) {
        say('validity_overlap', fileOf(pack, after),
          `${after.attribute_type}${where(after)} from ${after.valid_from} starts before the value from ${before.valid_from} ends; close that one with valid_to ${after.valid_from}`);
      }
    }
  }
  return problems;
}

/** The condition a value holds for, as one key: its criteria in the order of their names. */
export function conditionOf(value: PackDefault): string {
  const c = value.condition ?? {};
  return JSON.stringify(Object.fromEntries(Object.entries(c).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
}

/** ` (FR-75, fr_acc, rural_town)`: the place and the condition of a value, for a message. */
function where(value: PackDefault): string {
  const c = value.condition ?? {};
  const attribute = c.attribute ? `${c.attribute.attribute_type} ${c.attribute.op} ${c.attribute.value}` : undefined;
  const parts = [value.region, c.project_kind, c.segment, c.device_type, c.density_class, attribute].filter((p) => p !== undefined);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

function fileOf(pack: Pack, value: PackDefault): string {
  if (pack.defaults.includes(value)) return 'defaults.json';
  return value.attribute_type === DENSITY_CLASS_ATTRIBUTE_TYPE ? 'municipalities.json' : 'grid.json';
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
  const kinds = new Map<string, string>();
  const support = new Map<string, string>();
  for (const pack of packs) {
    claim('seed_sequence', sequences, String(pack.manifest.seed_sequence), pack.slug, 'seed_sequence_taken');
    pack.sources.forEach((s) => claim('source', sources, s.code, pack.slug));
    pack.identifiers.forEach((i) => claim('id scheme', schemes, i.code, pack.slug));
    (pack.grid?.operators ?? []).forEach((o) => claim('operator', operators, o.code, pack.slug));
    pack.project_kinds.forEach((k) => claim('project kind', kinds, k.code, pack.slug));
    (pack.grid?.support_schemes ?? []).forEach((x) => claim('support scheme', support, x.code, pack.slug));
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
