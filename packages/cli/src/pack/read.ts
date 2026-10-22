/**
 * Reading a pack: the folder `packs/<cc>/` of a checkout, its manifest and
 * its section files, validated against `packs/schema/pack.1.json`.
 *
 * Files in, a typed pack out, and every problem named: nothing here touches
 * a database or the network. A pack that fails the schema is returned with
 * its problems and without a value, because nothing downstream — the checks
 * between sections, the compiler — should reason about a shape the schema
 * refused.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Problem } from '../doctor.js';
import { NexgenError } from '../errors.js';
import { executableContent } from './executable.js';
import { deref, isObject, unsupportedKeywords, validate, type Issue, type Schema } from './schema.js';

export const SCHEMA_PATH = 'packs/schema/pack.1.json';
/** Where compiled seeds are written, beside the core's own seed (Ekwo OS's place). */
export const SEED_DIR = 'supabase/seed';
export const SECTIONS = ['identifiers', 'sources', 'grid', 'defaults'] as const;
export type Section = (typeof SECTIONS)[number];

export interface Certification {
  status: 'community' | 'maintained' | 'reviewed';
  reviewer?: string;
  date?: string;
}

export interface Region {
  code: string;
  name: string;
  parent?: string;
  time_zone?: string;
}

export interface Identity {
  currency: string;
  languages: string[];
  time_zones: string[];
  region_level: string;
  postal_code_pattern?: string;
  municipality_scheme?: string;
  regions: Region[];
}

export interface Manifest {
  country: string;
  name: string;
  version: string;
  checksum?: string;
  schema_min: string;
  seed_sequence: number;
  certification: Certification;
  modules?: string[];
  sections: Section[];
  identity: Identity;
}

export interface Identifier {
  code: string;
  name: string;
  description?: string;
  pattern?: string;
  example: string;
  url_template?: string;
  source_code?: string;
}

export interface Source {
  code: string;
  name: string;
  description?: string;
  kind: 'api' | 'file' | 'registry' | 'text';
  url: string;
  docs_url?: string;
  auth?: string;
  license: string;
  attribution?: string;
  redistributable: boolean;
  retention_days?: number;
  regions?: string[];
}

export interface Operator {
  code: string;
  name: string;
  kind: 'tso' | 'dso' | 'island';
  regions?: string[];
  coverage?: string;
  website?: string;
  data_hub_url?: string;
  identifier_scheme?: string;
  description?: string;
}

export interface PackDefault {
  property: string;
  region?: string;
  value: unknown;
  unit: string;
  source_code: string;
  reference: string;
  valid_from: string;
  valid_to?: string;
}

export interface VoltageLevels {
  levels: { code: string; name: string; min_kv: number; max_kv: number }[];
  source_code: string;
  reference: string;
  valid_from: string;
  valid_to?: string;
}

export interface Grid {
  operators: Operator[];
  voltage_levels?: VoltageLevels;
  thresholds?: PackDefault[];
}

export interface Pack {
  /** The folder name, the country code in lower case. */
  slug: string;
  manifest: Manifest;
  identifiers: Identifier[];
  sources: Source[];
  grid: Grid | null;
  defaults: PackDefault[];
  /** `sha256:…` of the JSON the seed is compiled from, the manifest's own checksum left out. */
  checksum: string;
  /** The JSON files read, in the order they enter the checksum. */
  files: string[];
}

export interface PackReading {
  slug: string;
  /** Absent when a problem stopped the reading. */
  pack?: Pack;
  problems: Problem[];
}

/** The published schema of a checkout, refused if it uses a keyword the validator would skip. */
export async function readSchema(root: string): Promise<Schema> {
  const path = join(root, SCHEMA_PATH);
  if (!existsSync(path)) throw new NexgenError('not_a_checkout', `${root} has no ${SCHEMA_PATH}; run pack commands from a clone of the repository or pass --root`);
  const schema = JSON.parse(await readFile(path, 'utf8')) as Schema;
  const unknown = unsupportedKeywords(schema);
  if (unknown.length > 0) throw new NexgenError('pack_schema_unsupported', `the validator does not check ${unknown.join(', ')}`);
  return schema;
}

/** The folders of `packs/` that hold a country: two lower-case letters. */
export async function packFolders(root: string): Promise<string[]> {
  const dir = join(root, 'packs');
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory() && /^[a-z]{2}$/.test(e.name)).map((e) => e.name).sort();
}

/** `supabase/seed/12_pack_xa.sql`, relative to the checkout. */
export function seedPath(manifest: Pick<Manifest, 'seed_sequence' | 'country'>): string {
  return `${SEED_DIR}/${manifest.seed_sequence}_pack_${manifest.country.toLowerCase()}.sql`;
}

