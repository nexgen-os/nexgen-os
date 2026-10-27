/**
 * The command line: `init`, `migrate`, `doctor`, `status` on a database;
 * `pack build` and `pack check` on the files of a checkout; the gestures of
 * the model as a person (`gestures.ts`), the same the MCP server offers.
 *
 * Arguments are parsed by hand — `--flag value`, `--flag=value` and
 * switches — because this program is handed a database password, and every
 * dependency it pulls in could read it. Its runtime dependencies are the
 * Postgres driver and the core of this project, with the format libraries
 * it reads. Unknown flags are refused rather than ignored.
 */
import { readFile } from 'node:fs/promises';
import { readCatalogue, type Step } from './catalogue.js';
import { doctor, status, type DoctorReport, type StatusReport } from './doctor.js';
import { install, migrate, postgisVersion, type InstallReport } from './apply.js';
import { NexgenError } from './errors.js';
import { buildPacks, checkPacks, type PackReport } from './pack/command.js';
import { GestureError, connect, type Computations, type SqlClient } from '@nexgen-os/core';
import { GESTURE_COMMANDS, GESTURE_FLAGS, GESTURE_USAGE, printGesture, runGesture } from './gestures.js';
import { PACKAGE_VERSION, SCHEMA_MIN, SCHEMA_VERSION } from './version.js';
import { printTry, tryInMemory } from './try.js';

const USAGE = `nexgen-os ${PACKAGE_VERSION} — install and operate Nexgen OS on a Postgres database with PostGIS

Usage:
  nexgen-os init     [--modules a,b] [--packs xx] [--dry-run]   install the core, modules and packs
  nexgen-os migrate  [--dry-run]                                 apply what is missing
  nexgen-os doctor   [--json]                                    say what is wrong, by name
  nexgen-os status   [--json]                                    version, modules, packs, counts
  nexgen-os pack build <cc>|--all [--root dir] [--json]          compile a pack into its seed (in a checkout)
  nexgen-os pack check <cc>|--all [--root dir] [--json]          refuse a pack or a seed that is not its output
  nexgen-os try      [--year yyyy] [--json]                      no database: a house and its yield, in memory

Options:
  --db <url>     the connection string (or NEXGEN_DB_URL); on Supabase, the session pooler or direct connection
  --ca <file>    the certificate authority to verify the server against
  --modules      modules to install, comma-separated (default: every module shipped)
  --packs        country packs to install, comma-separated (default: none)
  --all          every pack of the checkout (pack build, pack check)
  --year         the calendar year of the yield (try; default the last full one but two)
  --root <dir>   the checkout whose packs/ to read (default: the current directory)
  --version, --help
${GESTURE_USAGE}`;

const FLAGS: Record<string, 'value' | 'switch'> = {
  db: 'value',
  ca: 'value',
  modules: 'value',
  packs: 'value',
  'dry-run': 'switch',
  all: 'switch',
  root: 'value',
  json: 'switch',
  help: 'switch',
  version: 'switch',
  year: 'value',
  ...GESTURE_FLAGS,
};

export interface Args {
  command: string | undefined;
  /** What follows the command: `build xa` after `pack`. */
  operands: string[];
  flags: Map<string, string | true>;
}

export function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const body = token.slice(2);
    const eq = body.indexOf('=');
    const name = eq === -1 ? body : body.slice(0, eq);
    const kind = FLAGS[name];
    if (kind === undefined) throw new NexgenError('usage', `unknown flag --${name}`);
    if (kind === 'switch') {
      flags.set(name, true);
    } else if (eq !== -1) {
      flags.set(name, body.slice(eq + 1));
    } else {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new NexgenError('usage', `--${name} needs a value`);
      flags.set(name, next);
      i += 1;
    }
  }
  const [command, ...operands] = positional;
  if (command !== 'pack' && !(command !== undefined && command in GESTURE_COMMANDS) && operands.length > 0) {
    throw new NexgenError('usage', `unexpected argument ${operands[0]}`);
  }
  return { command, operands, flags };
}

const list = (v: string | true | undefined): string[] | undefined =>
  typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

