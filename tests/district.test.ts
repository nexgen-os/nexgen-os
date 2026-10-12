// A district surveyed from open data: footprints arriving in a projected CRS
// (UTM 28N here) and in WGS 84, buildings known by their OpenStreetMap and
// Overture identifiers, a tree shading a roof, a parcel split in two, and a
// spatial query over the district outline.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { entity, freshDatabase, one, workspace } from './helpers/db.js';

let db: PGlite;
let ws: string;
let district: string;

// A 20 m × 15 m footprint in UTM zone 28N (EPSG:32628), near Dakar.
const utmFootprint = (x: number, y: number) => ({
  type: 'Polygon',
  crs: { type: 'name', properties: { name: 'EPSG:32628' } },
  coordinates: [[[x, y], [x + 20, y], [x + 20, y + 15], [x, y + 15], [x, y]]],
});

beforeAll(async () => {
  db = await freshDatabase();
  ws = await workspace(db, 'A city');
  const outline = await one<{ g: string }>(
    db,
    `select ST_AsGeoJSON(ST_Transform(ST_MakeEnvelope(236000, 1630000, 237000, 1631000, 32628), 4326)) g`,
  );
  district = await entity(db, {
    workspace_id: ws, class: 'district', name: 'Plateau', country: 'SN', geometry: JSON.parse(outline.g),
  });
  for (const [i, x] of [236100, 236300, 236500].entries()) {
    const b = await entity(db, {
      workspace_id: ws, class: 'building', name: `Building ${i + 1}`, parent_id: district,
      geometry: utmFootprint(x, 1630400), height_m: 9 + 3 * i,
    });
    await db.query(`insert into external_ids (entity_id, scheme, value) values ($1, 'osm', $2)`, [b, `way/${1000 + i}`]);
  }
  // One building outside the district, to prove the spatial query.
  await entity(db, {
    workspace_id: ws, class: 'building', name: 'Outside', country: 'SN', geometry: utmFootprint(240000, 1640000), height_m: 6,
  });
});

afterAll(async () => {
  await db.close();
});

describe('a district from open data', () => {
  it('normalises a projected footprint to WGS 84 3D and keeps its area in metres', async () => {
    const r = await one<{ srid: number; dims: number; area: string }>(
      db,
      `select ST_SRID(geometry) srid, ST_NDims(geometry) dims, plan_area_m2(geometry) area from entities where name = 'Building 1'`,
    );
    expect(r.srid).toBe(4326);
    expect(r.dims).toBe(3);
    expect(Number(r.area)).toBeCloseTo(300, 0);
  });

  it('finds the buildings inside the district outline', async () => {
    const r = await db.query<{ name: string }>(
      `select b.name from entities b, entities d
        where d.id = $1 and b.class = 'building' and ST_Within(ST_Force2D(b.geometry), ST_Force2D(d.geometry))
        order by b.name`,
      [district],
    );
    expect(r.rows.map((x) => x.name)).toEqual(['Building 1', 'Building 2', 'Building 3']);
  });

  it('finds a building by its OpenStreetMap identifier', async () => {
    const r = await one<{ name: string }>(
      db,
      `select e.name from external_ids x join entities e on e.id = x.entity_id where x.scheme = 'osm' and x.value = 'way/1001'`,
    );
    expect(r.name).toBe('Building 2');
  });

  it('refuses the same identifier on two entities', async () => {
    const b3 = await one<{ id: string }>(db, `select id from entities where name = 'Building 3'`);
    await expect(
      db.query(`insert into external_ids (entity_id, scheme, value) values ($1, 'osm', 'way/1001')`, [b3.id]),
    ).rejects.toThrow(/duplicate key/);
  });

  it('records a tree shading a roof', async () => {
    const tree = await entity(db, { workspace_id: ws, class: 'vegetation', name: 'Baobab', parent_id: district, height_m: 14 });
    const b1 = await one<{ id: string }>(db, `select id from entities where name = 'Building 1'`);
    const roof = await entity(db, { workspace_id: ws, class: 'roof', name: 'Roof 1', parent_id: b1.id, tilt_deg: 0 });
    await db.query(`insert into relationships (subject_id, type_code, object_id) values ($1, 'shades', $2)`, [tree, roof]);
    const r = await one<{ n: number }>(db, `select count(*)::int n from relationships where type_code = 'shades'`);
    expect(r.n).toBe(1);
  });

  it('keeps the trace of a parcel split in two', async () => {
    const p = await entity(db, { workspace_id: ws, class: 'parcel', name: 'Parcel 12', parent_id: district, status: 'demolished' });
    const a = await entity(db, { workspace_id: ws, class: 'parcel', name: 'Parcel 12a', parent_id: district });
    const b = await entity(db, { workspace_id: ws, class: 'parcel', name: 'Parcel 12b', parent_id: district });
    await db.query(`insert into entity_lineage (from_id, to_id, kind) values ($1, $2, 'split'), ($1, $3, 'split')`, [p, a, b]);
    const r = await db.query<{ name: string }>(
      `select e.name from entity_lineage l join entities e on e.id = l.to_id where l.from_id = $1 order by e.name`,
      [p],
    );
    expect(r.rows.map((x) => x.name)).toEqual(['Parcel 12a', 'Parcel 12b']);
  });

  it('counts revisions of an entity', async () => {
    const b2 = await one<{ id: string }>(db, `select id from entities where name = 'Building 2'`);
    await db.query(`update entities set height_m = 12.5 where id = $1`, [b2.id]);
    await db.query(`update entities set name = 'Building 2 (school)' where id = $1`, [b2.id]);
    const r = await one<{ revision: number }>(db, `select revision from entities where id = $1`, [b2.id]);
    expect(r.revision).toBe(3);
  });
});
