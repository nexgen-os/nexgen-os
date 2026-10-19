// `nexgen-os pack build` and `pack check` on the fixture pack `xa`: files in,
// one SQL file out, every refusal by name. No database.
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../../../tests/helpers/db.js';
import { buildPacks, checkPacks, executableContent, main, readCatalogue, readSchema, validate, type PackReport } from '../src/index.js';
import { unsupportedKeywords } from '../src/pack/schema.js';
import { FIXTURE, checkout, edit } from './pack-checkout.js';

const codes = (r: PackReport) => r.problems.map((p) => p.code);

async function cli(argv: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { out: (l) => out.push(l), err: (l) => err.push(l), env: {} });
  return { code, out, err };
}

describe('the published schema', () => {
  it('uses only keywords the validator checks', async () => {
    const schema = JSON.parse(await readFile(join(repoRoot, 'packs/schema/pack.1.json'), 'utf8'));
    expect(unsupportedKeywords(schema)).toEqual([]);
  });

  it('accepts the fixture manifest and refuses an unknown field by its path', async () => {
    const schema = await readSchema(repoRoot);
    const manifest = JSON.parse(await readFile(join(FIXTURE, 'packs/xa/pack.json'), 'utf8'));
    expect(validate(manifest, schema)).toEqual([]);
    const issues = validate({ ...manifest, identity: { ...manifest.identity, hook: 'x' } }, schema);
    expect(issues.map((i) => `${i.path} ${i.message}`)).toEqual(['identity unknown field "hook"']);
  });
});

