/**
 * The same server over HTTP: the Streamable HTTP transport of MCP,
 * stateless, with the OAuth discovery a remote client follows — as Ekwo OS's
 * hosted server answers it.
 *
 * `bin.ts` is a process a client starts on its own machine, and it reads who
 * it acts as from its environment. A server reached by URL answers many
 * people, so **who a request acts as is decided per request**, from the
 * bearer it carries:
 *
 *   - a key of Nexgen OS (`ngk_…`), presented to the database by
 *     `use_api_key()`: its issuer, within its organisation, read only unless
 *     it carries `write`;
 *   - a person's access token, verified by the installation's Supabase Auth,
 *     writing only when the person granted the scope `energy.write`.
 *
 * A request without one is answered `401` with a `WWW-Authenticate` header
 * naming the protected-resource metadata (RFC 9728). The client follows it
 * to the authorization server (RFC 8414) — by default the installation's own
 * Supabase Auth, its OAuth 2.1 server — registers itself there (RFC 7591)
 * and sends the person to approve the connection and choose whether the
 * agent may write. This file serves the first document, and the second when
 * the host is its own authorization server; it issues no token.
 *
 * Each request builds a server, answers in JSON and closes it: no session
 * id, nothing kept, so it runs on a function platform, behind a load
 * balancer, or in one process. A `GET` on the endpoint is `405`: this server
 * never speaks first.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  installedModules,
  isServiceRoleKey,
  personSession,
  serviceRoleRefusal,
  type Computations,
  type Geocoder,
  type Session,
  type SqlClient,
} from '@nexgen-os/core';
import { scopesOf, verifyAccessToken } from './config.js';
import { buildServer } from './server.js';

/** The scope an agent asks for to read, and the one that lets it write. */
export const SCOPES = { read: 'energy', write: 'energy.write' } as const;

export const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';
export const AUTHORIZATION_SERVER_PATH = '/.well-known/oauth-authorization-server';

export interface HttpOptions {
  /** Where this server is reached, `https://mcp.example.org`; the endpoint is `<origin>/mcp`. */
  origin: string;
  /** The installation's project, `https://<ref>.supabase.co`, whose Auth verifies sessions. */
  supabaseUrl: string;
  /** Its publishable (anon) key. Never the `service_role` key. */
  anonKey: string;
  /** A new connection to the database, for one request; closed when it is answered. */
  connect: () => Promise<SqlClient>;
  /** The authorization servers named in the metadata. Default: the installation's Supabase Auth. */
  authorizationServers?: string[];
  /** The RFC 8414 metadata of the host, when the host is its own authorization server (`authorizationServerMetadata()`). */
  authorizationServer?: AuthorizationServerMetadata;
  computations?: Computations;
  geocoder?: Geocoder;
  fetch?: typeof globalThis.fetch;
}

/** RFC 9728: what this resource is, and who authorizes access to it. */
export function protectedResourceMetadata(options: Pick<HttpOptions, 'origin' | 'supabaseUrl' | 'authorizationServers'>) {
  const origin = options.origin.replace(/\/+$/, '');
  return {
    resource: `${origin}/mcp`,
    authorization_servers: options.authorizationServers ?? [`${options.supabaseUrl.replace(/\/+$/, '')}/auth/v1`],
    scopes_supported: [SCOPES.read, SCOPES.write],
    bearer_methods_supported: ['header'],
    resource_name: 'Nexgen OS',
    resource_documentation: 'https://github.com/nexgen-os/nexgen-os/tree/main/packages/mcp#readme',
  };
}

export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  scopes_supported: string[];
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  revocation_endpoint?: string;
}

/**
 * RFC 8414, for a host that is its own authorization server: the code flow
 * with PKCE (S256) the MCP specification requires, public clients, and the
 * dynamic registration endpoint of RFC 7591 so that a client needs no
 * credentials of its own.
 */
