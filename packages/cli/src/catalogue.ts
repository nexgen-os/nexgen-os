/**
 * What a release ships, read from disk, and the order it is applied in.
 *
 * The core's migrations, then the core's seed, then each module asked for
 * (a folder of `modules/` with its `module.json`, its migrations in order), then each pack asked for (its seed in order).
 * A pack's seed is the file `nexgen-os pack build` compiles beside the
 * core's, `supabase/seed/<n>_pack_<cc>.sql`; a compiled seed is never part of
 * the core.
 * Every file is a step with a scope and a name — its path in the release —
 * which is what `schema_migrations` records. `plan()` is pure: given what
 * ships, what is asked and what is recorded, it says what to apply.
 */
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NexgenError } from './errors.js';

export interface Step {
  /** The path of the file in the release, `modules/solar/supabase/migrations/0001_solar.sql`: the key of the record. */
  name: string;
  /** `core`, `module:<code>` or `pack:<country code>`. */
  scope: string;
}

export interface Pack {
  code: string;
  /** Modules whose tables the pack's rows go into. */
  modules: string[];
  steps: Step[];
}

export interface Catalogue {
  /** The directory the names are relative to. */
  root: string;
  core: Step[];
  /** Modules with migrations, by code, in the order they are applied. */
  modules: Map<string, Step[]>;
  /** The schema each module creates, by code, as its `module.json` says. */
  schemas: Map<string, string>;
  /** The code a module carried in an earlier release, mapped to its code now (`formerly` in `module.json`). */
  formerly: Map<string, string>;
  packs: Map<string, Pack>;
}

/**
 * Where the files are: `assets/` beside `dist/` once the package is built
 * and published, the repository itself when run from a clone.
 */
export function defaultRoot(): string {
  const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
  const assets = join(pkg, 'assets');
  return existsSync(join(assets, 'supabase', 'migrations')) ? assets : join(pkg, '..', '..');
}

async function sqlSteps(root: string, dir: string, scope: string): Promise<Step[]> {
  if (!existsSync(join(root, dir))) return [];
  const names = (await readdir(join(root, dir))).filter((f) => f.endsWith('.sql')).sort();
  return names.map((n) => ({ name: `${dir}/${n}`, scope }));
}

async function folders(root: string, dir: string): Promise<string[]> {
  if (!existsSync(join(root, dir))) return [];
  const entries = await readdir(join(root, dir), { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

/** Reads what ships under `root`. */
export async function readCatalogue(root: string = defaultRoot()): Promise<Catalogue> {
  const seeds = await sqlSteps(root, 'supabase/seed', 'core');
  const packSeed = (s: Step) => /^supabase\/seed\/\d+_pack_([a-z]{2})\.sql$/.exec(s.name)?.[1];
  const core = [...(await sqlSteps(root, 'supabase/migrations', 'core')), ...seeds.filter((s) => packSeed(s) === undefined)];
  const modules = new Map<string, Step[]>();
  const schemas = new Map<string, string>();
  const formerly = new Map<string, string>();
  for (const code of await folders(root, 'modules')) {
    // A module is a folder with a manifest, `modules/<code>/module.json`
    // (modules/schema/module.1.json); `modules/schema/` is not one.
    const manifest = join(root, 'modules', code, 'module.json');
    if (!existsSync(manifest)) continue;
    const steps = await sqlSteps(root, `modules/${code}/supabase/migrations`, `module:${code}`);
    if (steps.length === 0) continue;
    modules.set(code, steps);
    const json = JSON.parse(await readFile(manifest, 'utf8')) as { schema?: string; formerly?: string[] };
    if (json.schema) schemas.set(code, json.schema);
    for (const old of json.formerly ?? []) formerly.set(old, code);
  }
  const packs = new Map<string, Pack>();
  for (const code of await folders(root, 'packs')) {
    const steps = seeds.filter((s) => packSeed(s) === code).map((s) => ({ ...s, scope: `pack:${code}` }));
    if (steps.length === 0) continue;
    const manifest = join(root, 'packs', code, 'pack.json');
    const json = existsSync(manifest) ? (JSON.parse(await readFile(manifest, 'utf8')) as { modules?: string[] }) : {};
    packs.set(code, { code, modules: json.modules ?? [], steps });
  }
  return { root, core, modules, schemas, formerly, packs };
}

/** The SQL of a step. */
export function readStep(catalogue: Catalogue, step: Step): Promise<string> {
  return readFile(join(catalogue.root, step.name), 'utf8');
}

export interface Selection {
  modules: string[];
  packs: string[];
}

export interface Plan {
  /** Every step of the selection, in the order it is applied. */
  steps: Step[];
  /** The steps not recorded yet: what a run applies. */
  pending: Step[];
}

/**
 * The steps of a selection, in order, and those not yet recorded. Modules
 * come in the catalogue's order whatever the order asked, packs after every
 * module; a pack needing a module that is neither asked nor installed is
 * refused by name.
 */
export function plan(catalogue: Catalogue, selection: Selection, recorded: ReadonlySet<string>): Plan {
  for (const m of selection.modules) {
    if (!catalogue.modules.has(m)) {
      throw new NexgenError('unknown_module', `${m}; shipped: ${[...catalogue.modules.keys()].join(', ') || 'none'}`);
    }
  }
  for (const p of selection.packs) {
    if (!catalogue.packs.has(p)) {
      throw new NexgenError('unknown_pack', `${p}; shipped: ${[...catalogue.packs.keys()].join(', ') || 'none'}`);
    }
  }
  const installed = new Set([...recorded].map((name) => name.match(/^modules\/([^/]+)\//)?.[1]).filter(Boolean));
  const modules = [...catalogue.modules.keys()].filter((m) => selection.modules.includes(m));
  for (const p of selection.packs) {
    for (const m of catalogue.packs.get(p)!.modules) {
      if (!modules.includes(m) && !installed.has(m)) {
        throw new NexgenError('pack_requires_module', `pack ${p} needs module ${m}; add it to --modules`);
      }
    }
  }
  const packs = [...catalogue.packs.keys()].filter((p) => selection.packs.includes(p));
  const steps = [
    ...catalogue.core,
    ...modules.flatMap((m) => catalogue.modules.get(m)!),
    ...packs.flatMap((p) => catalogue.packs.get(p)!.steps),
  ];
  return { steps, pending: steps.filter((s) => !recorded.has(s.name)) };
}

/** The modules and packs a set of recorded steps says are installed. */
export function installedScopes(scopes: Iterable<string>): Selection {
  const modules = new Set<string>();
  const packs = new Set<string>();
  for (const s of scopes) {
    if (s.startsWith('module:')) modules.add(s.slice('module:'.length));
    if (s.startsWith('pack:')) packs.add(s.slice('pack:'.length));
  }
  return { modules: [...modules].sort(), packs: [...packs].sort() };
}
