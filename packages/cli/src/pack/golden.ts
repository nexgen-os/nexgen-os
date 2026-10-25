/**
 * `packs/<cc>/golden/<case>/` — complete cases of a country, one per kind of
 * project, each a small scenario and the figures a correct installation
 * must find from it.
 *
 * A pack is data, and data that compiles says nothing about whether the
 * functions that read it give the right answer: a perimeter that takes the
 * wrong distance, a default resolved at the wrong level, a share computed
 * on the wrong offtake agree with each other and every seed builds. A
 * golden case is the second opinion: an organisation, a project of a kind,
 * its participants with their segment and municipality, their meters and
 * devices, a few hours of series (`scenario.json`), and beside it what the
 * model must answer, each figure with where it comes from and the
 * tolerance it is held to (`expectations.json`).
 *
 * One test (`tests/golden.test.ts`) replays every case of every pack
 * through the real functions; nothing in it knows a country, so a new pack
 * only adds files. `nexgen-os pack check` reads the cases without a
 * database: their shape, the references between the two files, the country
 * and the frame of the project, a source on every expectation, a tolerance
 * on every figure. A pack carries at least one case, or says in
 * `pack.json` why it cannot (`"golden": {"exempt": "…"}`).
 *
 * What a case proves is that the installation agrees with figures worked
 * out by hand from the pack's own values; it is not a legal opinion, which
 * is what the source on every value and the certification of the pack are for.
 */
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Problem } from '../doctor.js';
import { executableContent } from './executable.js';

/** An object of a case: `project`, or a kind and the `ref` the scenario gives it (`participant:plant`, `meter:plant`, `device:pv`). */
export type GoldenObject = string;

export interface GoldenPlace {
  country: string;
  region?: string;
  municipality?: string;
  /** A GeoJSON point, longitude and latitude in WGS 84. */
  geometry?: { type: 'Point'; coordinates: [number, number] };
}

export interface GoldenScenario {
  name: string;
  description: string;
  /** The period the series cover, `[from, to)`, and their step (a Postgres interval). */
  period: { from: string; to: string; step: string };
  organisation: string;
  /** The frame of the project (project_kinds), absent when it has none. */
  project: { name: string; kind?: string; country: string };
  substations?: { ref: string; operator: string; code: string; name: string }[];
  participants: {
    ref: string;
    name: string;
    category: 'producer' | 'consumer' | 'prosumer';
    segment?: string;
    place: GoldenPlace;
    meters?: { ref: string; identifier: string; scheme: string; operator?: string; substation?: string }[];
    devices?: { ref: string; type: string; name: string; rated_power_kw?: number; battery?: Record<string, unknown> }[];
  }[];
  /** Attributes of the objects of the case, each with where it comes from. */
  attributes?: { object: GoldenObject; attribute_type: string; value: unknown; valid_from?: string; valid_to?: string; source: string }[];
  /** One value per step of the period, from its start. */
  series?: { object: GoldenObject; quantity: string; kind?: 'measured' | 'simulated'; values: number[]; source?: string }[];
  /** The hours a PV yield is computed on: plane-of-array irradiance (W/m²), air temperature (°C), wind (m/s). */
  solar?: { device: string; profile: string; kwp: number; gamma_pdc: number; hours: { poa: number; temperature: number; wind: number }[]; source: string };
}

interface Sourced {
  /** Where the expected figure comes from: the pack's row, the text, the hand computation. */
  source: string;
}

export interface GoldenExpectations {
  defaults?: (Sourced & {
    object: GoldenObject;
    attribute_type: string;
    at: string;
    value?: unknown;
    refusal?: string;
    level?: string;
    region?: string;
    country?: string;
    conditions?: Record<string, unknown>;
    source_code?: string;
  })[];
  batteries?: (Sourced & { device: string; at: string; figures: Record<string, Record<string, unknown>> })[];
  perimeter?: Sourced & {
    on: string;
    refusal?: string;
    rule?: Record<string, unknown>;
    participants?: Record<string, { in_perimeter: boolean | null; criteria?: Record<string, unknown>[] }>;
    /** Metres a distance may differ by: the places are points on the ellipsoid, the figure is worked out on a sphere. */
    tolerance_m?: number;
  };
  operators?: (Sourced & { meter: string; operator?: string; by?: string; region?: string; refusal?: string })[];
  settlement?: Sourced & {
    engine: string;
    shared_kwh: number;
    participants: Record<string, { shared_offtake_energy: number; shared_injection_energy: number }>;
    tolerance_kwh: number;
  };
  solar?: Sourced & { energy_kwh: number; tolerance_pct: number };
  kpis?: (Sourced & {
    object: GoldenObject;
    indicator: string;
    value?: number;
    refusal?: string;
    tolerance?: number;
    read?: Record<string, string>;
    /** `settlement`: read once the case's sharing is settled. */
    after?: 'settlement';
  })[];
}

