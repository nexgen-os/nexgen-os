// A document an owner publishes is kept as it was published (decision 0015):
// one row per version, a copy of the document with its licence and its
// sources, a sha256 the database writes, and its withdrawal as its only
// change.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, USER_B, asUser, freshDatabase, one, organisation } from './helpers/db.js';

const EDITOR = '00000000-0000-4000-8000-0000000000c1';
const CHECKSUM = `sha256:${'ab'.repeat(32)}`;

let db: PGlite;
let org: string;
let doc: string;

const owner = <T>(fn: () => Promise<T>) => asUser(db, USER_A, fn);

beforeAll(async () => {
  db = await freshDatabase();
  org = await organisation(db, 'A city', USER_A);
  for (const id of [USER_B, EDITOR]) await db.query('insert into auth.users (id) values ($1) on conflict do nothing', [id]);
  await db.query(`insert into organisation_members (organisation_id, user_id, role) values ($1, $2, 'editor')`, [org, EDITOR]);
  await db.query(`insert into sources (code, name, license, attribution, redistributable) values
    ('open_register', 'An open register', 'CC-BY-4.0', 'The register', true),
    ('roof_layers', 'A solar API', 'Proprietary', null, false)`);
  doc = await owner(async () => (await one<{ id: string }>(db,
    `select attach_document('organisation', $1, 'District solar study', 'report', 's3://studies/district-v1.pdf',
                            'application/pdf', 'open_register', null, null, 1024, $2) id`, [org, CHECKSUM])).id);
});

afterAll(async () => {
  await db.close();
});

describe('publish()', () => {
  it('freezes a copy of the document with its licence, its sources and a sha256 the database writes', async () => {
    const id = await owner(async () => (await one<{ id: string }>(db, `select publish($1, ' CC-BY-4.0 ') id`, [doc])).id);
    const p = await owner(() => one<Record<string, unknown>>(db, 'select * from document_publications where id = $1', [id]));
    expect(p).toMatchObject({
      organisation_id: org, document_id: doc, version: 1, name: 'District solar study', kind: 'report',
      uri: 's3://studies/district-v1.pdf', media_type: 'application/pdf', checksum: CHECKSUM, license: 'CC-BY-4.0',
      sources: [{ code: 'open_register', name: 'An open register', license: 'CC-BY-4.0', attribution: 'The register' }],
      published_by: USER_A, withdrawn_at: null, withdrawn_by: null,
    });
    expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await one(db, 'select publication_digest(p) = p.sha256 same from document_publications p where id = $1', [id]))
      .toEqual({ same: true });
  });

  it('numbers the versions of a document, and the earlier one keeps what the document was', async () => {
    await db.query(`update documents set uri = 's3://studies/district-v2.pdf' where id = $1`, [doc]);
    await owner(() => db.query(`select publish($1, 'CC-BY-4.0')`, [doc]));
    const rows = await db.query<{ version: number; uri: string }>(
      'select version, uri from document_publications where document_id = $1 order by version', [doc]);
    expect(rows.rows).toEqual([
      { version: 1, uri: 's3://studies/district-v1.pdf' },
      { version: 2, uri: 's3://studies/district-v2.pdf' },
    ]);
  });

  it('refuses each thing a publication may not be, by its name', async () => {
    await expect(owner(() => db.query(`select publish($1, '')`, [doc]))).rejects.toThrow(/^license_required/);
    await expect(owner(() => db.query(`select publish($1, 'CC0-1.0', array['roof_layers'])`, [doc])))
      .rejects.toThrow(/^source_not_redistributable: the licence of roof_layers/);
    await expect(owner(() => db.query(`select publish($1, 'CC0-1.0', array['nowhere'])`, [doc]))).rejects.toThrow(/^source_unknown: nowhere/);
    const bare = await owner(async () => (await one<{ id: string }>(db,
      `select attach_document('organisation', $1, 'A photo', 'image', 's3://photos/roof.jpg') id`, [org])).id);
    await expect(owner(() => db.query(`select publish($1, 'CC0-1.0')`, [bare]))).rejects.toThrow(/^checksum_required/);
  });

  it('is a gesture of an owner: an editor is refused, a stranger does not see the document', async () => {
    await expect(asUser(db, EDITOR, () => db.query(`select publish($1, 'CC-BY-4.0')`, [doc]))).rejects.toThrow(/^not_allowed/);
    await expect(asUser(db, USER_B, () => db.query(`select publish($1, 'CC-BY-4.0')`, [doc]))).rejects.toThrow(/^document_not_found/);
    expect((await asUser(db, EDITOR, () => db.query('select id from document_publications'))).rows).toHaveLength(2);
    expect((await asUser(db, USER_B, () => db.query('select id from document_publications'))).rows).toHaveLength(0);
  });
});

