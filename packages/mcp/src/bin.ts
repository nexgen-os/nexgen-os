#!/usr/bin/env node
/**
 * `npx @nexgen-os/mcp`, over stdio — or `--http`, the same server by URL.
 *
 * Everything comes from the environment, because that is how an MCP client
 * launches a server: a command and a block of variables. Nothing is read
 * from a file and nothing is written to one. stdout belongs to the protocol;
 * anything for a human goes to stderr.
 */
import { createServer } from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { connect } from '@nexgen-os/core';
import { ENV, refuseServiceRole } from './config.js';
import { handleNodeRequest } from './http.js';
import { SERVER_VERSION } from './server.js';
import { serverFromEnvironment } from './start.js';

const HELP = `nexgen-mcp — the Model Context Protocol server for Nexgen OS.

Over stdio (the default), started by a client with, in its "env" block:

  ${ENV.dbUrl}            the connection string of the database
  and one person to act as:
  ${ENV.apiKey}           a key an owner issued (nexgen-os key create)
  ${ENV.accessToken}      a person's session, verified with ${ENV.supabaseUrl} and ${ENV.anonKey}
  ${ENV.actAsUserId}   the auth.users id of a person (self-hosted)
  ${ENV.write}=1           lets the agent write; it reads otherwise

Over HTTP, for others to reach by URL:

  nexgen-mcp --http [--port 8787]
  with ${ENV.dbUrl}, ${ENV.supabaseUrl}, ${ENV.anonKey} and NEXGEN_MCP_ORIGIN (https://mcp.example.org)

Row level security applies either way. This server has no privileges of its
own and refuses a service_role key.
`;

async function serveHttp(port: number): Promise<void> {
  refuseServiceRole(process.env);
  const need = (name: string): string => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`missing_configuration: --http needs ${name}`);
    return value;
  };
  const dbUrl = need(ENV.dbUrl);
  const options = {
    origin: need('NEXGEN_MCP_ORIGIN'),
    supabaseUrl: need(ENV.supabaseUrl),
    anonKey: need(ENV.anonKey),
    connect: () => connect(dbUrl),
  };
  createServer((req, res) => {
    handleNodeRequest(req, res, options).catch((error: unknown) => {
      res.statusCode = 500;
      res.end(error instanceof Error ? error.message : String(error));
    });
  }).listen(port, () => process.stderr.write(`nexgen-mcp: Streamable HTTP on port ${port}, endpoint ${options.origin}/mcp\n`));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) return void process.stderr.write(HELP);
  if (args.includes('--version') || args.includes('-v')) return void process.stderr.write(`${SERVER_VERSION}\n`);
  if (args.includes('--http')) {
    const at = args.indexOf('--port');
    return serveHttp(at === -1 ? 8787 : Number(args[at + 1]));
  }
  const { server, session, summary } = await serverFromEnvironment(process.env);
  const shutdown = async (): Promise<void> => {
    await server.close().catch(() => {});
    await session.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  await server.connect(new StdioServerTransport());
  process.stderr.write(`${summary}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
