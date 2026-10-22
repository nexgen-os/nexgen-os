/**
 * Where a surface — the MCP server, the command line — gets its connection
 * and who it acts as, and what it refuses: Ekwo OS's `config.ts`, for the
 * one route of this project (decision 0046), read by both surfaces.
 *
 * One connection, `NEXGEN_DB_URL`, and exactly one person to act as:
 *
 *   - `NEXGEN_API_KEY`, a key of Nexgen OS: the issuer, within the key's
 *     organisation, read only unless the key carries `write`;
 *   - `NEXGEN_ACCESS_TOKEN`, a person's session, verified by the
 *     installation's own Supabase Auth (`SUPABASE_URL`, `SUPABASE_ANON_KEY`);
 *   - `NEXGEN_ACT_AS_USER_ID`, the `auth.users` id of a person, for a
 *     self-hosted installation whose owner holds the connection anyway.
 *
 * A `service_role` key is refused in every slot it could arrive in. Writing
 * is the person's to allow: `NEXGEN_WRITE=1`, or a key issued with `write`.
 */
import { IDENTITY_ENV, isServiceRoleKey, serviceRoleRefusal } from './identity.js';
import { GestureError } from './refusal.js';
import { personSession, type Session } from './session.js';
import { connect } from './sql.js';

const ENV = IDENTITY_ENV;

export interface SurfaceConfig {
  dbUrl: string;
  acting: { kind: 'key'; secret: string } | { kind: 'token'; token: string; supabaseUrl: string; anonKey: string } | { kind: 'user'; userId: string };
  writable: boolean;
}

const SIGN_IN = `set ${ENV.apiKey} to a key an owner issued, or ${ENV.accessToken} to a person's session`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function trimmed(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

/** Refuses a `service_role` key wherever it was put, before anything connects. */
export function refuseServiceRole(env: NodeJS.ProcessEnv, surface: string): void {
  const anonKey = trimmed(env, ENV.anonKey);
  if (anonKey !== undefined && isServiceRoleKey(anonKey)) throw new GestureError(serviceRoleRefusal(ENV.anonKey, 'apikey', surface, SIGN_IN));
  const token = trimmed(env, ENV.accessToken);
  if (token !== undefined && isServiceRoleKey(token)) throw new GestureError(serviceRoleRefusal(ENV.accessToken, 'authorization', surface, SIGN_IN));
  const key = trimmed(env, ENV.apiKey);
  if (key !== undefined && isServiceRoleKey(key)) throw new GestureError(serviceRoleRefusal(ENV.apiKey, 'apikey', surface, SIGN_IN));
}

/** Reads the environment, and says what is missing rather than failing later. */
export function readSurfaceConfig(env: NodeJS.ProcessEnv, surface: string): SurfaceConfig {
  refuseServiceRole(env, surface);
  const dbUrl = trimmed(env, ENV.dbUrl);
  if (dbUrl === undefined) {
    throw new GestureError(`missing_configuration: set ${ENV.dbUrl} to the connection string of the database, and one of ${ENV.apiKey}, ${ENV.accessToken} or ${ENV.actAsUserId} for the person this server acts as.`);
  }
  const key = trimmed(env, ENV.apiKey);
  const token = trimmed(env, ENV.accessToken);
  const userId = trimmed(env, ENV.actAsUserId);
  const given = [key, token, userId].filter((v) => v !== undefined).length;
  if (given === 0) {
    throw new GestureError(`missing_credentials: set ${ENV.apiKey}, ${ENV.accessToken} or ${ENV.actAsUserId}. A database connection is nobody, and this surface has no identity of its own: it acts as the person using it.`);
  }
  if (given > 1) {
    throw new GestureError(`two_credentials: set one of ${ENV.apiKey}, ${ENV.accessToken} and ${ENV.actAsUserId}; a surface acts as one person at a time.`);
  }
  const writable = trimmed(env, ENV.write) === '1';
  if (key !== undefined) {
    if (!key.startsWith('ngk_')) throw new GestureError(`bad_api_key: ${ENV.apiKey} holds something that is not a key of Nexgen OS (ngk_…).`);
    // A key carries its own allowance: one with `write` was issued to write,
    // and one without runs read only in the database, whatever this says.
    return { dbUrl, acting: { kind: 'key', secret: key }, writable: true };
  }
  if (token !== undefined) {
    const supabaseUrl = trimmed(env, ENV.supabaseUrl);
    const anonKey = trimmed(env, ENV.anonKey);
    if (supabaseUrl === undefined || anonKey === undefined) {
      throw new GestureError(`missing_configuration: ${ENV.accessToken} is verified by the installation's Supabase Auth; set ${ENV.supabaseUrl} and ${ENV.anonKey} too.`);
    }
    return { dbUrl, acting: { kind: 'token', token, supabaseUrl, anonKey }, writable };
  }
  if (!UUID.test(userId!)) throw new GestureError(`bad_act_as_user: ${ENV.actAsUserId} must be the auth.users id of a person, as a uuid.`);
  return { dbUrl, acting: { kind: 'user', userId: userId! }, writable };
}

/**
 * The person a session token belongs to, as the installation's Supabase
 * Auth says (`GET /auth/v1/user`). A token it does not recognise is refused
 * as `invalid_token`; nothing is decided from an unverified token.
 */
export async function verifyAccessToken(
  supabaseUrl: string,
  anonKey: string,
  token: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<{ userId: string }> {
  const response = await fetchImpl(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new GestureError(`invalid_token: the installation's Supabase Auth did not recognise this session (${response.status}).`);
  const user = (await response.json()) as { id?: unknown };
  if (typeof user.id !== 'string' || !UUID.test(user.id)) throw new GestureError('invalid_token: the installation\'s Supabase Auth answered without a user.');
  return { userId: user.id };
}

/** The scopes a verified token carries (`scope`, space-separated), from its payload. */
export function scopesOf(token: string): string[] {
  const payload = token.split('.')[1];
  if (payload === undefined) return [];
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { scope?: unknown };
    return typeof claims.scope === 'string' ? claims.scope.split(/\s+/).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** The session a configuration describes: a token verified first, then one connection acting as the person. The caller closes it. */
export async function openPersonSession(config: SurfaceConfig, options: { fetch?: typeof globalThis.fetch } = {}): Promise<Session> {
  const acting = config.acting.kind === 'token'
    ? { kind: 'user' as const, userId: (await verifyAccessToken(config.acting.supabaseUrl, config.acting.anonKey, config.acting.token, options.fetch)).userId }
    : config.acting;
  return personSession(await connect(config.dbUrl), acting, { writable: config.writable });
}