/** Said once, after an init that installed something: what to do next. */
const HELP_LINE =
  'next: nexgen-os doctor, then as a person nexgen-os organisation create and key create, or a demo dataset (docs/demo/README.md); questions on the foundation go to the issues of its repository';

function printInstall(out: (line: string) => void, r: InstallReport): void {
  const verb = r.dryRun ? 'would apply' : 'applied';
  if (r.applied.length === 0) {
    out(`nothing to apply: ${r.skipped} step(s) already recorded`);
    return;
  }
  const byScope = new Map<string, Step[]>();
  for (const s of r.applied) byScope.set(s.scope, [...(byScope.get(s.scope) ?? []), s]);
  for (const [scope, steps] of byScope) out(`  ${scope}: ${steps.length}`);
  out(`${verb} ${r.applied.length} step(s), ${r.skipped} already recorded${r.dryRun ? ' — dry run, rolled back' : ''}`);
}

function printDoctor(out: (line: string) => void, r: DoctorReport): void {
  out(`schema version  ${r.schemaVersion ?? '-'} (this package: ${SCHEMA_VERSION}, floor ${SCHEMA_MIN})`);
  out(`postgis         ${r.postgis ?? '-'}`);
  out(`applied         ${Object.entries(r.applied).map(([s, n]) => `${s} ${n}`).join(', ') || '-'}`);
  out(`modules         ${r.modules.map((m) => `${m.code} ${m.version}`).join(', ') || '-'}`);
  out(`packs           ${r.packs.join(', ') || '-'}`);
  out(`vocabularies    ${Object.entries(r.vocabularies).map(([v, n]) => `${v} ${n}`).join(', ') || '-'}`);
  if (r.problems.length === 0) {
    out('no problem found');
    return;
  }
  out(`${r.problems.length} problem(s):`);
  for (const p of r.problems) out(`  ${p.code}: ${p.detail}`);
}

function printStatus(out: (line: string) => void, r: StatusReport): void {
  out(`Nexgen OS ${r.schemaVersion ?? 'not installed'}`);
  out(`modules        ${r.modules.join(', ') || '-'}`);
  out(`packs          ${r.packs.join(', ') || '-'}`);
  for (const [k, n] of Object.entries(r.counts)) out(`${k.padEnd(15)}${n ?? '-'}`);
}

const PACK_STATES: Record<PackReport['packs'][number]['state'], string> = {
  written: 'written',
  unchanged: 'already the output of its pack',
  up_to_date: 'the output of its pack',
  stale: 'not the output of its pack',
  refused: 'refused',
};

function printPacks(out: (line: string) => void, r: PackReport): void {
  for (const p of r.packs) {
    out(`  ${p.pack}  ${[p.version, p.file].filter(Boolean).join('  ')}${p.version || p.file ? '  ' : ''}${PACK_STATES[p.state]}`);
  }
  if (r.problems.length === 0) {
    out(r.action === 'build' ? 'built: no problem found' : 'no problem found');
    return;
  }
  out(`${r.problems.length} problem(s):`);
  for (const p of r.problems) out(`  ${p.code}: ${p.detail}`);
  if (r.action === 'check' && r.problems.some((p) => /^(seed_|checksum_)/.test(p.code))) out('run nexgen-os pack build --all and commit the result');
}

/** `pack build` and `pack check`: no database, so they run before a connection is asked for. */
async function packCommand(args: Args, io: Io): Promise<number> {
  const [action, pack, extra] = args.operands;
  if (action !== 'build' && action !== 'check') throw new NexgenError('usage', 'pack build <cc>|--all, or pack check <cc>|--all');
  if (extra !== undefined) throw new NexgenError('usage', `unexpected argument ${extra}`);
  const all = args.flags.has('all');
  if (all === (pack !== undefined)) throw new NexgenError('usage', `pack ${action} takes a pack or --all`);
  const root = (args.flags.get('root') as string | undefined) ?? process.cwd();
  const r = await (action === 'build' ? buildPacks : checkPacks)(root, { pack, all });
  if (args.flags.has('json')) io.out(JSON.stringify(r, null, 2));
  else printPacks(io.out, r);
  return r.problems.length > 0 ? 1 : 0;
}

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
  env: Record<string, string | undefined>;
  /** Opens the database; `connect` by default, PGlite in the tests. */
  open?: (url: string, ca?: string) => Promise<SqlClient>;
  /** The computations of the modules, for `size`: a checkout passes them (`modules/cli.ts`). */
  computations?: Computations;
  fetch?: typeof globalThis.fetch;
}

