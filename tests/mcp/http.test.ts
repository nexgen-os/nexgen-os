// The server over Streamable HTTP: the OAuth discovery a remote client
// follows (RFC 9728, RFC 8414), the challenge of a request without a bearer,
// a key and a verified session acting as their person, and the refusals.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { authorizationServerMetadata, handleHttpRequest, protectedResourceMetadata, type HttpOptions } from '@nexgen-os/mcp';
import { USER_A, asUser, freshDatabase, one, organisation, sqlClient } from '../helpers/db.js';

let db: PGlite;
let org: string;
let readKey: string;

const ORIGIN = 'https://mcp.example.test';
const PROJECT = 'https://project.example.test';
const jwt = (payload: Record<string, unknown>) =>
  `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
const SESSION = jwt({ sub: USER_A, role: 'authenticated', scope: 'energy' });
const WRITING_SESSION = jwt({ sub: USER_A, role: 'authenticated', scope: 'energy energy.write' });

/** The installation's Supabase Auth, as far as this server asks it: who a session belongs to. */
const auth: typeof fetch = async (input, init) => {
  const bearer = new Headers(init?.headers).get('authorization')?.replace(/^Bearer /, '');
  expect(String(input)).toBe(`${PROJECT}/auth/v1/user`);
  return bearer === SESSION || bearer === WRITING_SESSION
    ? new Response(JSON.stringify({ id: USER_A }), { status: 200 })
    : new Response('{}', { status: 401 });
};

const options = (): HttpOptions => ({ origin: ORIGIN, supabaseUrl: PROJECT, anonKey: 'anon', connect: async () => sqlClient(db), fetch: auth });

const rpc = (body: unknown, bearer?: string) => new Request(`${ORIGIN}/mcp`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
  body: JSON.stringify(body),
});

const INITIALIZE = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } };
const callTool = (name: string, args: Record<string, unknown> = {}) => ({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });

async function toolText(bearer: string, name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; text: string }> {
  const response = await handleHttpRequest(rpc(callTool(name, args), bearer), options());
  expect(response.status).toBe(200);
  const body = (await response.json()) as { result: { isError?: boolean; content: { text: string }[] } };
  return { isError: body.result.isError === true, text: body.result.content[0]!.text };
}

beforeAll(async () => {
  db = await freshDatabase();
  org = await organisation(db, 'A cooperative', USER_A);
  readKey = (await asUser(db, USER_A, () => one<{ secret: string }>(db, `select secret from nexgen.create_api_key($1, 'Agent', array['data.read'])`, [org]))).secret;
  await db.exec('set search_path = nexgen, extensions, public');
});

afterAll(async () => {
  await db.close();
});

describe('OAuth discovery', () => {
  it('publishes the protected-resource metadata of RFC 9728, naming the installation\'s Supabase Auth', async () => {
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
      const response = await handleHttpRequest(new Request(`${ORIGIN}${path}`), options());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        resource: `${ORIGIN}/mcp`,
        authorization_servers: [`${PROJECT}/auth/v1`],
        scopes_supported: ['energy', 'energy.write'],
        bearer_methods_supported: ['header'],
        resource_name: 'Nexgen OS',
        resource_documentation: 'https://github.com/nexgen-os/nexgen-os/tree/main/packages/mcp#readme',
      });
    }
    expect(protectedResourceMetadata({ origin: ORIGIN, supabaseUrl: PROJECT, authorizationServers: ['https://auth.example.test'] }).authorization_servers)
      .toEqual(['https://auth.example.test']);
  });

  it('answers a request without a bearer 401, with the challenge that names the metadata', async () => {
    const response = await handleHttpRequest(rpc(INITIALIZE), options());
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate'))
      .toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource", scope="energy"`);
    const invalid = await handleHttpRequest(rpc(INITIALIZE, jwt({ sub: 'nobody' })), options());
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get('www-authenticate')).toMatch(/error="invalid_token"$/);
  });

  it('serves the RFC 8414 metadata of a host that is its own authorization server: PKCE S256 and dynamic registration', async () => {
    const metadata = authorizationServerMetadata(ORIGIN, { authorize: '/authorize', token: '/token', register: '/register' });
    expect(metadata).toEqual({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/authorize`,
      token_endpoint: `${ORIGIN}/token`,
      registration_endpoint: `${ORIGIN}/register`,
      scopes_supported: ['energy', 'energy.write'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
    const served = await handleHttpRequest(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`), { ...options(), authorizationServer: metadata });
    expect(await served.json()).toEqual(metadata);
    expect((await handleHttpRequest(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`), options())).status).toBe(404);
  });
});

describe('the endpoint', () => {
  it('opens no stream: a GET is 405', async () => {
    expect((await handleHttpRequest(new Request(`${ORIGIN}/mcp`), options())).status).toBe(405);
  });

  it('initialises statelessly, in JSON, for a key', async () => {
    const response = await handleHttpRequest(rpc(INITIALIZE, readKey), options());
    expect(response.status).toBe(200);
    expect(response.headers.get('mcp-session-id')).toBeNull();
    const body = (await response.json()) as { result: { serverInfo: { name: string }; instructions: string } };
    expect(body.result.serverInfo.name).toBe('@nexgen-os/mcp');
  });

  it('acts as the issuer of a key, which reads only without write', async () => {
    expect(JSON.parse((await toolText(readKey, 'status')).text).acting_as).toBe(USER_A);
    const refused = await toolText(readKey, 'create_project', { organisation_id: org, name: 'By a key', country: 'BE' });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/^read_only:/);
  });

  it('acts as the person of a verified session, writing only with the scope energy.write', async () => {
    const reading = await toolText(SESSION, 'create_project', { organisation_id: org, name: 'Read only', country: 'BE' });
    expect(reading.text).toMatch(/^read_only:/);
    const writing = await toolText(WRITING_SESSION, 'create_project', { organisation_id: org, name: 'Allowed', country: 'BE' });
    expect(writing.isError, writing.text).toBe(false);
    expect(JSON.parse((await toolText(SESSION, 'list_projects')).text)).toMatchObject([{ name: 'Allowed' }]);
  });

  it('refuses a service_role bearer, and a service_role key as its own publishable key', async () => {
    const response = await handleHttpRequest(rpc(INITIALIZE, jwt({ role: 'service_role' })), options());
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).toMatch(/service_role_refused/);
    const misconfigured = await handleHttpRequest(rpc(INITIALIZE, readKey), { ...options(), anonKey: 'sb_secret_x' });
    expect(misconfigured.status).toBe(500);
  });
});