describe('a publication is kept as it was published', () => {
  it('refuses a change, by a person or by the superuser', async () => {
    // No person writes the table: the gestures do.
    for (const sql of [
      `update document_publications set license = 'CC0-1.0'`,
      'delete from document_publications',
      `insert into document_publications (organisation_id, version, name, kind, uri, checksum, license, published_by, sha256)
       values ('${org}', 9, 'Forged', 'report', 's3://x', '${CHECKSUM}', 'CC0-1.0', '${USER_A}', '${'0'.repeat(64)}')`,
    ]) await expect(owner(() => db.query(sql)), sql).rejects.toThrow(/permission denied/);
    await expect(db.query(`update document_publications set uri = 's3://elsewhere' where document_id = $1`, [doc]))
      .rejects.toThrow(/^publication_frozen/);
  });

  it('writes its own sha256 whatever the writer gives', async () => {
    const p = await one<{ same: boolean }>(db,
      `insert into document_publications (organisation_id, version, name, kind, uri, checksum, license, published_by, sha256)
       values ($1, 1, 'By hand', 'report', 's3://y', $2, 'CC0-1.0', $3, $4) returning publication_digest(document_publications) = sha256 same`,
      [org, CHECKSUM, USER_A, 'f'.repeat(64)]);
    expect(p.same).toBe(true);
  });

  it('is withdrawn once, by an owner, and withdrawing is its only change', async () => {
    const { id } = await one<{ id: string }>(db, 'select id from document_publications where document_id = $1 and version = 1', [doc]);
    await expect(asUser(db, EDITOR, () => db.query('select withdraw($1)', [id]))).rejects.toThrow(/^not_allowed/);
    await expect(asUser(db, USER_B, () => db.query('select withdraw($1)', [id]))).rejects.toThrow(/^publication_not_found/);
    await owner(() => db.query('select withdraw($1)', [id]));
    const p = await one<{ withdrawn_by: string; same: boolean }>(db,
      'select withdrawn_by, publication_digest(p) = sha256 same from document_publications p where id = $1', [id]);
    expect(p).toEqual({ withdrawn_by: USER_A, same: true });
    await expect(owner(() => db.query('select withdraw($1)', [id]))).rejects.toThrow(/^publication_withdrawn/);
    await expect(db.query('update document_publications set withdrawn_at = null, withdrawn_by = null where id = $1', [id]))
      .rejects.toThrow(/^publication_withdrawn/);
  });

  it('outlives the document it was published from', async () => {
    await db.query('delete from documents where id = $1', [doc]);
    const rows = await db.query<{ document_id: string | null; uri: string; same: boolean }>(
      `select document_id, uri, publication_digest(p) = sha256 same from document_publications p
        where uri like 's3://studies/%' order by version`);
    expect(rows.rows).toEqual([
      { document_id: null, uri: 's3://studies/district-v1.pdf', same: true },
      { document_id: null, uri: 's3://studies/district-v2.pdf', same: true },
    ]);
  });
});

describe('the anonymous role', () => {
  it('reaches neither the table nor the gestures', async () => {
    const r = await one<{ t: boolean; p: boolean; w: boolean }>(db,
      `select has_table_privilege('anon', 'nexgen.document_publications', 'select') t,
              has_function_privilege('anon', 'nexgen.publish(uuid, text, text[])', 'execute') p,
              has_function_privilege('anon', 'nexgen.withdraw(uuid)', 'execute') w`);
    expect(r).toEqual({ t: false, p: false, w: false });
  });
});
