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
  importHomeAssistantSeries,
  installDevice,
  kpisOf,
  listApiKeys,
  loadGeocoders,
  personSession,
  readSurfaceConfig,
  revokeApiKey,
  verifyAccessToken,
  type Computations,
  type Db,
  type SeriesTarget,
  type SqlClient,
} from '@nexgen-os/core';
import { NexgenError } from './errors.js';

type Flags = Map<string, string | true>;

/** The commands of this file and their subcommands; `size` and `kpis` take none or one. */
export const GESTURE_COMMANDS: Record<string, string[]> = {
  key: ['create', 'list', 'revoke'],
  project: ['create'],
  participant: ['add'],
  meter: ['declare'],
  device: ['install'],
  series: ['import'],
  size: [],
  kpis: ['', 'compute'],
};

export const GESTURE_USAGE = `
Gestures, as a person (NEXGEN_API_KEY, NEXGEN_ACCESS_TOKEN or NEXGEN_ACT_AS_USER_ID), under row level security:
  nexgen-os key create --organisation <id> --name <n> [--write] [--expires <iso>]   issue a key (an owner)
  nexgen-os key list --organisation <id>                                            the keys, never a secret
  nexgen-os key revoke <id>                                                         withdraw a key
  nexgen-os project create --organisation <id> --name <n> --country <cc> [--kind k]
  nexgen-os participant add --project <id> --name <n> [--place <json>|--address <text>] [--country cc] [--time-zone tz]
  nexgen-os meter declare --participant <id> --identifier <v> --scheme <s> [--direction d]
  nexgen-os device install --participant <id> --type <t> --name <n> [--product <id>] [--power kw]
  nexgen-os series import --format homeassistant --file <path> --entity <id> --organisation <id>
                          --object-kind <k> --object <id> --quantity <code> --source <code>
  nexgen-os size --module solar|storage --request <file.json>                       to size, with a named criterion
  nexgen-os kpis --object-kind <k> --object <id> --from <iso> --to <iso>            the indicators of an object
  nexgen-os kpis compute --object-kind <k> --object <id> --indicator <code> --from <iso> --to <iso>
`;

/** The flags these commands take, beside those of the installer. */
export const GESTURE_FLAGS: Record<string, 'value' | 'switch'> = {
  organisation: 'value', name: 'value', country: 'value', kind: 'value', project: 'value', place: 'value', address: 'value',
  'time-zone': 'value', role: 'value', participant: 'value', identifier: 'value', scheme: 'value', direction: 'value',
  type: 'value', product: 'value', power: 'value', 'object-kind': 'value', object: 'value', quantity: 'value', source: 'value',
  format: 'value', file: 'value', entity: 'value', module: 'value', request: 'value', indicator: 'value', from: 'value', to: 'value',
  write: 'switch', expires: 'value',
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
    case 'participant add': {
      const place = optional(f, 'place');
      const geocoder = optional(f, 'address') === undefined ? undefined : await geocoderChain(db, await loadGeocoders(geocoderNames(io.env), io.env));
      return addParticipant(db, {
        project_id: need(f, 'project'), name: need(f, 'name'),
        ...(place ? { place: JSON.parse(place) as Record<string, unknown> } : {}),
        ...(optional(f, 'address') ? { address: optional(f, 'address')! } : {}),
        ...(optional(f, 'country') ? { country: optional(f, 'country')! } : {}),
        ...(optional(f, 'time-zone') ? { time_zone: optional(f, 'time-zone')! } : {}),
        ...(optional(f, 'role') ? { role: optional(f, 'role')! } : {}),
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
      if (module !== 'solar' && module !== 'storage') throw new NexgenError('usage', '--module solar or --module storage');
      const request = JSON.parse(await readFile(need(f, 'request'), 'utf8')) as Record<string, unknown>;
      return compute(db, io.computations ?? {}, `${module}.size`, request);
    }
    case 'kpis':
      return kpisOf(db, need(f, 'object-kind'), need(f, 'object'), need(f, 'from'), need(f, 'to'));
    case 'kpis compute':
      return computeKpi(db, need(f, 'object-kind'), need(f, 'object'), need(f, 'indicator'), need(f, 'from'), need(f, 'to'));
    default:
      throw new NexgenError('usage', `unknown command ${command} ${sub ?? ''}; run nexgen-os --help`);
  }
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
