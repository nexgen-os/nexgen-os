// A participant goes out as GeoJSON any web map reads: the farm of example 4
// and its arrays, with the ground, the buildings, roof faces and ground area
// the `building` module describes (tests/fixtures/farm-building.sql), with their columns,
// attributes, identifiers and yield estimates, and the sources it owes. The open
// export leaves out the address lines, the serial numbers and whatever came from a
// source that may not be passed on; a project goes out with its perimeter;
// row level security decides what is there at all.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bbox, type Feature } from '@nexgen-os/geojson';
import { exportGeoJson, type FeatureProperties, type GeoJsonExport as FeatureCollection } from '@nexgen-os/core';
import { USER_A, USER_B, asUser, freshDatabase, insert, organisation, repoRoot } from './helpers/db.js';

const ORG = '00000000-0000-4000-8000-000400000001';
const FARM = '00000000-0000-4000-8000-000400000010';
const GROUND = '00000000-0000-4000-8000-000400000015';
const BARN = '00000000-0000-4000-8000-000400000021';
const BARN_ARRAY = '00000000-0000-4000-8000-000400000051';
const FIELD = '00000000-0000-4000-8000-000400000033';

let db: PGlite;
let shed: string;
let shedRoof: string;
let shedArray: string;

beforeAll(async () => {
  db = await freshDatabase(['building', 'community', 'grid', 'solar']);
  await db.exec(await readFile(join(repoRoot, 'docs', 'demo', '04-farm-solar.sql'), 'utf8'));
  await db.exec(await readFile(join(repoRoot, 'tests', 'fixtures', 'farm-building.sql'), 'utf8'));
  await db.query('insert into auth.users (id) values ($1), ($2) on conflict do nothing', [USER_A, USER_B]);
  await db.query(`insert into organisation_members (organisation_id, user_id, role) values ($1, $2, 'owner')`, [ORG, USER_A]);
  await organisation(db, 'A neighbour', USER_B);

  // A source whose licence forbids passing on what it gave: a roof layer.
  await db.query(
    `insert into sources (code, name, kind, license, attribution, redistributable)
     values ('roof_layer', 'A commercial roof layer', 'api', 'Proprietary', '© Roof Layer Inc.', false)`,
  );
  await db.query(
    `insert into attributes (object_kind, object_id, attribute_type, value, source_code) values ('participant', $1, 'installed_power', '640', 'roof_layer')`,
    [FARM],
  );
  await db.query(`update building.buildings set floor_area_m2 = 280 where id = $1`, [BARN]);
  // A shed described from that layer, its roof and the array on it.
  shed = await insert(db, 'building.buildings', {
    organisation_id: ORG, participant_id: FARM, name: 'Shed', source_code: 'roof_layer', height_m: 4,
    footprint: { type: 'Polygon', coordinates: [[[2.7212, 50.7716], [2.7212, 50.7718], [2.7214, 50.7718], [2.7214, 50.7716], [2.7212, 50.7716]]] },
  });
  shedRoof = await insert(db, 'building.surfaces', { organisation_id: ORG, building_id: shed, name: 'Shed roof', kind: 'roof', azimuth_deg: 180, tilt_deg: 20, source_code: 'roof_layer' });
  shedArray = await insert(db, 'devices', {
    organisation_id: ORG, participant_id: FARM, name: 'Shed array', device_type: 'solar', rated_power_kw: 6, serial_number: 'SN-0042',
  });
});

afterAll(async () => {
  await db.close();
});

const byId = (fc: FeatureCollection, id: string): Feature<FeatureProperties> => {
  const f = fc.features.find((x) => x.id === id);
  if (!f) throw new Error(`no feature ${id}`);
  return f;
};

/** Twice the signed area of a ring in degrees: positive when counter-clockwise. */
const signedArea = (ring: number[][]) => ring.slice(0, -1).reduce((s, p, i) => s + p[0] * ring[i + 1][1] - ring[i + 1][0] * p[1], 0);