describe('pack check', () => {
  it('finds the committed seed and the checksum to be the output of the pack', async () => {
    const root = await checkout();
    const r = await checkPacks(root, { all: true });
    expect(r.problems).toEqual([]);
    expect(r.packs).toEqual([{ pack: 'xa', version: '0.1.0', file: 'core/seed/10_pack_xa.sql', state: 'up_to_date' }]);
  });

  it('reads JSON, not its layout: a pack indented otherwise has the same checksum', async () => {
    const root = await checkout();
    const path = join(root, 'packs/xa/defaults.json');
    await writeFile(path, JSON.stringify(JSON.parse(await readFile(path, 'utf8')), null, 4));
    expect((await checkPacks(root, { pack: 'xa' })).problems).toEqual([]);
  });

  it('refuses a seed that is not the output of its pack, and a pack that was not built', async () => {
    const root = await checkout();
    await edit(root, 'defaults.json', (j) => { j.defaults[2].reference = 'Yearly balance 2025, table 4'; });
    const r = await checkPacks(root, { all: true });
    expect(codes(r)).toEqual(['checksum_mismatch', 'seed_stale']);
    expect(r.packs[0]!.state).toBe('stale');
  });

  it('refuses a seed that is missing, and one that belongs to no pack', async () => {
    const root = await checkout();
    await rm(join(root, 'core/seed/10_pack_xa.sql'));
    await writeFile(join(root, 'core/seed/11_pack_xz.sql'), '-- left behind\n');
    expect(codes(await checkPacks(root, { all: true }))).toEqual(['seed_missing', 'seed_orphan']);
  });

  it('refuses a pack that fails the schema, naming the file and the path', async () => {
    const root = await checkout();
    await edit(root, 'sources.json', (j) => { j.sources[0].url = 'http://example.org/grid-code'; });
    const r = await checkPacks(root, { pack: 'xa' });
    expect(codes(r)).toEqual(['pack_schema_invalid']);
    expect(r.problems[0]!.detail).toMatch(/^packs\/xa\/sources\.json: sources\[0\]\.url does not match/);
  });

  it('refuses a default without a unit or without a reference, by name', async () => {
    const root = await checkout();
    await edit(root, 'defaults.json', (j) => { delete j.defaults[0].unit; delete j.defaults[1].reference; });
    await edit(root, 'grid.json', (j) => { delete j.thresholds[0].unit; });
    const r = await checkPacks(root, { pack: 'xa' });
    expect(codes(r).sort()).toEqual(['default_without_reference', 'default_without_unit', 'default_without_unit']);
    expect(r.problems.map((p) => p.detail)).toContain('packs/xa/grid.json: thresholds[0] missing "unit"');
  });

  it('refuses executable content wherever it hides', async () => {
    const root = await checkout();
    await edit(root, 'defaults.json', (j) => {
      j.defaults[0].value = { expression: 'power * 2' };
      j.defaults[1].reference = 'Article 12; drop table defaults; -- gone';
      j.defaults[2].value = '${process.env.NEXGEN_DB_URL}';
    });
    await edit(root, 'pack.json', (j) => { j.name = '=HYPERLINK("https://example.org")'; });
    const r = await checkPacks(root, { pack: 'xa' });
    expect(new Set(codes(r))).toEqual(new Set(['pack_executable']));
    expect(r.problems.map((p) => p.detail)).toEqual([
      'packs/xa/pack.json: name holds a spreadsheet formula: =HYPERLINK("https://example.org")',
      'packs/xa/defaults.json: defaults[0].value.expression is a field for a program',
      'packs/xa/defaults.json: defaults[1].reference holds a SQL statement: Article 12; drop table defaults; -- gone',
      'packs/xa/defaults.json: defaults[2].value holds a template placeholder: ${process.env.NEXGEN_DB_URL}',
    ]);
  });

  it('leaves prose alone', () => {
    expect(executableContent({ reference: 'Select the operator from the list in Article 4; see table 2.', pattern: '^[0-9]{4}$|^X$' })).toEqual([]);
  });

  it('refuses a region a row names and the identity does not declare', async () => {
    const root = await checkout();
    await edit(root, 'defaults.json', (j) => { j.defaults[3].region = 'XA-E'; });
    await edit(root, 'grid.json', (j) => { j.operators[1].regions = ['XA-N', 'XA-W']; });
    await edit(root, 'pack.json', (j) => { j.identity.regions[0].parent = 'XA-Z'; });
    const r = await checkPacks(root, { pack: 'xa' });
    expect(codes(r)).toEqual(['region_undeclared', 'region_undeclared', 'region_undeclared']);
    expect(r.problems.map((p) => p.detail.split(': ')[0])).toEqual(['packs/xa/pack.json', 'packs/xa/grid.json', 'packs/xa/defaults.json']);
  });

  it('refuses two values of one property at once, and a period that ends before it starts', async () => {
    const root = await checkout();
    await edit(root, 'defaults.json', (j) => {
      delete j.defaults[0].valid_to;
      j.defaults[2].valid_to = '2025-12-31';
    });
    const r = await checkPacks(root, { pack: 'xa' });
    expect(codes(r)).toEqual(['validity_invalid', 'validity_overlap']);
    expect(r.problems[1]!.detail).toMatch(/metering_step from 2025-01-01 starts before the value from 2020-01-01 ends; close that one with valid_to 2025-01-01/);
  });

  it('refuses an example that does not match, an undeclared source, grid operators without the grid module', async () => {
    const root = await checkout();
    await edit(root, 'identifiers.json', (j) => { j.identifiers[0].example = 'XA1234'; });
    await edit(root, 'defaults.json', (j) => { j.defaults[2].source_code = 'xa_unknown'; });
    await edit(root, 'pack.json', (j) => { delete j.modules; });
    expect(codes(await checkPacks(root, { pack: 'xa' }))).toEqual(['example_mismatch', 'module_required', 'source_undeclared']);
  });

  it('refuses a section listed and absent, a JSON file not listed, a reviewed pack without its reviewer', async () => {
    const root = await checkout();
    await edit(root, 'pack.json', (j) => { j.sections = ['identifiers', 'sources', 'defaults']; delete j.certification.reviewer; });
    await writeFile(join(root, 'packs/xa/golden.json'), '{}');
    const r = await checkPacks(root, { pack: 'xa' });
    expect(codes(r)).toEqual(['file_unlisted', 'file_unlisted']);
    await rm(join(root, 'packs/xa/golden.json'));
    await edit(root, 'pack.json', (j) => { j.sections.push('grid'); });
    expect(codes(await checkPacks(root, { pack: 'xa' }))).toEqual(['certification_incomplete']);
  });

  it('refuses, across packs, one seed number or one code claimed twice', async () => {
    const root = await checkout();
    await cp(join(root, 'packs/xa'), join(root, 'packs/xb'), { recursive: true });
    for (const file of await readdir(join(root, 'packs/xb'))) {
      const path = join(root, 'packs/xb', file);
      const text = (await readFile(path, 'utf8')).replaceAll('XA', 'XB').replaceAll('xa_', 'xb_').replace('"xb_statistics"', '"xa_statistics"');
      await writeFile(path, text);
    }
    const r = await checkPacks(root, { all: true });
    expect(codes(r)).toEqual(['seed_sequence_taken', 'code_taken']);
    expect(r.problems.map((p) => p.detail)).toEqual([
      'packs/xb: seed_sequence 10 is already published by packs/xa',
      'packs/xb: source xa_statistics is already published by packs/xa',
    ]);
  });

  it('lists a hand-written pack of release 0.1 with --all and refuses to compile it by name', async () => {
    const root = await checkout();
    await mkdir(join(root, 'packs/xh/seed'), { recursive: true });
    await writeFile(join(root, 'packs/xh/pack.json'), '{"country":"XH"}');
    await writeFile(join(root, 'packs/xh/seed/0001_xh.sql'), 'select 1;\n');
    const all = await checkPacks(root, { all: true });
    expect(all.problems).toEqual([]);
    expect(all.packs.map((p) => `${p.pack} ${p.state}`)).toEqual(['xa up_to_date', 'xh hand_written']);
    expect(codes(await buildPacks(root, { pack: 'xh' }))).toEqual(['pack_hand_written']);
  });
});

