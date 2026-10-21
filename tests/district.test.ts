// A district surveyed from open data: a project with a perimeter, footprints
// arriving in a projected CRS (UTM 28N here) and in WGS 84, buildings known
// by their OpenStreetMap identifiers, a building shading a roof face, a site
// split in two, and a spatial query over the perimeter.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase, insert, one, organisation } from './helpers/db.js';

let db: PGlite;
let org: string;
let district: string;

// A 20 m × 15 m footprint in UTM zone 28N (EPSG:32628), near Dakar.
const utmFootprint = (x: number, y: number) => ({
  type: 'Polygon',
  crs: { type: 'name', properties: { name: 'EPSG:32628' } },
  coordinates: [[[x, y], [x + 20, y], [x + 20, y + 15], [x, y + 15], [x, y]]],
});

beforeAll(async () => {
  db = await freshDatabase(['community']);
  org = await organisation(db, 'A city');
  const outline = await one<{ g: string }>(
    db,
    `select ST_AsGeoJSON(ST_Transform(ST_MakeEnvelope(236000, 1630000, 237000, 1631000, 32628), 4326)) g`,
  );
  district = await insert(db, 'projects', {
    organisation_id: org, name: 'Plateau', kind: 'district_plan', country: 'SN', geometry: JSON.parse(outline.g),
  });
  for (const [i, x] of [236100, 236300, 236500].entries()) {
    const site = await insert(db, 'sites', { organisation_id: org, name: `Plot ${i + 1}`, country: 'SN', city: 'Dakar' });
    const b = await insert(db, 'buildings', {
      organisation_id: org, site_id: site, name: `Building ${i + 1}`, footprint: utmFootprint(x, 1630400), height_m: 9 + 3 * i,
    });
    await db.query(`insert into external_ids (object_id, scheme, value) values ($1, 'osm', $2)`, [b, `way/${1000 + i}`]);
    await insert(db, 'participants', { organisation_id: org, project_id: district, site_id: site, name: `Plot ${i + 1}` });
  }
  // One building outside the district, to prove the spatial query.
  const outside = await insert(db, 'sites', { organisation_id: org, name: 'Far plot', country: 'SN' });
  await insert(db, 'buildings', { organisation_id: org, site_id: outside, name: 'Outside', footprint: utmFootprint(240000, 1640000), height_m: 6 });
});

afterAll(async () => {
  await db.close();
});

describe('a district from open data', () => {
  it('normalises a projected footprint to WGS 84 3D and keeps its area in metres', async () => {
    const r = await one<{ srid: number; dims: number; area: string }>(
      db,
      `select ST_SRID(footprint) srid, ST_NDims(footprint) dims, area_m2(footprint) area from buildings where name = 'Building 1'`,
    );
    expect(r.srid).toBe(4326);
    expect(r.dims).toBe(3);
    expect(Number(r.area)).toBeCloseTo(300, 0);
  });

  it('finds the buildings inside the district perimeter', async () => {
    const r = await db.query<{ name: string }>(
      `select b.name from buildings b, projects p
        where p.id = $1 and ST_Within(ST_Force2D(b.footprint), ST_Force2D(p.geometry))
        order by b.name`,
      [district],
    );
    expect(r.rows.map((x) => x.name)).toEqual(['Building 1', 'Building 2', 'Building 3']);
  });

  it('finds a building by its OpenStreetMap identifier', async () => {
    const r = await one<{ name: string }>(
      db,
      `select b.name from external_ids x join buildings b on b.id = x.object_id where x.scheme = 'osm' and x.value = 'way/1001'`,
    );
    expect(r.name).toBe('Building 2');
  });

  it('refuses the same identifier on two objects', async () => {
    const b3 = await one<{ id: string }>(db, `select id from buildings where name = 'Building 3'`);
    await expect(
      db.query(`insert into external_ids (object_id, scheme, value) values ($1, 'osm', 'way/1001')`, [b3.id]),
    ).rejects.toThrow(/duplicate key/);
  });

  it('records a tall building shading the roof of its neighbour', async () => {
    const b3 = await one<{ id: string }>(db, `select id from buildings where name = 'Building 3'`);
    const b2 = await one<{ id: string }>(db, `select id from buildings where name = 'Building 2'`);
    const roof = await insert(db, 'surfaces', { organisation_id: org, building_id: b2.id, name: 'Roof 2', kind: 'roof', tilt_deg: 0 });
    await db.query(`insert into links (subject_id, type_code, object_id) values ($1, 'shades', $2)`, [b3.id, roof]);
    const r = await one<{ n: number }>(db, `select count(*)::int n from links where type_code = 'shades'`);
    expect(r.n).toBe(1);
  });

  it('keeps the trace of a plot split in two, as split_into links', async () => {
    const p = await one<{ id: string }>(db, `select id from sites where name = 'Plot 1'`);
    const a = await insert(db, 'sites', { organisation_id: org, name: 'Plot 1a', country: 'SN' });
    const b = await insert(db, 'sites', { organisation_id: org, name: 'Plot 1b', country: 'SN' });
    await db.query(`select split_object($1, array[$2, $3]::uuid[], '2026-02-01')`, [p.id, a, b]);
    const r = await db.query<{ name: string; dated: boolean }>(
      `select s.name, l.valid_from = '2026-02-01'::timestamptz dated from links l join sites s on s.id = l.object_id
        where l.subject_id = $1 and l.type_code = 'split_into' order by s.name`,
      [p.id],
    );
    expect(r.rows).toEqual([{ name: 'Plot 1a', dated: true }, { name: 'Plot 1b', dated: true }]);
  });

  it('merges only objects of one kind and one organisation', async () => {
    const [p2, p3] = (await db.query<{ id: string }>(`select id from sites where name in ('Plot 2', 'Plot 3') order by name`)).rows.map((r) => r.id);
    const merged = await insert(db, 'sites', { organisation_id: org, name: 'Plots 2 and 3', country: 'SN' });
    await db.query(`select merge_objects(array[$1, $2]::uuid[], $3)`, [p2, p3, merged]);
    const r = await one<{ n: number }>(db, `select count(*)::int n from links where type_code = 'merged_into' and object_id = $1`, [merged]);
    expect(r.n).toBe(2);
    const b1 = await one<{ id: string }>(db, `select id from buildings where name = 'Building 1'`);
    await expect(db.query(`select merge_objects(array[$1]::uuid[], $2)`, [b1.id, merged])).rejects.toThrow(/object_kind_mismatch/);
    const elsewhere = await organisation(db, 'Another city');
    const theirs = await insert(db, 'sites', { organisation_id: elsewhere, name: 'Their plot', country: 'SN' });
    await expect(db.query(`select split_object($1, array[$2]::uuid[])`, [merged, theirs])).rejects.toThrow(/object_in_other_organisation/);
  });

  it('counts the district by its participants', async () => {
    const r = await one<{ n: number }>(db, 'select count(*)::int n from participants where project_id = $1', [district]);
    expect(r.n).toBe(3);
  });
});
