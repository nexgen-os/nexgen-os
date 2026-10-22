// A district surveyed from open data: a project with a perimeter, footprints
// arriving in a projected CRS (UTM 28N here) and in WGS 84, buildings known
// by their OpenStreetMap identifiers, and a spatial query over the
// perimeter.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase, insert, one, organisation, participant } from '../../../tests/helpers/db.js';

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
  db = await freshDatabase(['building', 'community']);
  org = await organisation(db, 'A city');
  const outline = await one<{ g: string }>(
    db,
    `select ST_AsGeoJSON(ST_Transform(ST_MakeEnvelope(236000, 1630000, 237000, 1631000, 32628), 4326)) g`,
  );
  district = await insert(db, 'projects', {
    organisation_id: org, name: 'Plateau', kind: 'district_plan', country: 'SN', geometry: JSON.parse(outline.g),
  });
  for (const [i, x] of [236100, 236300, 236500].entries()) {
    const plot = await insert(db, 'participants', { organisation_id: org, project_id: district, name: `Plot ${i + 1}`, country: 'SN', city: 'Dakar' });
    await insert(db, 'building.buildings', {
      organisation_id: org, participant_id: plot, name: `Building ${i + 1}`, footprint: utmFootprint(x, 1630400), height_m: 9 + 3 * i,
      source_code: 'openstreetmap', global_id: `way/${1000 + i}`,
    });
  }
  // One building outside the district, to prove the spatial query.
  const outside = await participant(db, { organisation_id: org, name: 'Far plot', country: 'SN' });
  await insert(db, 'building.buildings', { organisation_id: org, participant_id: outside, name: 'Outside', footprint: utmFootprint(240000, 1640000), height_m: 6 });
});

afterAll(async () => {
  await db.close();
});

describe('a district from open data', () => {
  it('normalises a projected footprint to WGS 84 3D and keeps its area in metres', async () => {
    const r = await one<{ srid: number; dims: number; area: string }>(
      db,
      `select ST_SRID(footprint) srid, ST_NDims(footprint) dims, area_m2(footprint) area from building.buildings where name = 'Building 1'`,
    );
    expect(r.srid).toBe(4326);
    expect(r.dims).toBe(3);
    expect(Number(r.area)).toBeCloseTo(300, 0);
  });

  it('finds the buildings inside the district perimeter', async () => {
    const r = await db.query<{ name: string }>(
      `select b.name from building.buildings b, projects p
        where p.id = $1 and ST_Within(ST_Force2D(b.footprint), ST_Force2D(p.geometry))
        order by b.name`,
      [district],
    );
    expect(r.rows.map((x) => x.name)).toEqual(['Building 1', 'Building 2', 'Building 3']);
  });

  it('finds a building by its OpenStreetMap identifier', async () => {
    const r = await one<{ name: string }>(
      db,
      `select b.name from building.buildings b where b.source_code = 'openstreetmap' and b.global_id = 'way/1001'`,
    );
    expect(r.name).toBe('Building 2');
  });

  it('refuses the same identifier on two objects', async () => {
    const b3 = await one<{ id: string }>(db, `select id from building.buildings where name = 'Building 3'`);
    await expect(
      db.query(`update building.buildings set global_id = 'way/1001' where id = $1`, [b3.id]),
    ).rejects.toThrow(/duplicate key/);
  });

  it('counts the district by its participants', async () => {
    const r = await one<{ n: number }>(db, 'select count(*)::int n from participants where project_id = $1', [district]);
    expect(r.n).toBe(3);
  });
});
