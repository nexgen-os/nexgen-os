/**
 * The command line: `init`, `migrate`, `doctor`, `status`.
 *
 * Arguments are parsed by hand — `--flag value`, `--flag=value` and
 * switches — because this program is handed a database password, and every
 * dependency it pulls in could read it. Its one runtime dependency is the
 * Postgres driver. Unknown flags are refused rather than ignored.
 */
import { readFile } from 'node:fs/promises';
import { readCatalogue, type Step } from './catalogue.js';
import { doctor, status, type DoctorReport, type StatusReport } from './doctor.js';
import { install, migrate, postgisVersion, type InstallReport } from './engine.js';
import { NexgenError } from './errors.js';
import { connect, type SqlClient } from './sql.js';
import { PACKAGE_VERSION, SCHEMA_MIN, SCHEMA_VERSION } from './version.js';

const USAGE = `nexgen-os ${PACKAGE_VERSION} — install and operate Nexgen OS on a Postgres database with PostGIS

Usage:
  nexgen-os init     [--modules a,b] [--packs xx] [--dry-run]   install the core, modules and packs
  nexgen-os migrate  [--dry-run]                                 apply what is missing
  nexgen-os doctor   [--json]                                    say what is wrong, by name
  nexgen-os status   [--json]                                    version, modules, packs, counts

Options:
  --db <url>     the connection string (or NEXGEN_DB_URL); on Supabase, the session pooler or direct connection
  --ca <file>    the certificate authority to verify the server against
  --modules      modules to install, comma-separated (default: every module shipped)
  --packs        country packs to install, comma-separated (default: none)
  --version, --help
`;

const FLAGS: Record<string, 'value' | 'switch'> = {
  db: 'value',
  ca: 'value',
  modules: 'value',
  packs: 'value',
  'dry-run': 'switch',
  json: 'switch',
  help: 'switch',
  version: 'switch',
};

export interface Args {
  command: string | undefined;
  flags: Map<string, string | true>;
}

export function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string | true>();
  let command: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith('--')) {
      if (command !== undefined) throw new NexgenError('usage', `unexpected argument ${token}`);
      command = token;
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
  return { command, flags };
}

const list = (v: string | true | undefined): string[] | undefined =>
  typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

/** Said once, after an init that installed something: where the foundation's team can be reached. */
const HELP_LINE =
  'Nexgen OS is the base of Nexgen, WeSmart\'s platform. For results rather than a database: https://nexgen.wesmart.com — for help on the foundation (install, modules, packs, integrations): https://wesmart.com/nexgen';

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

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
  env: Record<string, string | undefined>;
  /** Opens the database; `connect` by default, PGlite in the tests. */
  open?: (url: string, ca?: string) => Promise<SqlClient>;
}

/** Runs one command and returns the exit code. */
export async function main(argv: string[], io: Io): Promise<number> {
  try {
    const { command, flags } = parseArgs(argv);
    if (flags.has('version')) {
      io.out(PACKAGE_VERSION);
      return 0;
    }
    if (flags.has('help') || command === undefined || command === 'help') {
      io.out(USAGE);
      return command === undefined && !flags.has('help') ? 1 : 0;
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
    if (error instanceof NexgenError) {
      io.err(error.message);
      return error.code === 'usage' ? 2 : 1;
    }
    io.err(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
