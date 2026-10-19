// The floor: the versions a package declares, and the databases it refuses.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase, one, repoRoot, sqlClient } from '../../../tests/helpers/db.js';
import { PACKAGE_VERSION, SCHEMA_MIN, SCHEMA_VERSION, checkFloor, compareVersions, databaseVersion, migrate } from '../src/index.js';

describe('versions', () => {
  it('compares x.y.z numerically', () => {
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1', '0.1.1')).toBeLessThan(0);
  });

  it('are declared once in package.json and repeated in the code, and the migration answers the same', async () => {
    const pkg = JSON.parse(await readFile(join(repoRoot, 'packages/cli/package.json'), 'utf8'));
    expect(pkg.version).toBe(PACKAGE_VERSION);
    expect(pkg.nexgenOs).toEqual({ schemaVersion: SCHEMA_VERSION, schemaMin: SCHEMA_MIN });
    const sql = await readFile(join(repoRoot, `core/migrations/20261013000000_schema_version_${SCHEMA_VERSION.replaceAll('.', '_')}.sql`), 'utf8');
    expect(sql).toContain(`select '${SCHEMA_VERSION}'::text;`);
  });
});

describe('checkFloor', () => {
  const pkg = { schemaVersion: '0.3.0', schemaMin: '0.2.0' };

  it('lets through an empty database and one between the floor and the package', () => {
    expect(checkFloor(null, pkg)).toBeNull();
    expect(checkFloor('0.2.0', pkg)).toBeNull();
    expect(checkFloor('0.3.0', pkg)).toBeNull();
  });

  it('refuses a database newer than the package', () => {
    expect(checkFloor('0.4.0', pkg)?.message).toMatch(/^package_too_old: the database is at 0.4.0 and this package at 0.3.0/);
  });

  it('refuses a database below the floor, naming the release to run first', () => {
    expect(checkFloor('0.1.5', pkg)?.message).toMatch(/^database_too_old: run nexgen-os migrate of version 0.2.0 first/);
  });
});

describe('on a database', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await freshDatabase();
  });
  afterAll(async () => {
    await db.close();
  });

  it('reads the version the migration installed', async () => {
    expect(await databaseVersion(sqlClient(db))).toBe(SCHEMA_VERSION);
    expect((await one<{ v: string }>(db, 'select nexgen.nexgen_schema_version() v')).v).toBe(SCHEMA_VERSION);
  });

  it('migrate refuses a database newer than the package', async () => {
    await db.exec(`begin; create or replace function nexgen.nexgen_schema_version() returns text language sql immutable as $$ select '9.0.0'::text $$;`);
    try {
      await expect(migrate(sqlClient(db), { root: repoRoot })).rejects.toThrow(/^package_too_old: the database is at 9.0.0/);
    } finally {
      await db.exec('rollback');
    }
  });

  it('migrate refuses a core no installer recorded, older than the floor', async () => {
    await db.exec('begin; drop function nexgen.nexgen_schema_version(); drop table nexgen.schema_migrations;');
    try {
      expect(await databaseVersion(sqlClient(db))).toBe('0.0.0');
      await expect(migrate(sqlClient(db), { root: repoRoot })).rejects.toThrow(/^database_too_old: run nexgen-os migrate of version/);
    } finally {
      await db.exec('rollback');
    }
  });
});