/** Reads and validates `packs/<slug>/`. */
export async function readPack(root: string, slug: string, schema: Schema): Promise<PackReading> {
  const dir = join(root, 'packs', slug);
  const problems: Problem[] = [];
  const say = (code: string, detail: string) => problems.push({ code, detail: `packs/${slug}/${detail}` });

  const manifestRaw = await readJson(join(dir, 'pack.json'));
  if (manifestRaw.error !== undefined) {
    say('pack_json_invalid', `pack.json: ${manifestRaw.error}`);
    return { slug, problems };
  }
  for (const found of executableContent(manifestRaw.value)) say('pack_executable', `pack.json: ${found}`);
  const shape = validate(manifestRaw.value, schema, schema);
  for (const issue of shape) problems.push(schemaProblem(slug, 'pack.json', issue));
  // The sections are read even past a problem of the manifest, so that one
  // run names them all; only a manifest of the wrong shape says nothing of them.
  if (shape.length > 0) return { slug, problems };
  const manifest = manifestRaw.value as Manifest;

  if (manifest.country.toLowerCase() !== slug) say('country_mismatch', `pack.json: the folder ${slug} holds country ${manifest.country}`);

  // Every section listed is a file, and every JSON file is a section listed.
  const present = (await readdir(dir)).filter((f) => f.endsWith('.json') && f !== 'pack.json').sort();
  for (const section of manifest.sections) {
    if (!present.includes(`${section}.json`)) say('section_missing', `${section}.json: listed in sections and absent`);
  }
  for (const file of present) {
    if (!(manifest.sections as string[]).includes(file.replace(/\.json$/, ''))) say('file_unlisted', `${file}: present and not a section listed in pack.json`);
  }
  for (const required of ['sources', 'defaults'] as const) {
    if (!manifest.sections.includes(required)) say('section_required', `pack.json: every pack carries ${required}`);
  }

  const sections: Partial<Record<Section, unknown>> = {};
  for (const section of SECTIONS.filter((s) => manifest.sections.includes(s) && present.includes(`${s}.json`))) {
    const raw = await readJson(join(dir, `${section}.json`));
    if (raw.error !== undefined) {
      say('pack_json_invalid', `${section}.json: ${raw.error}`);
      continue;
    }
    for (const found of executableContent(raw.value)) say('pack_executable', `${section}.json: ${found}`);
    const sub = deref(`#/$defs/${section}_file`, schema);
    for (const issue of validate(raw.value, sub, schema)) problems.push(schemaProblem(slug, `${section}.json`, issue));
    sections[section] = raw.value;
  }
  if (problems.length > 0) return { slug, problems };

  const files = ['pack.json', ...SECTIONS.filter((s) => s in sections).map((s) => `${s}.json`)];
  const pack: Pack = {
    slug,
    manifest,
    identifiers: (sections.identifiers as { identifiers: Identifier[] } | undefined)?.identifiers ?? [],
    sources: (sections.sources as { sources: Source[] }).sources,
    grid: (sections.grid as Grid | undefined) ?? null,
    defaults: (sections.defaults as { defaults: PackDefault[] }).defaults,
    checksum: checksumOf(manifest, sections),
    files,
  };
  return { slug, pack, problems };
}

/**
 * The checksum of a pack: sha256 over each file's name and its JSON, parsed
 * and written again, so that indentation does not count and every value does.
 * The manifest enters without its own `checksum` and without `$schema`.
 */
export function checksumOf(manifest: Manifest, sections: Partial<Record<Section, unknown>>): string {
  const hash = createHash('sha256');
  const { checksum: _checksum, ...rest } = manifest;
  hash.update(`pack.json\n${JSON.stringify(withoutSchema(rest))}\n`);
  for (const section of SECTIONS) {
    if (sections[section] !== undefined) hash.update(`${section}.json\n${JSON.stringify(withoutSchema(sections[section]))}\n`);
  }
  return `sha256:${hash.digest('hex')}`;
}

/**
 * The manifest as `pack build` writes it back: the same fields in the same
 * order, the checksum right after the version.
 */
export function manifestWithChecksum(manifest: Manifest, checksum: string): string {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(manifest)) {
    if (key === 'checksum') continue;
    out[key] = value;
    if (key === 'version') out.checksum = checksum;
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

/**
 * A schema issue as a problem. A defaults row without its unit or its
 * reference has a name of its own, because it is the one omission a
 * contributor makes most and a reviewer looks for first.
 */
function schemaProblem(slug: string, file: string, issue: Issue): Problem {
  const isDefault = /^(defaults|thresholds)\[\d+\]$/.test(issue.path);
  if (isDefault && issue.keyword === 'required' && (issue.field === 'unit' || issue.field === 'reference')) {
    return { code: `default_without_${issue.field}`, detail: `packs/${slug}/${file}: ${issue.path} ${issue.message}` };
  }
  return { code: 'pack_schema_invalid', detail: `packs/${slug}/${file}: ${issue.path} ${issue.message}` };
}

function withoutSchema(value: unknown): unknown {
  if (!isObject(value)) return value;
  const { $schema: _schema, ...rest } = value;
  return rest;
}

async function readJson(path: string): Promise<{ value?: unknown; error?: string }> {
  if (!existsSync(path)) return { error: 'missing' };
  try {
    return { value: JSON.parse(await readFile(path, 'utf8')) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