describe('pack build', () => {
  it('is the same bytes on the same pack, and writes nothing then', async () => {
    const root = await checkout();
    const r = await buildPacks(root, { pack: 'xa' });
    expect(r.packs[0]!.state).toBe('unchanged');
    expect(await readFile(join(root, 'core/seed/10_pack_xa.sql'), 'utf8')).toBe(await readFile(join(FIXTURE, 'core/seed/10_pack_xa.sql'), 'utf8'));
    expect(await readFile(join(root, 'packs/xa/pack.json'), 'utf8')).toBe(await readFile(join(FIXTURE, 'packs/xa/pack.json'), 'utf8'));
  });

  it('writes the seed and the checksum of a changed pack, after which the check passes', async () => {
    const root = await checkout();
    await edit(root, 'defaults.json', (j) => {
      j.defaults[2].valid_to = '2027-01-01';
      j.defaults.push({ ...j.defaults[2], value: 0.1, reference: 'Yearly balance 2026, table 3', valid_from: '2027-01-01', valid_to: undefined });
    });
    const before = JSON.parse(await readFile(join(root, 'packs/xa/pack.json'), 'utf8')).checksum;
    expect((await buildPacks(root, { pack: 'xa' })).packs[0]!.state).toBe('written');
    const after = JSON.parse(await readFile(join(root, 'packs/xa/pack.json'), 'utf8')).checksum;
    expect(after).not.toBe(before);
    const seed = await readFile(join(root, 'core/seed/10_pack_xa.sql'), 'utf8');
    expect(seed).toContain(`-- checksum       ${after}`);
    expect(seed).toContain(`'2026-01-01'::date, '2027-01-01'::date`);
    expect(seed).toContain(`('grid_co2_factor'::text, null::text, '0.1'::jsonb`);
    expect((await checkPacks(root, { all: true })).problems).toEqual([]);
  });

  it('writes nothing for a pack it refuses', async () => {
    const root = await checkout();
    await edit(root, 'defaults.json', (j) => { j.defaults[0].region = 'XA-E'; });
    const r = await buildPacks(root, { pack: 'xa' });
    expect(codes(r)).toEqual(['region_undeclared']);
    expect(await readFile(join(root, 'core/seed/10_pack_xa.sql'), 'utf8')).toBe(await readFile(join(FIXTURE, 'core/seed/10_pack_xa.sql'), 'utf8'));
  });
});

describe('the installer', () => {
  it('applies a compiled seed as its pack, never as the core, with the modules the pack names', async () => {
    const catalogue = await readCatalogue(FIXTURE);
    expect(catalogue.core).toEqual([]);
    expect(catalogue.packs.get('xa')).toEqual({ code: 'xa', modules: ['grid'], steps: [{ name: 'core/seed/10_pack_xa.sql', scope: 'pack:xa' }] });
  });
});

describe('the command line', () => {
  it('checks without a database, and exits 1 with one named line per problem', async () => {
    const root = await checkout();
    const ok = await cli(['pack', 'check', '--all', '--root', root]);
    expect(ok.code).toBe(0);
    expect(ok.out).toEqual(['  xa  0.1.0  core/seed/10_pack_xa.sql  the output of its pack', 'no problem found']);
    await edit(root, 'grid.json', (j) => { j.operators[0].name = 'Transmission operator'; });
    const stale = await cli(['pack', 'check', '--all', '--root', root]);
    expect(stale.code).toBe(1);
    expect(stale.out.filter((l) => /^ {2}[a-z_]+: /.test(l)).map((l) => l.trim().split(':')[0])).toEqual(['checksum_mismatch', 'seed_stale']);
    expect(stale.out.at(-1)).toBe('run nexgen-os pack build --all and commit the result');
    expect((await cli(['pack', 'build', 'xa', '--root', root])).code).toBe(0);
    expect((await cli(['pack', 'check', 'xa', '--root', root, '--json'])).out.join('\n')).toContain('"state": "up_to_date"');
  });

  it('refuses a usage it does not know with exit 2, and a folder that is not a checkout with exit 1', async () => {
    expect((await cli(['pack', 'check'])).code).toBe(2);
    expect((await cli(['pack', 'check', 'xa', '--all'])).code).toBe(2);
    expect((await cli(['pack', 'publish', 'xa'])).code).toBe(2);
    expect((await cli(['status', 'extra'])).code).toBe(2);
    const empty = await mkdtemp(join(tmpdir(), 'nexgen-empty-'));
    const r = await cli(['pack', 'check', '--all', '--root', empty]);
    expect(r.code).toBe(1);
    expect(r.err[0]).toMatch(/^not_a_checkout: /);
    const root = await checkout();
    const unknown = await cli(['pack', 'build', 'zz', '--root', root]);
    expect(unknown.err[0]).toMatch(/^unknown_pack: zz; this checkout carries: xa/);
  });
});
