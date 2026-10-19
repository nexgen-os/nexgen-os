// A site goes out as GeoJSON any web map reads: the farm of example 4, its
// buildings, roof faces, ground area and arrays, with their attributes,
// identifiers and yield runs, and the sources it owes. The open export
// leaves out the street, the serial numbers and whatever came from a source
// that may not be passed on; a scenario shows what it adds; a project goes
// out with its perimeter; row level security decides what is there at all.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bbox, exportGeoJson, type Feature, type FeatureCollection } from '../formats/geojson/index.js';
import { USER_A, USER_B, asUser, freshDatabase, insert, one, organisation, repoRoot } from './helpers/db.js';

const ORG = '00000000-0000-4000-8000-000400000001';
const SITE = '00000000-0000-4000-8000-000400000010';
const BARN = '00000000-0000-4000-8000-000400000021';
const BARN_ARRAY = '00000000-0000-4000-8000-000400000051';
const FIELD = '00000000-0000-4000-8000-000400000033';

let db: PGlite;
let shed: string;
let shedRoof: string;
let shedArray: string;

beforeAll(async () => {
  db = await freshDatabase(['community', 'grid']);
  await db.exec(await readFile(join(repoRoot, 'examples', '04-farm-solar.sql'), 'utf8'));
  await db.query('insert into auth.users (id) values ($1), ($2) on conflict do nothing', [USER_A, USER_B]);
  await db.query(`insert into organisation_members (organisation_id, user_id, role) values ($1, $2, 'owner')`, [ORG, USER_A]);
  await organisation(db, 'A neighbour', USER_B);

  // A source whose licence forbids passing on what it gave: a roof layer.
  await db.query(
    `insert into sources (code, name, kind, license, attribution, redistributable)
     values ('roof_layer', 'A commercial roof layer', 'api', 'Proprietary', '© Roof Layer Inc.', false)`,
  );
  await db.query(
    `insert into attributes (object_id, property_code, value, source_code) values
       ($1, 'floor_area', '280', 'openstreetmap'),
       ($1, 'energy_label', '"C"', 'roof_layer')`,
    [BARN],
  );
  // A shed described from that layer, its roof and the array on it.
  shed = await insert(db, 'buildings', {
    organisation_id: ORG, site_id: SITE, name: 'Shed', source_code: 'roof_layer', height_m: 4,
    footprint: { type: 'Polygon', coordinates: [[[2.7212, 50.7716], [2.7212, 50.7718], [2.7214, 50.7718], [2.7214, 50.7716], [2.7212, 50.7716]]] },
  });
  shedRoof = await insert(db, 'surfaces', { organisation_id: ORG, building_id: shed, name: 'Shed roof', kind: 'roof', azimuth_deg: 180, tilt_deg: 20, source_code: 'roof_layer' });
  shedArray = await insert(db, 'devices', {
    organisation_id: ORG, site_id: SITE, building_id: shed, surface_id: shedRoof, name: 'Shed array', device_type: 'solar', rated_power_kw: 6, serial_number: 'SN-0042',
  });
});

afterAll(async () => {
  await db.close();
});

const byId = (fc: FeatureCollection, id: string): Feature => {
  const f = fc.features.find((x) => x.id === id);
  if (!f) throw new Error(`no feature ${id}`);
  return f;
};

/** Twice the signed area of a ring in degrees: positive when counter-clockwise. */
const signedArea = (ring: number[][]) => ring.slice(0, -1).reduce((s, p, i) => s + p[0] * ring[i + 1][1] - ring[i + 1][0] * p[1], 0);

