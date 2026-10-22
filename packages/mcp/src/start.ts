/**
 * From an environment to a server, without the transport.
 *
 * `bin.ts` connects the result to stdio; the tests connect it to an
 * in-memory client. With nothing configured the server still starts and
 * offers the core's tools, and every call says what to set — only absence
 * is forgiven: a `service_role` key, two people to act as or a malformed id
 * are refused at start (`unconfigured.ts`).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { geocoderChain, geocoderNames, installedModules, loadGeocoders, nexgenSchemaFloor, openPersonSession, type Computations, type Geocoder, type Session } from '@nexgen-os/core';
import { readConfig, type Config } from './config.js';
import { buildServer } from './server.js';
import { isMissingConfiguration, unconfiguredSession } from './unconfigured.js';
import { SCHEMA_MIN } from './schema.js';

export interface Started {
  server: McpServer;
  session: Session;
  /** One line for stderr: how this server is connected, or why it is not. */
  summary: string;
}

export interface StartOptions {
  computations?: Computations;
  geocoder?: Geocoder;
  fetch?: typeof globalThis.fetch;
}

/** The session a configuration describes. The caller closes it. */
export const openSession = (config: Config, options: { fetch?: typeof globalThis.fetch } = {}): Promise<Session> => openPersonSession(config, options);

export async function serverFromEnvironment(env: NodeJS.ProcessEnv = process.env, options: StartOptions = {}): Promise<Started> {
  let config: Config;
  try {
    config = readConfig(env);
  } catch (error) {
    if (!isMissingConfiguration(error)) throw error;
    const session = unconfiguredSession(error as Error);
    return {
      server: buildServer(session),
      session,
      summary: `nexgen-mcp: started without a database — every tool will answer with what to configure. ${(error as Error).message}`,
    };
  }
  const session = await openSession(config, options);
  const version = await session.run((db) => nexgenSchemaFloor(db, SCHEMA_MIN));
  const modules = await session.run(installedModules);
  // The geocoders the person named, keyed by the places their sources serve.
  const geocoder = options.geocoder
    ?? await session.run(async (db) => geocoderChain(db, await loadGeocoders(geocoderNames(env), env)));
  return {
    server: buildServer(session, { modules, ...(options.computations ? { computations: options.computations } : {}), ...(geocoder ? { geocoder } : {}) }),
    session,
    summary: `nexgen-mcp: connected as ${session.actingAs}, ${session.writable ? 'reading and writing' : 'reading only'}, schema ${version}${modules.length ? `, modules: ${modules.join(', ')}` : ''}`,
  };
}
