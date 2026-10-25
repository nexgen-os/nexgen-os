// The connection string from a project's ref, its region and its password: the pooler that answers.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase, sqlClient } from '../../../tests/helpers/db.js';
import { databaseUrl, hostOf, main, poolerUrl, type SqlClient } from '../src/index.js';

const REF = 'arhmszklrvhcjteuzvrd';
const flags = (entries: Record<string, string>) => new Map<string, string | true>(Object.entries(entries));

/** A pooler of one generation: it holds the project, or it refuses it as the real one does. */
function pooler(holds: string, opened: string[]) {
  return async (url: string): Promise<SqlClient> => {
    opened.push(hostOf(url));
    if (!hostOf(url).startsWith(`${holds}-`)) throw new Error('Tenant or user not found');
    return { exec: async () => {}, query: async () => [], close: async () => {} };
  };
}

describe('poolerUrl', () => {
  it('is the session pooler of the generation and region, the password escaped', () => {
    expect(poolerUrl(REF, 'p@ss:w/rd', 'eu-west-3', 'aws-1')).toBe(
      `postgresql://postgres.${REF}:p%40ss%3Aw%2Frd@aws-1-eu-west-3.pooler.supabase.com:5432/postgres`,
    );
    expect(hostOf(poolerUrl(REF, 'secret', 'eu-west-3', 'aws-1'))).toBe('aws-1-eu-west-3.pooler.supabase.com');
  });
});

describe('databaseUrl', () => {
  it('keeps the generation that holds the project, after the one that refuses it', async () => {
    const opened: string[] = [];
    const url = await databaseUrl(flags({ 'project-ref': REF, 'db-region': 'eu-west-3' }), { NEXGEN_DB_PASSWORD: 'secret' }, pooler('aws-1', opened));
    expect(url).toBe(poolerUrl(REF, 'secret', 'eu-west-3', 'aws-1'));
    expect(opened).toEqual(['aws-0-eu-west-3.pooler.supabase.com', 'aws-1-eu-west-3.pooler.supabase.com']);
  });

  it('stops at the first generation when it answers, and takes --db-password before the environment', async () => {
    const opened: string[] = [];
    const url = await databaseUrl(flags({ 'project-ref': REF, 'db-region': 'eu-central-1', 'db-password': 'flag' }), { NEXGEN_DB_PASSWORD: 'env' }, pooler('aws-0', opened));
    expect(url).toBe(poolerUrl(REF, 'flag', 'eu-central-1', 'aws-0'));
    expect(opened).toEqual(['aws-0-eu-central-1.pooler.supabase.com']);
  });

  it('names the hosts tried when no pooler holds the project, without the password', async () => {
    const r = databaseUrl(flags({ 'project-ref': REF, 'db-region': 'us-east-1' }), { NEXGEN_DB_PASSWORD: 'secret' }, pooler('aws-9', []));
    await expect(r).rejects.toThrow(/^pooler_not_found: no session pooler holds project arhmszklrvhcjteuzvrd in us-east-1 \(tried aws-0-us-east-1\.pooler\.supabase\.com, aws-1-us-east-1\.pooler\.supabase\.com\)/);
    await expect(r).rejects.not.toThrow(/secret/);
  });

  it('says any other refusal as it came, without trying the next generation', async () => {
    const opened: string[] = [];
    const open = async (url: string): Promise<SqlClient> => {
      opened.push(hostOf(url));
      throw new Error('password authentication failed for user "postgres"');
    };
    await expect(databaseUrl(flags({ 'project-ref': REF, 'db-region': 'eu-west-3' }), { NEXGEN_DB_PASSWORD: 'wrong' }, open)).rejects.toThrow(/password authentication failed/);
    expect(opened).toEqual(['aws-0-eu-west-3.pooler.supabase.com']);
  });

  it('refuses by name what a ref needs and does not have', async () => {
    const never = async (): Promise<SqlClient> => { throw new Error('not opened'); };
    await expect(databaseUrl(flags({ 'project-ref': 'Not-A-Ref' }), {}, never)).rejects.toThrow(/^invalid_project_ref: /);
    await expect(databaseUrl(flags({ 'project-ref': REF }), {}, never)).rejects.toThrow(/^db_region_required: /);
    await expect(databaseUrl(flags({ 'project-ref': REF, 'db-region': 'paris' }), {}, never)).rejects.toThrow(/^invalid_region: /);
    await expect(databaseUrl(flags({ 'project-ref': REF, 'db-region': 'eu-west-3' }), {}, never)).rejects.toThrow(/^db_password_required: .*NEXGEN_DB_PASSWORD/);
    await expect(databaseUrl(flags({ 'project-ref': REF, db: 'postgresql://x' }), {}, never)).rejects.toThrow(/^usage: pass --db or --project-ref, not both/);
    await expect(databaseUrl(flags({ 'db-region': 'eu-west-3' }), {}, never)).rejects.toThrow(/^usage: --db-region and --db-password go with --project-ref/);
  });

  it('takes --db, then NEXGEN_DB_URL, as they are, without opening anything', async () => {
    const never = async (): Promise<SqlClient> => { throw new Error('not opened'); };
    expect(await databaseUrl(flags({ db: 'postgresql://flag' }), { NEXGEN_DB_URL: 'postgresql://env' }, never)).toBe('postgresql://flag');
    expect(await databaseUrl(flags({}), { NEXGEN_DB_URL: 'postgresql://env' }, never)).toBe('postgresql://env');
    expect(await databaseUrl(flags({}), { NEXGEN_DB_URL: '' }, never)).toBeUndefined();
  });
});

describe('the command line', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await freshDatabase([], []);
  });

  afterAll(async () => {
    await db.close();
  });

  async function run(argv: string[], env: Record<string, string>) {
    const out: string[] = [];
    const err: string[] = [];
    const opened: string[] = [];
    const code = await main(argv, {
      out: (l) => out.push(l), err: (l) => err.push(l), env,
      open: async (url) => {
        opened.push(hostOf(url));
        if (!hostOf(url).startsWith('aws-1-')) throw new Error('Tenant or user not found');
        return sqlClient(db);
      },
    });
    return { code, out: out.join('\n'), err: err.join('\n'), opened };
  }

  it('reaches the database from a ref, a region and the password in the environment', async () => {
    const r = await run(['status', '--project-ref', REF, '--db-region', 'eu-west-3'], { NEXGEN_DB_PASSWORD: 'secret' });
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^Nexgen OS 0\.3\.0/);
    expect(r.opened).toEqual(['aws-0-eu-west-3.pooler.supabase.com', 'aws-1-eu-west-3.pooler.supabase.com', 'aws-1-eu-west-3.pooler.supabase.com']);
  });

  it('names every way to give a database when none is given', async () => {
    const r = await run(['doctor'], {});
    expect(r.code).toBe(1);
    expect(r.err).toBe('db_url_required: pass --db <connection string>, set NEXGEN_DB_URL, or give --project-ref and --db-region with NEXGEN_DB_PASSWORD');
  });
});
