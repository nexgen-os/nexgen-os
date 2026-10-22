// Every module of the release has a manifest, `modules/<code>/module.json`,
// valid against modules/schema/module.1.json, and the manifest says what the
// module's first migration writes into `nexgen.modules`: the two never drift.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unsupportedKeywords, validate, type Schema } from '../packages/cli/src/pack/schema.js';
import { readCatalogue } from '../packages/cli/src/catalogue.js';
import { freshDatabase, repoRoot, shippedModules } from './helpers/db.js';

const schema = JSON.parse(readFileSync(join(repoRoot, 'modules/schema/module.1.json'), 'utf8')) as Schema;
const folders = shippedModules;
const manifest = (code: string) => JSON.parse(readFileSync(join(repoRoot, 'modules', code, 'module.json'), 'utf8'));

describe('the module manifests', () => {
  it('use only the keywords the validator walks', () => {
    expect(unsupportedKeywords(schema)).toEqual([]);
  });

  it.each(folders)('%s has a valid manifest named after its folder, and its migrations', (code) => {
    expect(existsSync(join(repoRoot, 'modules', code, 'module.json'))).toBe(true);
    const m = manifest(code);
    expect(validate(m, schema)).toEqual([]);
    expect(m.code).toBe(code);
    expect(existsSync(join(repoRoot, 'modules', code, 'supabase', 'migrations'))).toBe(true);
    expect(existsSync(join(repoRoot, 'modules', code, 'README.md'))).toBe(true);
  });

  it('are what the installer discovers', async () => {
    expect([...(await readCatalogue(repoRoot)).modules.keys()].sort()).toEqual(folders);
  });

  describe('once installed', () => {
    let db: PGlite;
    beforeAll(async () => {
      db = await freshDatabase(folders);
    });
    afterAll(async () => {
      await db?.close();
    });

    it('say what the row of each module in nexgen.modules says', async () => {
      const rows = (
        await db.query<Record<string, string>>(
          'select code, name, version, schema_name, requires_core_min, description from nexgen.modules order by code',
        )
      ).rows;
      expect(rows).toEqual(
        folders.map((code) => {
          const m = manifest(code);
          return { code: m.code, name: m.name, version: m.version, schema_name: m.schema, requires_core_min: m.requires.core, description: m.description };
        }),
      );
    });
  });
});
