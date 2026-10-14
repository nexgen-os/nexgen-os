// What an organisation shows the public: an owner publishes an open export
// of a site or a project, anyone reads it without signing in, nobody can
// change it, the owner withdraws it. The anonymous role reaches the one
// view it is given and nothing of the `nexgen` or `participation` schemas.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, USER_B, asUser, freshDatabase, insert, one, organisation } from './helpers/db.js';

const EDITOR = '00000000-0000-4000-8000-0000000000e1';

let db: PGlite;
let orgA: string;
let site: string;
let building: string;

/** An open export as `formats/geojson` writes it, reduced to what the database checks. */
const openDocument = (name: string, open = true) => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', id: site, geometry: { type: 'Point', coordinates: [4.35, 50.85, 0] }, properties: { kind: 'site', name } }],
  nexgen_os: { schema_version: '0.1.0', scenario_id: null, at: null, open, sources: [], withheld: 0 },
});

/** Runs `fn` as the API's anonymous role, the way a request without a token runs. */
async function asAnonymous<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec('set role anon');
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}

const publish = (fields: Record<string, unknown>) =>
  db.query<{ id: string }>(
    `insert into participation.publications (subject_id, scenario_id, title, license, document, organisation_id)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [fields.subject_id, fields.scenario_id ?? null, fields.title, fields.license, JSON.stringify(fields.document), fields.organisation_id ?? orgA],
  );

beforeAll(async () => {
  db = await freshDatabase(['participation']);
  orgA = await organisation(db, 'Ville de Namur', USER_A);
  await organisation(db, 'Somebody else', USER_B);
  await db.query('insert into auth.users (id) values ($1)', [EDITOR]);
  await db.query(`insert into organisation_members (organisation_id, user_id, role) values ($1, $2, 'editor')`, [orgA, EDITOR]);
  site = await insert(db, 'sites', { organisation_id: orgA, name: 'Town hall', country: 'BE', street: 'Rue de Fer 1' });
  building = await insert(db, 'buildings', { organisation_id: orgA, site_id: site, name: 'Main building' });
});

afterAll(async () => {
  await db.close();
});

describe('publishing', () => {
  let id: string;

  it('is an owner\'s act: the document, its licence, and what the database writes itself', async () => {
    const r = await asUser(db, USER_A, () => publish({ subject_id: site, title: 'Town hall — solar study', license: 'CC-BY-4.0', document: openDocument('Town hall') }));
    id = r.rows[0].id;
    const p = await one<{ publisher: string; subject_kind: string; document_hash: string; published_by: string; organisation_id: string }>(
      db, 'select publisher, subject_kind, document_hash, published_by, organisation_id from participation.publications where id = $1', [id],
    );
    expect(p).toMatchObject({ publisher: 'Ville de Namur', subject_kind: 'site', published_by: USER_A, organisation_id: orgA });
    const expected = await one<{ h: string }>(db, `select encode(sha256(convert_to($1::jsonb::text, 'UTF8')), 'hex') h`, [JSON.stringify(openDocument('Town hall'))]);
    expect(p.document_hash).toBe(expected.h);
  });

  it('is refused to an editor and to another organisation', async () => {
    await expect(asUser(db, EDITOR, () => publish({ subject_id: site, title: 'By an editor', license: 'CC-BY-4.0', document: openDocument('x') })))
      .rejects.toThrow(/row-level security/);
    // A stranger does not even see the site.
    await expect(asUser(db, USER_B, () => publish({ subject_id: site, title: 'Not mine', license: 'CC-BY-4.0', document: openDocument('x') })))
      .rejects.toThrow(/^object_not_found/);
  });

  it('takes only an open export, of a site or a project, with a licence', async () => {
    await expect(publish({ subject_id: site, title: 'Full export', license: 'CC-BY-4.0', document: openDocument('x', false) }))
      .rejects.toThrow(/publications_open_document/);
    await expect(publish({ subject_id: site, title: 'Not GeoJSON', license: 'CC-BY-4.0', document: { hello: 'world' } }))
      .rejects.toThrow(/publications_open_document/);
    await expect(publish({ subject_id: building, title: 'A building', license: 'CC-BY-4.0', document: openDocument('x') }))
      .rejects.toThrow(/^publication_subject_kind/);
    await expect(publish({ subject_id: site, title: 'No licence', license: ' ', document: openDocument('x') }))
      .rejects.toThrow(/publications_license_not_blank/);
  });

  it('cannot be backdated nor signed for somebody else', async () => {
    const r = await asUser(db, USER_A, () => db.query<{ published_at: Date; published_by: string }>(
      `insert into participation.publications (subject_id, title, license, document, organisation_id, published_at, published_by, document_hash)
       values ($1, 'Backdated', 'CC0-1.0', $2, $3, '2001-01-01', $4, 'forged') returning published_at, published_by`,
      [site, JSON.stringify(openDocument('Town hall')), orgA, USER_B],
    ));
    expect(r.rows[0].published_by).toBe(USER_A);
    expect(new Date(r.rows[0].published_at).getUTCFullYear()).toBeGreaterThan(2001);
  });

  it('never changes once published: only its withdrawal does', async () => {
    await expect(asUser(db, USER_A, () => db.query(`update participation.publications set title = 'Rewritten' where id = $1`, [id])))
      .rejects.toThrow(/^publication_is_final/);
    await expect(asUser(db, USER_A, () => db.query(`update participation.publications set document = $2 where id = $1`, [id, JSON.stringify(openDocument('Other'))])))
      .rejects.toThrow(/^publication_is_final/);
  });
});

describe('what anyone reads', () => {
  it('reads the publications not withdrawn, without signing in, through one view', async () => {
    const rows = await asAnonymous(() => db.query<Record<string, unknown>>('select * from participation_public.publications order by published_at, title'));
    expect(rows.rows.map((r) => r.title)).toEqual(['Town hall — solar study', 'Backdated']);
    expect(Object.keys(rows.rows[0]).sort()).toEqual(
      ['description', 'document', 'document_hash', 'id', 'license', 'media_type', 'published_at', 'publisher', 'subject_kind', 'title'],
    );
    expect(rows.rows[0]).toMatchObject({ publisher: 'Ville de Namur', subject_kind: 'site', license: 'CC-BY-4.0', media_type: 'application/geo+json' });
    expect((rows.rows[0].document as { features: unknown[] }).features).toHaveLength(1);
  });

  it('reaches nothing of the nexgen and participation schemas: no table, no function', async () => {
    await expect(asAnonymous(() => db.query('select * from nexgen.sites'))).rejects.toThrow(/permission denied/);
    await expect(asAnonymous(() => db.query('select * from participation.publications'))).rejects.toThrow(/permission denied/);
    await expect(asAnonymous(() => db.query(`select nexgen.attributes_of($1)`, [site]))).rejects.toThrow(/permission denied/);
    await expect(asAnonymous(() => db.query(`insert into participation_public.publications (title) values ('x')`))).rejects.toThrow(/permission denied/);
  });

  it('is the same for a stranger signed in: the view, not the organisation\'s rows', async () => {
    const theirs = await asUser(db, USER_B, () => db.query('select id from participation.publications'));
    expect(theirs.rows).toEqual([]);
    const pub = await asUser(db, USER_B, () => db.query('select title from participation_public.publications'));
    expect(pub.rows).toHaveLength(2);
  });
});

describe('withdrawing', () => {
  it('is an owner\'s act, once, and the public no longer sees it', async () => {
    const { id } = await one<{ id: string }>(db, `select id from participation.publications where title = 'Backdated'`);
    const byEditor = await asUser(db, EDITOR, () => db.query(`update participation.publications set withdrawn_at = now() where id = $1 returning id`, [id]));
    expect(byEditor.rows).toEqual([]);
    await asUser(db, USER_A, () => db.query(`update participation.publications set withdrawn_at = now() where id = $1`, [id]));
    await expect(asUser(db, USER_A, () => db.query(`update participation.publications set withdrawn_at = null where id = $1`, [id])))
      .rejects.toThrow(/^publication_is_final/);
    const rows = await asAnonymous(() => db.query<{ title: string }>('select title from participation_public.publications'));
    expect(rows.rows.map((r) => r.title)).toEqual(['Town hall — solar study']);
    // The organisation still sees what it withdrew, and may delete it.
    const mine = await asUser(db, EDITOR, () => db.query('select id from participation.publications'));
    expect(mine.rows).toHaveLength(2);
    await asUser(db, USER_A, () => db.query('delete from participation.publications where id = $1', [id]));
    expect((await db.query('select id from participation.publications')).rows).toHaveLength(1);
  });
});
