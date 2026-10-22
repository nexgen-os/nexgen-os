/**
 * Who a surface acts as — and the one key none of them accepts.
 *
 * The MCP server and the command line both act as a person and let row level
 * security decide from there (decision 0046). Both are handed keys by
 * somebody pasting from a dashboard, and both have to refuse the same paste:
 * a `service_role` key. It would work — that is the problem. Every policy in
 * the schema would be bypassed, and a tool that can read every organisation
 * of an installation is not the thing anybody asked for.
 *
 * The variables, the test and the sentence are those of Ekwo OS, under the
 * names of this project, so that one person configures both the same way.
 * This file imports nothing and reaches for no global that only one runtime
 * has.
 */

/** The variables a surface reads its user from. One spelling, for every surface. */
export const IDENTITY_ENV = {
  supabaseUrl: 'SUPABASE_URL',
  anonKey: 'SUPABASE_ANON_KEY',
  dbUrl: 'NEXGEN_DB_URL',
  apiKey: 'NEXGEN_API_KEY',
  accessToken: 'NEXGEN_ACCESS_TOKEN',
  actAsUserId: 'NEXGEN_ACT_AS_USER_ID',
  write: 'NEXGEN_WRITE',
} as const;

/** The base64url alphabet, in value order. `indexOf` is the decoding table. */
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * One segment of a JWT, as text — or nothing when it is not one.
 *
 * Written out rather than handed to `Buffer`, which a browser does not have,
 * or to `atob`, which reads base64 and not base64url and throws on the two
 * characters that differ. Six bits at a time into a byte buffer, then
 * `TextDecoder`, which every runtime this code runs in carries. Nothing here
 * verifies a signature: the question is what the key *claims* to be.
 */
function decodeSegment(segment: string): string | undefined {
  const text = segment.replace(/=+$/, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of text) {
    const value = BASE64URL.indexOf(character);
    if (value < 0) return undefined;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return undefined;
  }
}

/** A segment that carries a JSON object, as that object. Anything else: nothing. */
function readSegment(segment: string | undefined): Record<string, unknown> | undefined {
  if (segment === undefined || segment.length === 0) return undefined;
  const text = decodeSegment(segment);
  if (text === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * True when a key is, or claims to be, a `service_role` key.
 *
 * Both shapes Supabase has issued: the signed JWT whose payload carries
 * `"role": "service_role"`, and the newer `sb_secret_…`. Neither is a mistake
 * we should let an operator make by pasting the wrong line of the dashboard.
 *
 * **A key shaped like a JWT whose payload cannot be read answers yes.** This
 * used to decode that payload with `Buffer` inside a `try`, and a browser has
 * no `Buffer`: the call raised, the `catch` swallowed it, and the function
 * said *this is not a service_role key* about every JWT it was ever shown —
 * the one answer that is never safe to guess. The shape is the claim, and a
 * claim this function cannot read is one it cannot clear.
 *
 * **The header is what says the shape**, and not three pieces with dots
 * between them: `postgresql://user@db.example.test:5432/postgres` has two dots
 * and so does a password somebody chose, and neither of them is presenting a
 * token. A JWT opens with a JSON object naming its algorithm; nothing here
 * verifies the signature that algorithm produced, because the question is what
 * the key claims and not whether the claim is true.
 */
export function isServiceRoleKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  const parts = key.split('.');
  if (parts.length !== 3) return false;

  const header = readSegment(parts[0]);
  if (header === undefined || typeof header.alg !== 'string') return false;

  const payload = readSegment(parts[1]);
  if (payload === undefined) return true;
  return payload.role === 'service_role';
}

/** Where a key was put, which decides what the refusal has to explain. */
export type KeySlot = 'apikey' | 'authorization';

/**
 * The refusal, word for word, for whichever surface met the key.
 *
 * There are two doors and not one. The `apikey` slot is the obvious paste. The
 * `Authorization` header is the quiet one: PostgREST takes the role from that
 * header and not from `apikey`, so a service_role token put there overrides a
 * perfectly good anon key sitting next to it.
 *
 * `where` is what the operator typed — a variable, a flag — and `surface` is
 * who is speaking: `this server`, `this command line`. `signIn` is how that
 * surface gets a real session instead.
 */
export function serviceRoleRefusal(
  where: string,
  slot: KeySlot,
  surface: string,
  signIn: string,
): string {
  if (slot === 'apikey') {
    return `service_role_refused: ${where} holds a service_role key. That key bypasses every row level security policy, so ${surface} would answer for organisations its user was never invited to. Use the anon (publishable) key and sign in as a user.`;
  }
  return `service_role_refused: ${where} holds a service_role key. It travels in the Authorization header, which is where PostgREST reads the role from, so it would bypass every row level security policy and ${surface} would answer for organisations its user was never invited to. Use a session token for a real user — ${signIn}.`;
}
