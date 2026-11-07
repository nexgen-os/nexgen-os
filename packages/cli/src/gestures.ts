/**
 * The gestures of the model as commands — the same functions the MCP server
 * calls (`@nexgen-os/core`, `gestures.ts`), so a command and a tool cannot
 * disagree (decision 0046).
 *
 * `init`, `migrate` and `doctor` run as the owner of the database, because
 * they install it. These commands do not: each runs as a person — a key
 * (`NEXGEN_API_KEY`), a session (`NEXGEN_ACCESS_TOKEN`), or a user id
 * (`NEXGEN_ACT_AS_USER_ID`) — under row level security, and a key without
 * `write` only reads. `--json` prints what the gesture answered.
 */
import { readFile } from 'node:fs/promises';
import {
  addParticipant,
  compute,
  computeKpi,
  createApiKey,
  createProject,
  declareMeter,
  geocoderChain,
  geocoderNames,
  importHistory,
  importHomeAssistantSeries,
  importProject,
  installDevice,
  kpisOf,
  listApiKeys,
  loadGeocoders,
  personSession,
  readSurfaceConfig,
  registerSource,
  revokeApiKey,
  verifyAccessToken,
  type Computations,
  type Db,
  type HistoryMode,
  type HistoryReport,
  type SeriesTarget,
  type SqlClient,
} from '@nexgen-os/core';
import { readWesmartDatabase, registerWesmartDatabaseScheme, wesmartDatabaseScheme, wesmartDatabaseSource } from '@nexgen-os/wesmart-database';
import { NexgenError } from './errors.js';

type Flags = Map<string, string | true>;

/** The commands of this file and their subcommands; `size` and `kpis` take none or one. */
export const GESTURE_COMMANDS: Record<string, string[]> = {
  key: ['create', 'list', 'revoke'],
  project: ['create', 'import'],
  participant: ['add'],
  meter: ['declare'],
  device: ['install'],
  series: ['import'],
  size: [],
  kpis: ['', 'compute'],
  import: ['wesmart'],
};

export const GESTURE_USAGE = `
Gestures, as a person (NEXGEN_API_KEY, NEXGEN_ACCESS_TOKEN or NEXGEN_ACT_AS_USER_ID), under row level security:
  nexgen-os key create --organisation <id> --name <n> [--write] [--expires <iso>]   issue a key (an owner)
  nexgen-os key list --organisation <id>                                            the keys, never a secret
  nexgen-os key revoke <id>                                                         withdraw a key
  nexgen-os project create --organisation <id> --name <n> --country <cc> [--kind k]
  nexgen-os project import --organisation <id> --file <description.json> [--dry-run]   a project, its participants, meters, devices; again without a duplicate
  nexgen-os participant add --project <id> --name <n> [--place <json>|--address <text>] [--country cc] [--time-zone tz] [--category c]
  nexgen-os meter declare --participant <id> --identifier <v> --scheme <s> [--direction d]
  nexgen-os device install --participant <id> --type <t> --name <n> [--product <id>] [--power kw]
  nexgen-os series import --format homeassistant --file <path> --entity <id> --organisation <id>
                          --object-kind <k> --object <id> --quantity <code> --source <code>
  nexgen-os size --module solar|battery --request <file.json>                       to size, with a named criterion
  nexgen-os kpis --object-kind <k> --object <id> --from <iso> --to <iso>            the indicators of an object
  nexgen-os kpis compute --object-kind <k> --object <id> --indicator <code> --from <iso> --to <iso>
  nexgen-os import wesmart --time-zone <tz> [--dry-run|--apply|--report] [--only <id,id>] [--from <iso>] [--to <iso>]
                          the WeSmart Database (NEXGEN_IMPORT_SOURCE_URL, read only) imported again without a duplicate,
                          reconciled per participant and per month; --register once, as the owner of the database
`;

/** The flags these commands take, beside those of the installer. */
export const GESTURE_FLAGS: Record<string, 'value' | 'switch'> = {
  organisation: 'value', name: 'value', country: 'value', kind: 'value', project: 'value', place: 'value', address: 'value',
  'time-zone': 'value', category: 'value', participant: 'value', identifier: 'value', scheme: 'value', direction: 'value',
  type: 'value', product: 'value', power: 'value', 'object-kind': 'value', object: 'value', quantity: 'value', source: 'value',
  format: 'value', file: 'value', entity: 'value', module: 'value', request: 'value', indicator: 'value', from: 'value', to: 'value',
  write: 'switch', expires: 'value', apply: 'switch', report: 'switch', register: 'switch', only: 'value',
};

function need(flags: Flags, name: string): string {
  const value = flags.get(name);
  if (typeof value !== 'string' || value.length === 0) throw new NexgenError('usage', `--${name} is required`);
  return value;
}