describe('the GeoJSON export of a participant', () => {
  let fc: FeatureCollection;

  beforeAll(async () => {
    fc = await exportGeoJson(db, { participantId: FARM });
  });

  it('is one FeatureCollection: the participant, its ground, buildings, surfaces and devices, in that order', () => {
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features.map((f) => f.properties.kind)).toEqual([
      'participant', 'site', 'building', 'building', 'building', 'surface', 'surface', 'surface', 'surface', 'surface',
      'device', 'device', 'device', 'device', 'device', 'device',
    ]);
    expect(fc.nexgen_os).toMatchObject({ schema_version: '0.4.0', at: null, open: false, withheld: 0 });
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

  it('carries the columns, the attributes, the identifiers and the calculations of every object', () => {
    const farm = byId(fc, FARM).properties;
    expect(farm).toMatchObject({ name: "Ferme de l'Exemple", country: 'FR', address_line1: "Chemin de l'Exemple 3", postal_code: '59270', time_zone: 'Europe/Paris' });
    expect(farm.attributes).toEqual({ annual_consumption: 186000, installed_power: 640 });

    const barn = byId(fc, BARN).properties;
    expect(barn).toMatchObject({
      participant_id: FARM, height_m: 8, elevation_m: 64, floor_area_m2: 280, floors_above_ground: 1, year_built: 2004, global_id: 'way/445566778',
    });
    expect(barn.attributes).toEqual({});
    expect(barn.identifiers).toEqual([]);

    const field = byId(fc, FIELD).properties;
    expect(field).toMatchObject({ surface_kind: 'ground', participant_id: FARM, site_id: GROUND, building_id: null, azimuth_deg: 180, tilt_deg: 0 });
    expect(byId(fc, GROUND).properties).toMatchObject({ kind: 'site', participant_id: FARM, use: 'land' });

    const array = byId(fc, BARN_ARRAY).properties;
    expect(array).toMatchObject({ device_type: 'solar', participant_id: FARM, rated_power_kw: 99.19, unit_count: 182, installation_date: '2023-06-20' });
    expect(byId(fc, BARN_ARRAY).geometry).toBeNull();
    expect(array.calculations).toHaveLength(1);
    expect(array.calculations[0]).toMatchObject({ module: 'solar', table: 'estimates', provenance: 'pvgis-5.3+solar-0.3.0', results: { annual_kwh: 99190 } });
    expect(array.calculations[0].updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(byId(fc, shedArray).properties.serial_number).toBe('SN-0042');
  });

  it('lists every source it draws on, with its licence and attribution', () => {
    expect(fc.nexgen_os.sources).toEqual([
      { code: 'openstreetmap', name: 'OpenStreetMap', license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors' },
      { code: 'roof_layer', name: 'A commercial roof layer', license: 'Proprietary', attribution: '© Roof Layer Inc.' },
    ]);
  });

  it('is the same document twice: nothing in it depends on the moment it was made', async () => {
    expect(await exportGeoJson(db, { participantId: FARM })).toEqual(fc);
  });

  it('leaves the calculations out when asked', async () => {
    const lean = await exportGeoJson(db, { participantId: FARM }, { calculations: false });
    expect(byId(lean, BARN_ARRAY).properties.calculations).toEqual([]);
  });
});

describe('the open export', () => {
  let fc: FeatureCollection;

  beforeAll(async () => {
    fc = await exportGeoJson(db, { participantId: FARM }, { open: true });
  });

  it('keeps the postal code and the city, not the address lines', () => {
    const farm = byId(fc, FARM).properties;
    expect(farm).toMatchObject({ postal_code: '59270', city: 'Saint-Jans-Cappel' });
    expect(farm).not.toHaveProperty('address_line1');
    expect(farm).not.toHaveProperty('address_line2');
  });

  it('withholds what a closed source described, with everything on it, and says how many', () => {
    const ids = fc.features.map((f) => f.id);
    expect(ids).not.toContain(shed);
    expect(ids).not.toContain(shedRoof);
    // The shed's array is the farm's, not the shed's: it stays.
    expect(ids).toContain(shedArray);
    expect(fc.nexgen_os.withheld).toBe(2);
    expect(fc.features).toHaveLength(14);
  });

  it('drops the attributes of a closed source, serial numbers and metadata, and owes only the open sources', () => {
    expect(byId(fc, FARM).properties.attributes).toEqual({ annual_consumption: 186000 });
    expect(byId(fc, BARN).properties).not.toHaveProperty('metadata');
    expect(fc.features.some((f) => 'serial_number' in f.properties)).toBe(false);
    expect(fc.nexgen_os.sources.map((s) => s.code)).toEqual(['openstreetmap']);
    expect(fc.nexgen_os.open).toBe(true);
  });

  it('keeps the calculations: a study shared with the public is its figures beside its places', () => {
    expect(byId(fc, BARN_ARRAY).properties.calculations[0].results).toEqual({ annual_kwh: 99190 });
  });
});

describe('a moment, a project', () => {
  it('reads attributes at the moment asked', async () => {
    await db.query(
      `update attributes set valid_from = '2026-01-01' where object_id = $1 and attribute_type = 'installed_power'`,
      [FARM],
    );
    const before = await exportGeoJson(db, { participantId: FARM }, { at: '2025-06-01T00:00:00Z' });
    expect(byId(before, FARM).properties.attributes).toEqual({ annual_consumption: 186000 });
    expect(before.nexgen_os.at).toBe('2025-06-01T00:00:00.000Z');
    // The roof layer is owed for the shed it described, not for an attribute that did not hold yet.
    expect(before.nexgen_os.sources.map((s) => s.code)).toEqual(['openstreetmap', 'roof_layer']);
  });

  it('exports a project: its perimeter first, then every participant taking part', async () => {
    const project = await insert(db, 'projects', {
      organisation_id: ORG, name: 'Farm solar plan', kind: 'pv_roof', country: 'FR', start_date: '2026-03-01',
      geometry: { type: 'Polygon', coordinates: [[[2.72, 50.77], [2.73, 50.77], [2.73, 50.775], [2.72, 50.775], [2.72, 50.77]]] },
    });
    const farm = await insert(db, 'participants', {
      organisation_id: ORG, project_id: project, name: 'The farm', category: 'prosumer', country: 'FR', city: 'Saint-Jans-Cappel',
      geometry: { type: 'Point', coordinates: [2.723, 50.771] },
    });
    const fc = await exportGeoJson(db, { projectId: project }, { open: true });
    expect(fc.features[0]).toMatchObject({ id: project, properties: { kind: 'project', project_kind: 'pv_roof', country: 'FR', start_date: '2026-03-01' } });
    expect(fc.features[1].id).toBe(farm);
    expect(fc.features.filter((f) => f.properties.kind === 'participant')).toHaveLength(1);
    expect(fc.bbox).toEqual([2.72, 50.77, 2.73, 50.775]);
  });
});

describe('what it refuses', () => {
  it('asks for one target', async () => {
    await expect(exportGeoJson(db, {})).rejects.toThrow(/^target_required/);
    await expect(exportGeoJson(db, { participantId: FARM, projectId: FARM })).rejects.toThrow(/^target_required/);
  });

  it('exports what row level security lets the user read, and nothing for anyone else', async () => {
    const mine = await asUser(db, USER_A, () => exportGeoJson(db, { participantId: FARM }));
    expect(mine.features.length).toBeGreaterThan(10);
    await expect(asUser(db, USER_B, () => exportGeoJson(db, { participantId: FARM }))).rejects.toThrow(/^participant_not_found/);
  });
});
