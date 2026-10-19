/**
 * `nexgen-os pack build` and `nexgen-os pack check`: files in, one SQL file
 * out, no database and no network. Both run in a checkout of the repository,
 * where `packs/` and its schema are; a published installation holds the
 * compiled seeds and nothing to compile.
 *
 *   pack build <cc>|--all   validate, compile to core/seed/<n>_pack_<cc>.sql,
 *                           write the checksum into pack.json
 *   pack check <cc>|--all   the same in memory, and refuse a seed or a
 *                           checksum that is not the output of its pack
 *
 * A pack of release 0.1, whose rows are `seed/*.sql` written by hand, is
 * listed by `--all` and left alone; asked for by name, it is refused.
 */
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Problem } from '../doctor.js';
import { NexgenError } from '../errors.js';
import { checkAcross, checkPack } from './check.js';
import { compilePack } from './compile.js';
import { SEED_DIR, isHandWritten, manifestWithChecksum, packFolders, readPack, readSchema, seedPath, type Pack } from './read.js';

export type PackState = 'written' | 'unchanged' | 'up_to_date' | 'stale' | 'refused' | 'hand_written';

export interface PackLine {
  pack: string;
  version?: string;
  /** The seed, relative to the checkout. */
  file?: string;
  state: PackState;
}

export interface PackReport {
  action: 'build' | 'check';
  packs: PackLine[];
  problems: Problem[];
}

export interface PackSelection {
  /** One pack by its folder name, or every pack of the checkout. */
  pack?: string;
  all?: boolean;
}

/** Compiles the packs selected and writes what changed. */
export function buildPacks(root: string, selection: PackSelection): Promise<PackReport> {
  return run('build', root, selection);
}

/** Recompiles the packs selected in memory and says what is not their output. */
export function checkPacks(root: string, selection: PackSelection): Promise<PackReport> {
  return run('check', root, selection);
}

async function run(action: 'build' | 'check', root: string, selection: PackSelection): Promise<PackReport> {
  const schema = await readSchema(root);
  const folders = await packFolders(root);
  const slugs = selected(folders, selection);
  const report: PackReport = { action, packs: [], problems: [] };

  const valid: Pack[] = [];
  const refusedBy = new Map<string, Problem[]>();
  for (const slug of slugs) {
    if (await isHandWritten(root, slug)) {
      report.packs.push({ pack: slug, state: 'hand_written' });
      if (!selection.all) report.problems.push({ code: 'pack_hand_written', detail: `packs/${slug}: its rows are seed/*.sql written by hand; there is nothing to compile` });
      continue;
    }
    const reading = await readPack(root, slug, schema);
    const problems = [...reading.problems, ...(reading.pack ? checkPack(reading.pack) : [])];
    if (reading.pack && problems.length === 0) valid.push(reading.pack);
    refusedBy.set(slug, problems);
  }
  if (selection.all) {
    for (const problem of checkAcross(valid)) {
      const slug = /^packs\/([a-z]{2})/.exec(problem.detail)?.[1] ?? '';
      refusedBy.set(slug, [...(refusedBy.get(slug) ?? []), problem]);
    }
  }

  for (const [slug, problems] of refusedBy) {
    const pack = valid.find((p) => p.slug === slug);
    if (problems.length > 0 || pack === undefined) {
      report.packs.push({ pack: slug, ...(pack ? { version: pack.manifest.version, file: seedPath(pack.manifest) } : {}), state: 'refused' });
      report.problems.push(...problems);
      continue;
    }
    const file = seedPath(pack.manifest);
    const sql = compilePack(pack);
    const manifestPath = join(root, 'packs', slug, 'pack.json');
    const current = await readOptional(join(root, file));
    const line = { pack: slug, version: pack.manifest.version, file };

    if (action === 'build') {
      const changed = current !== sql || pack.manifest.checksum !== pack.checksum;
      if (current !== sql) await writeFile(join(root, file), sql, 'utf8');
      if (pack.manifest.checksum !== pack.checksum) await writeFile(manifestPath, manifestWithChecksum(pack.manifest, pack.checksum), 'utf8');
      report.packs.push({ ...line, state: changed ? 'written' : 'unchanged' });
      continue;
    }
    const stale: Problem[] = [];
    if (pack.manifest.checksum !== pack.checksum) {
      stale.push({ code: 'checksum_mismatch', detail: `packs/${slug}/pack.json: checksum ${pack.manifest.checksum ?? 'absent'}, the pack is ${pack.checksum}` });
    }
    if (current === undefined) stale.push({ code: 'seed_missing', detail: `${file}: the output of packs/${slug} is not committed` });
    else if (current !== sql) stale.push({ code: 'seed_stale', detail: `${file} is not the output of packs/${slug}` });
    report.packs.push({ ...line, state: stale.length > 0 ? 'stale' : 'up_to_date' });
    report.problems.push(...stale);
  }

  if (action === 'check' && selection.all) report.problems.push(...(await orphanSeeds(root, valid, folders)));
  report.packs.sort((a, b) => (a.pack < b.pack ? -1 : a.pack > b.pack ? 1 : 0));
  return report;
}

/** A compiled seed whose pack is gone or now carries another number. */
async function orphanSeeds(root: string, valid: Pack[], folders: string[]): Promise<Problem[]> {
  const dir = join(root, SEED_DIR);
  if (!existsSync(dir)) return [];
  const expected = new Set(valid.map((p) => seedPath(p.manifest)));
  const problems: Problem[] = [];
  for (const name of (await readdir(dir)).sort()) {
    const match = /^\d+_pack_([a-z]{2})\.sql$/.exec(name);
    if (match === null) continue;
    const file = `${SEED_DIR}/${name}`;
    const slug = match[1]!;
    // A pack that failed its checks already has its problem; its seed is not an orphan.
    if (expected.has(file) || (folders.includes(slug) && !valid.some((p) => p.slug === slug))) continue;
    problems.push({ code: 'seed_orphan', detail: `${file} is the output of no pack of this checkout` });
  }
  return problems;
}

function selected(folders: string[], selection: PackSelection): string[] {
  if (selection.all) return folders;
  if (selection.pack === undefined) throw new NexgenError('usage', 'name a pack or pass --all');
  const slug = selection.pack.toLowerCase();
  if (!folders.includes(slug)) throw new NexgenError('unknown_pack', `${selection.pack}; this checkout carries: ${folders.join(', ') || 'none'}`);
  return [slug];
}

async function readOptional(path: string): Promise<string | undefined> {
  return existsSync(path) ? readFile(path, 'utf8') : undefined;
}