export function authorizationServerMetadata(issuer: string, endpoints: { authorize: string; token: string; register: string; revoke?: string }): AuthorizationServerMetadata {
  const base = issuer.replace(/\/+$/, '');
  const at = (path: string) => new URL(path, `${base}/`).toString();
  return {
    issuer: base,
    authorization_endpoint: at(endpoints.authorize),
    token_endpoint: at(endpoints.token),
    registration_endpoint: at(endpoints.register),
    ...(endpoints.revoke ? { revocation_endpoint: at(endpoints.revoke) } : {}),
    scopes_supported: [SCOPES.read, SCOPES.write],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const rpcError = (status: number, code: number, message: string, headers: Record<string, string> = {}) =>
  json(status, { jsonrpc: '2.0', error: { code, message }, id: null }, headers);

/** The challenge of RFC 9728 §5.1: where the client learns how to get a token. */
function unauthorized(options: HttpOptions, error?: string): Response {
  const metadata = `${options.origin.replace(/\/+$/, '')}${PROTECTED_RESOURCE_PATH}`;
  const challenge = `Bearer resource_metadata="${metadata}", scope="${SCOPES.read}"${error ? `, error="${error}"` : ''}`;
  return rpcError(401, -32001, error === undefined
    ? 'unauthorized: connect with a person\'s session or a key of Nexgen OS; the WWW-Authenticate header says where to get one.'
    : `${error}: the bearer was not recognised by this installation.`, { 'WWW-Authenticate': challenge });
}

/** The session a bearer acts as, or the response that refuses it. */
async function sessionFor(request: Request, options: HttpOptions): Promise<Session | Response> {
  const header = request.headers.get('authorization') ?? '';
  const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  if (bearer === undefined || bearer.length === 0) return unauthorized(options);
  if (isServiceRoleKey(bearer)) {
    return rpcError(403, -32001, serviceRoleRefusal('the bearer of the request', 'authorization', 'this server', 'connect with a person\'s session or a key of Nexgen OS'));
  }
  if (bearer.startsWith('ngk_')) {
    // The database checks the key at the top of every transaction; a key
    // without write runs read only, whatever this says.
    return personSession(await options.connect(), { kind: 'key', secret: bearer }, { writable: true });
  }
  let userId: string;
  try {
    ({ userId } = await verifyAccessToken(options.supabaseUrl, options.anonKey, bearer, options.fetch));
  } catch {
    return unauthorized(options, 'invalid_token');
  }
  return personSession(await options.connect(), { kind: 'user', userId }, { writable: scopesOf(bearer).includes(SCOPES.write) });
}

/** Answers one HTTP request: the discovery documents, or the MCP endpoint. */
export async function handleHttpRequest(request: Request, options: HttpOptions): Promise<Response> {
  if (isServiceRoleKey(options.anonKey)) {
    return rpcError(500, -32001, serviceRoleRefusal('the publishable key of this server', 'apikey', 'this server', 'configure the anon (publishable) key'));
  }
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (request.method === 'GET' && (path === PROTECTED_RESOURCE_PATH || path === `${PROTECTED_RESOURCE_PATH}/mcp`)) {
    return json(200, protectedResourceMetadata(options));
  }
  if (request.method === 'GET' && path === AUTHORIZATION_SERVER_PATH) {
    return options.authorizationServer === undefined ? json(404, { error: 'not_found' }) : json(200, options.authorizationServer);
  }
  if (path !== '/mcp') return json(404, { error: 'not_found' });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rpcError(400, -32700, 'Parse error: the body is not JSON.');
  }
  let session: Session | Response;
  try {
    session = await sessionFor(request, options);
  } catch (error) {
    return rpcError(200, -32001, error instanceof Error ? error.message : String(error));
  }
  if (session instanceof Response) return session;
  try {
    const modules = await session.run(installedModules).catch(() => [] as string[]);
    const server = buildServer(session, {
      modules,
      ...(options.computations ? { computations: options.computations } : {}),
      ...(options.geocoder ? { geocoder: options.geocoder } : {}),
    });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      return await transport.handleRequest(request, { parsedBody: body });
    } finally {
      await server.close().catch(() => {});
    }
  } finally {
    await session.close().catch(() => {});
  }
}

/** The same handler for `node:http`: the request read into a web `Request`, the `Response` written back. */
export async function handleNodeRequest(req: IncomingMessage, res: ServerResponse, options: HttpOptions): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const method = req.method ?? 'GET';
  const request = new Request(new URL(req.url ?? '/', options.origin), {
    method,
    headers,
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: Buffer.concat(chunks) }),
  });
  const response = await handleHttpRequest(request, options);
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}
