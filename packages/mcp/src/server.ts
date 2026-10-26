/**
 * The server itself: the tools of the core, the tools of the modules
 * installed, and the instructions of the handshake.
 *
 * The descriptions are written for a model: when to reach for the tool,
 * what comes back, and what it will not do. Every call runs in one
 * transaction acting as the person (`Session`), and a refusal comes back
 * with the database's own name first and a sentence on what to do next.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { GestureError, explain, status, type Computations, type Geocoder, type Session } from '@nexgen-os/core';
import { z } from 'zod';
import { READ_TOOLS } from './tools/read.js';
import { MODULE_TOOLS, moduleToolsFor } from './tools/modules.js';
import type { Tool } from './tools/tool.js';
import { WRITE_TOOLS } from './tools/write.js';

export const SERVER_NAME = '@nexgen-os/mcp';
/** Repeated from `package.json`, so that a bundle without a manifest still says what it is; a test keeps them equal. */
export const SERVER_VERSION = '0.4.0';

export const INSTRUCTIONS = [
  'Nexgen OS is a world model for energy assets in the person\'s own Postgres: organisations, projects, participants, their meters, devices and series. You act as that person: what you see and change is what row level security lets them see and change. There is no agent role and no back door. Dates are ISO, identifiers uuids, a value is dated at the start of its interval, an azimuth in degrees clockwise from true north.',
  'A first session. (1) status, then list_organisations and list_projects: everything belongs to an organisation. (2) list_participants: a participant without a time zone has no daily readings; say so. (3) Describe with a source: add_participant with its place, declare_meter, install_device, store_series or import_series. (4) Compute as a module does: solar_estimate_yield, solar_size, battery_size and charging_size with a criterion the person chose, community_settle, kpis_compute; read back with read_series, solar_estimates, kpis_of. (5) Show what you attached and what the estimate read, then propose with actions_propose; the person validates.',
  'Never compute a figure yourself and write it as if a module had; never assume a country, a currency, a language or a time zone; never send the data anywhere the person did not configure.',
  'When the database refuses, the message starts with a name — time_zone_required, read_only, not_allowed, api_key_revoked — followed by a sentence saying what to do. Report it to the person; do not retry blindly or work around it.',
].join('\n\n');

export interface ServerOptions {
  /** The modules installed on the database; their tools are offered. None: the core's tools only. */
  modules?: readonly string[];
  /** The computations of the modules that are code (`solar.size`, `solar.yield`, `battery.size`, `community.settle`, `charging.size`). */
  computations?: Computations;
  /** The geocoder chain the person configured (`geocoderFor()`). None: an address is refused, a place is not. */
  geocoder?: Geocoder;
}

function ok(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

/** A refusal, with the database's own words first and what to do underneath. */
function fail(error: unknown): CallToolResult {
  const e = explain(error);
  return { isError: true, content: [{ type: 'text', text: e.hint === undefined ? e.message : `${e.message}\n\n${e.hint}` }] };
}

/** Every tool this server can offer, the modules' included: what `list_modules` and the README name. */
export const ALL_TOOLS: Tool[] = [...READ_TOOLS, ...WRITE_TOOLS, ...MODULE_TOOLS];

export function instructionsFor(session: Pick<Session, 'writable'> | undefined): string {
  const writing = session?.writable === false
    ? 'This connection READS: every write is refused as read_only. The person allows writing (NEXGEN_WRITE=1, a key with write, or the scope energy.write); say so when a write is asked for.'
    : 'This connection may write, as the person — unless it is a key issued without write, which the database runs read only (read_only). Show what you are about to write before you write it.';
  return `${INSTRUCTIONS}\n\n${writing}`;
}

export function buildServer(session: Session, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: instructionsFor(session) });
  const modules = options.modules ?? [];
  const tools = [...READ_TOOLS, ...WRITE_TOOLS, ...moduleToolsFor(modules)];

  const register = (t: Tool): void => {
    server.registerTool(t.name, {
      title: t.title,
      description: t.description,
      inputSchema: t.input.shape,
      annotations: {
        title: t.title,
        readOnlyHint: !t.writes,
        destructiveHint: t.destructive === true,
        openWorldHint: t.name === 'solar_estimate_yield' || t.name === 'add_participant',
      },
    }, async (args: unknown) => {
      try {
        const parsed = t.input.parse(args ?? {});
        return ok(await session.run((db) => t.run({ db, computations: options.computations ?? {}, geocoder: options.geocoder }, parsed)));
      } catch (error) {
        return fail(error instanceof z.ZodError ? new GestureError(`invalid_arguments: ${error.message}`) : error);
      }
    });
  };
  for (const t of tools) register(t);

  server.registerTool('list_modules', {
    title: 'Modules and their tools',
    description: 'The modules installed on this database, each with the tools it adds here. A module that is not installed offers none: nexgen-os init --modules adds it.',
    inputSchema: {},
    annotations: { title: 'Modules and their tools', readOnlyHint: true, openWorldHint: false },
  }, async () => {
    try {
      const installed = (await session.run(status)).modules;
      return ok(installed.map((m) => ({ ...m, tools: MODULE_TOOLS.filter((t) => t.module === m.code).map((t) => t.name) })));
    } catch (error) {
      return fail(error);
    }
  });
  return server;
}