/** Runs one command and returns the exit code. */
export async function main(argv: string[], io: Io): Promise<number> {
  try {
    const args = parseArgs(argv);
    const { command, flags } = args;
    if (flags.has('version')) {
      io.out(PACKAGE_VERSION);
      return 0;
    }
    if (flags.has('help') || command === undefined || command === 'help') {
      io.out(USAGE);
      return command === undefined && !flags.has('help') ? 1 : 0;
    }
    if (command === 'pack') return await packCommand(args, io);
    if (command === 'try') {
      const year = flags.get('year');
      const r = await tryInMemory({ computations: io.computations, ...(typeof year === 'string' ? { year: Number(year) } : {}) });
      if (flags.has('json')) io.out(JSON.stringify(r, null, 2));
      else printTry(io.out, r);
      return 0;
    }
    if (command in GESTURE_COMMANDS) {
      const [first, second] = args.operands;
      const subs = GESTURE_COMMANDS[command]!;
      const sub = subs.includes(first ?? '') ? first || undefined : undefined;
      if (subs.length > 0 && !subs.includes(first ?? '')) throw new NexgenError('usage', `${command} ${subs.filter(Boolean).join('|')}`);
      const caFile = flags.get('ca') as string | undefined;
      const ca = caFile === undefined ? undefined : await readFile(caFile, 'utf8');
      const value = await runGesture(command, sub, sub === undefined ? first : second, flags, {
        env: io.env,
        open: (u) => (io.open ?? ((v, c) => connect(v, { ca: c })))(u, ca),
        ...(io.computations ? { computations: io.computations } : {}),
        ...(io.fetch ? { fetch: io.fetch } : {}),
      });
      if (flags.has('json')) io.out(JSON.stringify(value, null, 2));
      else printGesture(io.out, value);
      return 0;
    }
    if (!['init', 'migrate', 'doctor', 'status'].includes(command)) {
      throw new NexgenError('usage', `unknown command ${command}; run nexgen-os --help`);
    }
    const url = (flags.get('db') as string | undefined) ?? io.env.NEXGEN_DB_URL;
    if (!url) throw new NexgenError('db_url_required', 'pass --db <connection string> or set NEXGEN_DB_URL');
    const caFile = flags.get('ca') as string | undefined;
    const ca = caFile === undefined ? undefined : await readFile(caFile, 'utf8');
    const db = await (io.open ?? ((u, c) => connect(u, { ca: c })))(url, ca);
    try {
      const json = flags.has('json');
      const dryRun = flags.has('dry-run');
      const onStep = (s: Step): void => io.out(`  ${dryRun ? 'would apply' : 'applied'} ${s.name}`);
      switch (command) {
        case 'init': {
          const r = await install(db, { modules: list(flags.get('modules')), packs: list(flags.get('packs')), dryRun, onStep });
          printInstall(io.out, r);
          if (!dryRun && r.applied.length > 0) io.out(HELP_LINE);
          return 0;
        }
        case 'migrate': {
          printInstall(io.out, await migrate(db, { dryRun, onStep }));
          return 0;
        }
        case 'doctor': {
          const r = await doctor(db, await readCatalogue());
          if (json) io.out(JSON.stringify(r, null, 2));
          else printDoctor(io.out, r);
          return r.problems.length > 0 ? 1 : 0;
        }
        default: {
          const r = await status(db);
          if (json) io.out(JSON.stringify({ ...r, postgis: await postgisVersion(db) }, null, 2));
          else printStatus(io.out, r);
          return 0;
        }
      }
    } finally {
      await db.close();
    }
  } catch (error) {
    if (error instanceof GestureError) {
      io.err(error.hint === undefined ? error.message : `${error.message}\n${error.hint}`);
      return 1;
    }
    if (error instanceof NexgenError) {
      io.err(error.message);
      return error.code === 'usage' ? 2 : 1;
    }
    io.err(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