export interface GoldenCase {
  /** The folder of the case, `packs/<cc>/golden/<name>/`. */
  name: string;
  scenario: GoldenScenario;
  expectations: GoldenExpectations;
}

export const GOLDEN_DIR = 'golden';
const CASE_NAME = /^[a-z0-9][a-z0-9_]*$/;
const FIGURE_SECTIONS = ['settlement', 'solar'] as const;

/** The cases of a pack, and what is wrong with them. A pack without cases is a problem unless its manifest says why. */
export async function readGoldens(
  root: string,
  slug: string,
  context: { country: string; frames: string[]; exempt: string | null },
): Promise<{ cases: GoldenCase[]; problems: Problem[] }> {
  const dir = join(root, 'packs', slug, GOLDEN_DIR);
  const problems: Problem[] = [];
  const say = (code: string, detail: string) => problems.push({ code, detail: `packs/${slug}/${GOLDEN_DIR}/${detail}` });
  const present = existsSync(dir) ? (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort() : [];
  if (present.length === 0) {
    if (!context.exempt) {
      problems.push({ code: 'golden_missing', detail: `packs/${slug}: carries no golden case and gives no reason; add packs/${slug}/golden/<case>/ or "golden": {"exempt": "…"} to pack.json` });
    }
    return { cases: [], problems };
  }
  if (context.exempt) problems.push({ code: 'golden_exempt_and_present', detail: `packs/${slug}/pack.json: claims an exemption and the pack carries golden cases; drop one of the two` });

  const cases: GoldenCase[] = [];
  for (const name of present) {
    if (!CASE_NAME.test(name)) say('golden_name_invalid', `${name}: a case is named in lower case, digits and underscores`);
    const files: Record<string, unknown> = {};
    for (const file of ['scenario.json', 'expectations.json']) {
      const path = join(dir, name, file);
      if (!existsSync(path)) {
        say('golden_file_missing', `${name}/${file}: a case holds a scenario and its expectations`);
        continue;
      }
      try {
        files[file] = JSON.parse(await readFile(path, 'utf8'));
      } catch (error) {
        say('golden_json_invalid', `${name}/${file}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      for (const found of executableContent(files[file])) say('pack_executable', `${name}/${file}: ${found}`);
    }
    const scenario = files['scenario.json'] as GoldenScenario | undefined;
    const expectations = files['expectations.json'] as GoldenExpectations | undefined;
    if (!scenario || !expectations) continue;
    const before = problems.length;
    checkCase(name, scenario, expectations, context, say);
    if (problems.length === before) cases.push({ name, scenario, expectations });
  }
  return { cases, problems };
}

function checkCase(
  name: string,
  s: GoldenScenario,
  e: GoldenExpectations,
  context: { country: string; frames: string[] },
  say: (code: string, detail: string) => void,
): void {
  const at = (what: string) => `${name}/${what}`;
  for (const key of ['name', 'description', 'organisation'] as const) {
    if (typeof s[key] !== 'string' || s[key].trim() === '') say('golden_scenario_invalid', at(`scenario.json: ${key} is required`));
  }
  if (!s.period?.from || !s.period?.to || !s.period?.step) say('golden_scenario_invalid', at('scenario.json: period {from, to, step} is required'));
  if (!s.project?.name) say('golden_scenario_invalid', at('scenario.json: project {name, country} is required, and its kind when it has a frame'));
  if (s.project?.country !== context.country) say('golden_country_mismatch', at(`scenario.json: the project is in ${s.project?.country}, the pack is ${context.country}`));
  // A frame of the country is the pack's; any other kind is the core's, which the database checks.
  const prefix = `${context.country.toLowerCase()}_`;
  if (s.project?.kind?.startsWith(prefix) && !context.frames.includes(s.project.kind)) {
    say('golden_frame_unknown', at(`scenario.json: ${s.project.kind} is not a frame of projects of the pack`));
  }
  if (!Array.isArray(s.participants) || s.participants.length === 0) say('golden_scenario_invalid', at('scenario.json: a case has participants'));

  const refs = new Set<string>(['project']);
  const add = (kind: string, ref: string) => {
    const key = `${kind}:${ref}`;
    if (refs.has(key)) say('golden_ref_duplicated', at(`scenario.json: ${key} is given twice`));
    refs.add(key);
  };
  for (const st of s.substations ?? []) add('substation', st.ref);
  for (const p of s.participants ?? []) {
    add('participant', p.ref);
    if (p.place?.country !== context.country) say('golden_country_mismatch', at(`scenario.json: participant ${p.ref} is in ${p.place?.country}`));
    for (const m of p.meters ?? []) {
      add('meter', m.ref);
      if (m.substation && !refs.has(`substation:${m.substation}`)) say('golden_ref_unknown', at(`scenario.json: meter ${m.ref} names substation ${m.substation}`));
    }
    for (const d of p.devices ?? []) add('device', d.ref);
  }
  const known = (file: string, object: string) => {
    if (!refs.has(object)) say('golden_ref_unknown', at(`${file}: ${object} is not an object of the scenario`));
  };
  const steps = (() => {
    const from = Date.parse(s.period?.from ?? '');
    const to = Date.parse(s.period?.to ?? '');
    const hours = /^(\d+) hours?$/.exec(s.period?.step ?? '');
    const minutes = /^(\d+) minutes?$/.exec(s.period?.step ?? '');
    const ms = hours ? Number(hours[1]) * 3_600_000 : minutes ? Number(minutes[1]) * 60_000 : NaN;
    return Number.isFinite(from) && Number.isFinite(to) && ms > 0 ? (to - from) / ms : NaN;
  })();
  for (const a of s.attributes ?? []) {
    known('scenario.json', a.object);
    if (!a.source) say('golden_source_missing', at(`scenario.json: attribute ${a.attribute_type} of ${a.object} says where it comes from`));
  }
  for (const x of s.series ?? []) {
    known('scenario.json', x.object);
    if (Number.isFinite(steps) && x.values.length !== steps) say('golden_series_misaligned', at(`scenario.json: ${x.quantity} of ${x.object} has ${x.values.length} values for ${steps} steps`));
  }
  if (s.solar) {
    known('scenario.json', `device:${s.solar.device}`);
    if (!s.solar.source) say('golden_source_missing', at('scenario.json: solar says where its hours come from'));
  }

  const sourced = (what: string, x: { source?: string }) => {
    if (typeof x.source !== 'string' || x.source.trim() === '') say('golden_source_missing', at(`expectations.json: ${what} says where its figure comes from`));
  };
  for (const d of e.defaults ?? []) {
    known('expectations.json', d.object);
    sourced(`default ${d.attribute_type} of ${d.object}`, d);
    if (d.refusal === undefined && d.level === undefined) say('golden_expectation_invalid', at(`expectations.json: default ${d.attribute_type} of ${d.object} names its level or its refusal`));
  }
  for (const b of e.batteries ?? []) {
    known('expectations.json', `device:${b.device}`);
    sourced(`battery ${b.device}`, b);
  }
  if (e.perimeter) {
    sourced('perimeter', e.perimeter);
    for (const ref of Object.keys(e.perimeter.participants ?? {})) known('expectations.json', `participant:${ref}`);
    const distances = Object.values(e.perimeter.participants ?? {}).some((p) => (p.criteria ?? []).some((c) => 'distance_m' in c));
    if (distances && e.perimeter.tolerance_m === undefined) say('golden_tolerance_missing', at('expectations.json: perimeter gives distances and no tolerance_m'));
  }
  for (const o of e.operators ?? []) {
    known('expectations.json', `meter:${o.meter}`);
    sourced(`operator of ${o.meter}`, o);
  }
  for (const section of FIGURE_SECTIONS) {
    const x = e[section];
    if (!x) continue;
    sourced(section, x);
    const tolerance = section === 'settlement' ? (x as GoldenExpectations['settlement'])!.tolerance_kwh : (x as GoldenExpectations['solar'])!.tolerance_pct;
    if (typeof tolerance !== 'number' || tolerance < 0) say('golden_tolerance_missing', at(`expectations.json: ${section} states its tolerance`));
  }
  if (e.solar && !s.solar) say('golden_expectation_invalid', at('expectations.json: a solar figure needs the solar hours of the scenario'));
  for (const ref of Object.keys(e.settlement?.participants ?? {})) known('expectations.json', `participant:${ref}`);
  for (const k of e.kpis ?? []) {
    known('expectations.json', k.object);
    sourced(`indicator ${k.indicator} of ${k.object}`, k);
    if (k.value !== undefined && (typeof k.tolerance !== 'number' || k.tolerance < 0)) {
      say('golden_tolerance_missing', at(`expectations.json: indicator ${k.indicator} of ${k.object} states its tolerance`));
    }
    if (k.value === undefined && k.refusal === undefined) say('golden_expectation_invalid', at(`expectations.json: indicator ${k.indicator} of ${k.object} gives a value or a refusal`));
    if (k.after === 'settlement' && !e.settlement) say('golden_expectation_invalid', at(`expectations.json: indicator ${k.indicator} of ${k.object} is read after a settlement the case does not expect`));
  }
}