describe('the GeoJSON export of a site', () => {
  let fc: FeatureCollection;

  beforeAll(async () => {
    fc = await exportGeoJson(db, { siteId: SITE });
  });

  it('is one FeatureCollection: the site, its buildings, surfaces and devices, in that order', () => {
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features.map((f) => f.properties.kind)).toEqual([
      'site', 'building', 'building', 'building', 'surface', 'surface', 'surface', 'surface', 'surface',
      'device', 'device', 'device', 'device', 'device', 'device',
    ]);
    expect(fc.nexgen_os).toMatchObject({ schema_version: '0.2.0', scenario_id: null, at: null, open: false, withheld: 0 });
  });

  it('writes WGS 84 positions with their height, outer rings counter-clockwise, and the box around them', () => {
    const barn = byId(fc, BARN);
    expect(barn.geometry?.type).toBe('Polygon');
    const ring = (barn.geometry!.coordinates as number[][][])[0];
    expect(ring[0]).toHaveLength(3);
    expect(ring[0][0]).toBeCloseTo(2.72, 2);
    expect(ring[0][1]).toBeCloseTo(50.77, 2);
    expect(signedArea(ring)).toBeGreaterThan(0);
    expect(fc.bbox).toEqual(bbox(fc.features));
    const [w, s, e, n] = fc.bbox!;
    expect([w, s, e, n]).toEqual([2.721, 50.7705, 2.725, 50.773]);
    // A roof face without a shape is still a feature, with a null geometry.
    expect(byId(fc, '00000000-0000-4000-8000-000400000031').geometry).toBeNull();
  });

  it('carries the columns, the attributes, the identifiers and the runs of every object', () => {
    const site = byId(fc, SITE).properties;
    expect(site).toMatchObject({ name: 'Ferme du Mont Noir', country: 'FR', street: 'Route de Boeschepe 3', postal_code: '59270', time_zone: 'Europe/Paris', profile: 'agricultural' });
    expect(site.attributes).toEqual({ annual_consumption: 186000 });

    const barn = byId(fc, BARN).properties;
    expect(barn).toMatchObject({ site_id: SITE, height_m: 8, elevation_m: 64 });
    expect(barn.attributes).toEqual({ floor_area: 280, energy_label: 'C', floors_above_ground: 1, year_built: 2004 });
    expect(barn.external_ids).toEqual([{ scheme: 'osm', value: 'way/445566778' }]);

    const field = byId(fc, FIELD).properties;
    expect(field).toMatchObject({ surface_kind: 'ground', site_id: SITE, building_id: null, azimuth_deg: 180, tilt_deg: 0 });

    const array = byId(fc, BARN_ARRAY).properties;
    expect(array).toMatchObject({ device_type: 'solar', rated_power_kw: 99.19, unit_count: 182, installation_date: '2023-06-20', surface_id: '00000000-0000-4000-8000-000400000031' });
    expect(array.runs).toHaveLength(1);
    expect(array.runs[0]).toMatchObject({ module: 'solar', engine_version: 'pvgis-5.3+core-0.1.0', results: { annual_kwh: 99190 } });
    expect(array.runs[0].inputs_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(byId(fc, shedArray).properties.serial_number).toBe('SN-0042');
  });

  it('lists every source it draws on, with its licence and attribution', () => {
    expect(fc.nexgen_os.sources).toEqual([
      { code: 'openstreetmap', name: 'OpenStreetMap', license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors' },
      { code: 'roof_layer', name: 'A commercial roof layer', license: 'Proprietary', attribution: '© Roof Layer Inc.' },
    ]);
  });

  it('is the same document twice: nothing in it depends on the moment it was made', async () => {
    expect(await exportGeoJson(db, { siteId: SITE })).toEqual(fc);
  });

  it('leaves the runs out when asked', async () => {
    const lean = await exportGeoJson(db, { siteId: SITE }, { runs: false });
    expect(byId(lean, BARN_ARRAY).properties.runs).toEqual([]);
  });
});

describe('the open export', () => {
  let fc: FeatureCollection;

  beforeAll(async () => {
    fc = await exportGeoJson(db, { siteId: SITE }, { open: true });
  });

  it('keeps the postal code and the city, not the street', () => {
    const site = byId(fc, SITE).properties;
    expect(site).toMatchObject({ postal_code: '59270', city: 'Saint-Jans-Cappel' });
    expect(site).not.toHaveProperty('street');
    expect(site).not.toHaveProperty('address_extra');
  });

  it('withholds what a closed source described, with everything on it, and says how many', () => {
    const ids = fc.features.map((f) => f.id);
    expect(ids).not.toContain(shed);
    expect(ids).not.toContain(shedRoof);
    expect(ids).not.toContain(shedArray);
    expect(fc.nexgen_os.withheld).toBe(3);
    expect(fc.features).toHaveLength(12);
  });

  it('drops the attributes of a closed source, serial numbers and metadata, and owes only the open sources', () => {
    expect(byId(fc, BARN).properties.attributes).toEqual({ floor_area: 280, floors_above_ground: 1, year_built: 2004 });
    expect(byId(fc, BARN).properties).not.toHaveProperty('metadata');
    expect(fc.features.some((f) => 'serial_number' in f.properties)).toBe(false);
    expect(fc.nexgen_os.sources.map((s) => s.code)).toEqual(['openstreetmap']);
    expect(fc.nexgen_os.open).toBe(true);
  });

  it('keeps the runs: a scenario shared with the public is its figures beside its places', () => {
    expect(byId(fc, BARN_ARRAY).properties.runs[0].results).toEqual({ annual_kwh: 99190 });
  });
});

describe('a scenario, a moment, a project', () => {
  it('shows what a scenario adds and overrides, and reality without it', async () => {
    const scenario = await one<{ id: string }>(db, `insert into scenarios (organisation_id, name) values ($1, 'A battery') returning id`, [ORG]);
    const battery = await insert(db, 'devices', { organisation_id: ORG, site_id: SITE, name: 'Battery', device_type: 'battery', rated_power_kw: 50, scenario_id: scenario.id });
    await db.query(
      `insert into attributes (object_id, property_code, value, scenario_id, source) values ($1, 'annual_consumption', '150000', $2, 'with the battery')`,
      [SITE, scenario.id],
    );
    const variant = await exportGeoJson(db, { siteId: SITE }, { scenarioId: scenario.id });
    expect(byId(variant, battery).properties.device_type).toBe('battery');
    expect(byId(variant, SITE).properties.attributes).toEqual({ annual_consumption: 150000 });
    expect(variant.nexgen_os.scenario_id).toBe(scenario.id);
    // The yield runs were computed on reality, not on this variant.
    expect(byId(variant, BARN_ARRAY).properties.runs).toEqual([]);

    const reality = await exportGeoJson(db, { siteId: SITE });
    expect(reality.features.map((f) => f.id)).not.toContain(battery);
    expect(byId(reality, SITE).properties.attributes).toEqual({ annual_consumption: 186000 });
  });

  it('reads attributes at the moment asked', async () => {
    await db.query(
      `update attributes set valid_from = '2026-01-01' where object_id = $1 and property_code = 'floor_area'`,
      [BARN],
    );
    const before = await exportGeoJson(db, { siteId: SITE }, { at: '2025-06-01T00:00:00Z' });
    expect(byId(before, BARN).properties.attributes).toEqual({ energy_label: 'C', floors_above_ground: 1, year_built: 2004 });
    expect(before.nexgen_os.at).toBe('2025-06-01T00:00:00.000Z');
    // OpenStreetMap is owed for the identifier, not for an attribute that did not hold yet.
    expect(before.nexgen_os.sources.map((s) => s.code)).toEqual(['openstreetmap', 'roof_layer']);
  });

  it('exports a project: its perimeter first, then every site taking part', async () => {
    const project = await insert(db, 'community.projects', {
      organisation_id: ORG, name: 'Mont Noir solar plan', kind: 'study', country: 'FR', start_date: '2026-03-01',
      geometry: { type: 'Polygon', coordinates: [[[2.72, 50.77], [2.73, 50.77], [2.73, 50.775], [2.72, 50.775], [2.72, 50.77]]] },
    });
    await insert(db, 'community.participants', { organisation_id: ORG, project_id: project, site_id: SITE, name: 'The farm', role: 'prosumer' });
    const fc = await exportGeoJson(db, { projectId: project }, { open: true });
    expect(fc.features[0]).toMatchObject({ id: project, properties: { kind: 'project', project_kind: 'study', country: 'FR', start_date: '2026-03-01' } });
    expect(fc.features[1].id).toBe(SITE);
    expect(fc.features.filter((f) => f.properties.kind === 'site')).toHaveLength(1);
    expect(fc.bbox).toEqual([2.72, 50.77, 2.73, 50.775]);
  });
});

describe('what it refuses', () => {
  it('asks for one target', async () => {
    await expect(exportGeoJson(db, {})).rejects.toThrow(/^target_required/);
    await expect(exportGeoJson(db, { siteId: SITE, projectId: SITE })).rejects.toThrow(/^target_required/);
  });

  it('names a scenario it cannot find', async () => {
    await expect(exportGeoJson(db, { siteId: SITE }, { scenarioId: '00000000-0000-4000-8000-0000000000ff' })).rejects.toThrow(/^scenario_not_found/);
  });

  it('exports what row level security lets the user read, and nothing for anyone else', async () => {
    const mine = await asUser(db, USER_A, () => exportGeoJson(db, { siteId: SITE }));
    expect(mine.features.length).toBeGreaterThan(10);
    await expect(asUser(db, USER_B, () => exportGeoJson(db, { siteId: SITE }))).rejects.toThrow(/^site_not_found/);
  });
});