function optional(flags: Flags, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

export interface GestureIo {
  env: Record<string, string | undefined>;
  open: (url: string) => Promise<SqlClient>;
  computations?: Computations;
  fetch?: typeof globalThis.fetch;
}

/** Runs one gesture as the person the environment names, and returns what it answered. */
export async function runGesture(command: string, sub: string | undefined, operand: string | undefined, flags: Flags, io: GestureIo): Promise<unknown> {
  if (command === 'import' && flags.has('register')) return registerImport(flags, io);
  const config = readSurfaceConfig({ ...io.env, NEXGEN_DB_URL: optional(flags, 'db') ?? io.env.NEXGEN_DB_URL, NEXGEN_WRITE: '1' }, 'this command line');
  const acting = config.acting.kind === 'token'
    ? { kind: 'user' as const, userId: (await verifyAccessToken(config.acting.supabaseUrl, config.acting.anonKey, config.acting.token, io.fetch)).userId }
    : config.acting;
  const session = personSession(await io.open(config.dbUrl), acting, { writable: true });
  try {
    return await session.run((db) => gesture(db, command, sub, operand, flags, io));
  } finally {
    await session.close();
  }
}

async function gesture(db: Db, command: string, sub: string | undefined, operand: string | undefined, f: Flags, io: GestureIo): Promise<unknown> {
  switch (`${command} ${sub ?? ''}`.trim()) {
    case 'key create':
      return createApiKey(db, {
        organisation_id: need(f, 'organisation'), name: need(f, 'name'),
        capabilities: f.has('write') ? ['data.read', 'data.write'] : ['data.read'], ...(optional(f, 'expires') ? { expires_at: optional(f, 'expires')! } : {}),
      });
    case 'key list':
      return listApiKeys(db, need(f, 'organisation'));
    case 'key revoke':
      if (operand === undefined) throw new NexgenError('usage', 'key revoke <id>');
      return revokeApiKey(db, operand);
    case 'project create':
      return createProject(db, { organisation_id: need(f, 'organisation'), name: need(f, 'name'), country: need(f, 'country'), ...(optional(f, 'kind') ? { kind: optional(f, 'kind')! } : {}) });
    case 'project import':
      return importProject(db, need(f, 'organisation'), JSON.parse(await readFile(need(f, 'file'), 'utf8')), { dryRun: f.has('dry-run') });
    case 'participant add': {
      const place = optional(f, 'place');
      const geocoder = optional(f, 'address') === undefined ? undefined : await geocoderChain(db, await loadGeocoders(geocoderNames(io.env), io.env));
      return addParticipant(db, {
        project_id: need(f, 'project'), name: need(f, 'name'),
        ...(place ? { place: JSON.parse(place) as Record<string, unknown> } : {}),
        ...(optional(f, 'address') ? { address: optional(f, 'address')! } : {}),
        ...(optional(f, 'country') ? { country: optional(f, 'country')! } : {}),
        ...(optional(f, 'time-zone') ? { time_zone: optional(f, 'time-zone')! } : {}),
        ...(optional(f, 'category') ? { category: optional(f, 'category')! } : {}),
      }, geocoder);
    }
    case 'meter declare':
      return declareMeter(db, {
        participant_id: need(f, 'participant'), identifier: need(f, 'identifier'), scheme: need(f, 'scheme'),
        ...(optional(f, 'direction') ? { direction: optional(f, 'direction')! } : {}), ...(optional(f, 'name') ? { name: optional(f, 'name')! } : {}),
      });
    case 'device install':
      return installDevice(db, {
        participant_id: need(f, 'participant'), device_type: need(f, 'type'), name: need(f, 'name'),
        ...(optional(f, 'product') ? { product_id: optional(f, 'product')! } : {}),
        ...(optional(f, 'power') ? { rated_power_kw: Number(optional(f, 'power')) } : {}),
      });
    case 'series import': {
      if (need(f, 'format') !== 'homeassistant') throw new NexgenError('usage', '--format homeassistant is the format this command reads');
      const target: SeriesTarget = {
        organisationId: need(f, 'organisation'), objectKind: need(f, 'object-kind'), objectId: need(f, 'object'), sourceCode: need(f, 'source'), kind: 'measured',
      };
      return importHomeAssistantSeries(db, target, JSON.parse(await readFile(need(f, 'file'), 'utf8')), need(f, 'entity'), need(f, 'quantity'));
    }
    case 'size': {
      const module = need(f, 'module');
      if (module !== 'solar' && module !== 'battery') throw new NexgenError('usage', '--module solar or --module battery');
      const request = JSON.parse(await readFile(need(f, 'request'), 'utf8')) as Record<string, unknown>;
      return compute(db, io.computations ?? {}, `${module}.size`, request);
    }
    case 'kpis':
      return kpisOf(db, need(f, 'object-kind'), need(f, 'object'), need(f, 'from'), need(f, 'to'));
    case 'kpis compute':
      return computeKpi(db, need(f, 'object-kind'), need(f, 'object'), need(f, 'indicator'), need(f, 'from'), need(f, 'to'));
    case 'import wesmart':
      return importWesmart(db, f, io);
    default:
      throw new NexgenError('usage', `unknown command ${command} ${sub ?? ''}; run nexgen-os --help`);
  }
}

/**
 * The platform's `sources` row and identifier scheme, written once as the
 * owner of the database (`NEXGEN_DB_URL`), as `init` writes the vocabularies.
 */
async function registerImport(f: Flags, io: GestureIo): Promise<unknown> {
  const url = optional(f, 'db') ?? io.env.NEXGEN_DB_URL;
  if (!url) throw new NexgenError('db_url_required', 'pass --db <connection string> or set NEXGEN_DB_URL');
  const client = await io.open(url);
  try {
    const db: Db = { query: async (sql, params) => ({ rows: await client.query(sql, params) }) };
    await registerSource(db, wesmartDatabaseSource);
    await registerWesmartDatabaseScheme(db);
    return { registered: { source: wesmartDatabaseSource.code, identifier_scheme: wesmartDatabaseScheme.code } };
  } finally {
    await client.close();
  }
}

/**
 * The WeSmart Database read in a read-only transaction, then imported (or
 * planned, or reconciled) as the person: the report and what the reader
 * skipped, by ids only. The connection string of the platform is read from
 * the environment, never from a flag, so that no shell history keeps it.
 */
async function importWesmart(db: Db, f: Flags, io: GestureIo): Promise<HistoryReport & { skipped: unknown[] }> {
  const chosen = (['dry-run', 'apply', 'report'] as const).filter((m) => f.has(m));
  if (chosen.length > 1) throw new NexgenError('usage', 'one of --dry-run, --apply, --report');
  const mode: HistoryMode = chosen[0] === 'apply' ? 'apply' : chosen[0] === 'report' ? 'report' : 'dry_run';
  const registered = await db.query<{ n: number }>(
    'select (select count(*) from sources where code = $1)::int + (select count(*) from identifier_schemes where code = $2)::int n',
    [wesmartDatabaseSource.code, wesmartDatabaseScheme.code]);
  if (registered.rows[0]?.n !== 2) {
    throw new NexgenError('source_not_registered', 'run nexgen-os import wesmart --register once, as the owner of the database');
  }
  const url = io.env.NEXGEN_IMPORT_SOURCE_URL;
  if (!url) throw new NexgenError('source_url_required', 'set NEXGEN_IMPORT_SOURCE_URL to a connection string that may read the WeSmart Database');
  const client = await io.open(url);
  try {
    const source: Db = { query: async (sql, params) => ({ rows: await client.query(sql, params) }) };
    const only = optional(f, 'only');
    const { history, skipped } = await readWesmartDatabase(source, {
      timeZone: need(f, 'time-zone'),
      ...(only ? { organisations: only.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
      ...(optional(f, 'from') ? { from: optional(f, 'from')! } : {}),
      ...(optional(f, 'to') ? { to: optional(f, 'to')! } : {}),
    });
    return { ...(await importHistory(db, history, { mode })), skipped };
  } finally {
    await client.close();
  }
}

/** An import's report, for a person: the counts, then each month that is not equal, by ids only. */
export function printHistory(out: (line: string) => void, r: HistoryReport & { skipped: unknown[] }): void {
  out(`${r.mode}  ${r.source_code}`);
  for (const [kind, c] of Object.entries(r.counts)) out(`  ${kind.padEnd(13)}found ${c.found}  ${r.mode === 'apply' ? 'created' : 'to create'} ${c.created}  failed ${c.failed}`);
  out(`  readings     ${r.readings.series} series, ${r.readings.values} values, ${r.readings.changed} changed`);
  out(`  skipped      ${r.skipped.length}`);
  const t = r.totals;
  out(`months: ${t.lines} lines, ${t.equal} equal, ${t.differs} differ, ${t.missing} missing, ${t.failed} failed; ${t.statements_differ} statements differ`);
  for (const m of r.months.filter((x) => x.status !== 'equal')) {
    out(`  ${m.status.padEnd(8)}${m.participant_ref}  ${m.month}  ${m.quantity_code.padEnd(17)}source ${m.source_kwh} kWh  model ${m.nexgen_kwh ?? '—'} kWh${m.refusal ? `  ${m.refusal}` : ''}`);
  }
  for (const o of r.objects.filter((x) => x.outcome === 'failed')) out(`  failed  ${o.kind} ${o.ref}  ${o.refusal}`);
  out(r.personal_data);
}

/** What a gesture answered, for a person: one line per field, or per row. */
export function printGesture(out: (line: string) => void, value: unknown): void {
  if (Array.isArray(value)) {
    if (value.length === 0) out('nothing');
    for (const row of value) out(JSON.stringify(row));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) out(`${k.padEnd(15)}${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
    return;
  }
  out(String(value));
}
