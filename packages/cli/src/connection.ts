/**
 * Where the connection string comes from: `--db`, or `--project-ref` with
 * `--db-region` and the database password, or `NEXGEN_DB_URL`, in that order.
 *
 * The connection string copied from the project's *Connect* panel is the
 * reliable way and stays the first one. The project's ref, its region and its
 * password are the convenience Ekwo OS offers under the same flags
 * (`--project-ref`, `--db-region`, `--db-password`), so that one person
 * installs both cores the same way: the address built is the session pooler,
 * on port 5432, because a migration keeps its session.
 *
 * The pooler's host carries a generation as well as a region — a project of
 * `eu-west-3` answers on `aws-1-eu-west-3` and refuses on `aws-0-eu-west-3`
 * with "Tenant or user not found", older projects the other way round — and
 * nothing says which one before asking. Both are tried, the one that answers
 * is kept; any other refusal (a wrong password, a host out of reach) is the
 * answer and is said as it came. No address of the direct connection
 * (`db.<ref>.supabase.co`) is built: it resolves to IPv6 only on recent
 * projects, and a hang is worse than a refusal.
 *
 * The password is read from `NEXGEN_DB_PASSWORD` or `--db-password`, never
 * from a file and never written to one; nothing printed here carries it.
 */
import type { SqlClient } from '@nexgen-os/core';
import { NexgenError } from './errors.js';

/** The variable the database password is read from, beside `--db-password`. */
export const DB_PASSWORD_ENV = 'NEXGEN_DB_PASSWORD';

/** The generations of pooler hosts Supabase issues; the order only says which one costs a round trip. */
export const POOLER_GENERATIONS = ['aws-0', 'aws-1'] as const;

/** A project's ref, as Supabase issues it: twenty lowercase letters. */
const PROJECT_REF = /^[a-z]{20}$/;

/** A cloud region, `eu-west-3`, `ap-southeast-1`, `us-east-1`. */
const REGION = /^[a-z]{2}-[a-z]+-\d+$/;

/** What the pooler answers for a project it does not hold. */
const UNKNOWN_TENANT = /tenant or user not found/i;

/** The session pooler of one generation, for a project's ref, password and region. */
export function poolerUrl(projectRef: string, password: string, region: string, generation: string): string {
  return `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@${generation}-${region}.pooler.supabase.com:5432/postgres`;
}

/** The host of a connection string, without its user or its password: what a message may name. */
export function hostOf(url: string): string {
  return new URL(url).hostname;
}

type Flags = Map<string, string | true>;

const text = (flags: Flags, name: string): string | undefined => {
  const value = flags.get(name);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

/**
 * The connection string the flags and the environment name, or nothing when
 * they name none. With a project's ref, the pooler that answers is found by
 * opening a connection on each generation in turn and closing it.
 */
export async function databaseUrl(
  flags: Flags,
  env: Record<string, string | undefined>,
  open: (url: string) => Promise<SqlClient>,
): Promise<string | undefined> {
  const db = text(flags, 'db');
  const projectRef = text(flags, 'project-ref');
  if (db !== undefined && projectRef !== undefined) throw new NexgenError('usage', 'pass --db or --project-ref, not both');
  if (db !== undefined) return db;
  if (projectRef === undefined) {
    if (flags.has('db-region') || flags.has('db-password')) throw new NexgenError('usage', '--db-region and --db-password go with --project-ref');
    return env.NEXGEN_DB_URL || undefined;
  }
  if (!PROJECT_REF.test(projectRef)) throw new NexgenError('invalid_project_ref', `${projectRef} is not a project ref: twenty lowercase letters, the first word of the project's address`);
  const region = text(flags, 'db-region');
  if (region === undefined) throw new NexgenError('db_region_required', `--project-ref needs --db-region, the project's region (eu-west-3, us-east-1…), under Project settings → General`);
  if (!REGION.test(region)) throw new NexgenError('invalid_region', `${region} is not a region: eu-west-3, us-east-1, ap-southeast-1…`);
  const password = text(flags, 'db-password') ?? (env[DB_PASSWORD_ENV] || undefined);
  if (password === undefined) throw new NexgenError('db_password_required', `--project-ref needs the database password, in ${DB_PASSWORD_ENV} (or --db-password)`);
  const tried: string[] = [];
  for (const generation of POOLER_GENERATIONS) {
    const url = poolerUrl(projectRef, password, region, generation);
    tried.push(hostOf(url));
    let client: SqlClient;
    try {
      client = await open(url);
    } catch (error) {
      if (error instanceof Error && UNKNOWN_TENANT.test(error.message)) continue;
      throw error;
    }
    await client.close();
    return url;
  }
  throw new NexgenError(
    'pooler_not_found',
    `no session pooler holds project ${projectRef} in ${region} (tried ${tried.join(', ')}); check the region, or copy the connection string from Connect → Session pooler and pass it as --db`,
  );
}
