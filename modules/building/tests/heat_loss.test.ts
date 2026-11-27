// What the envelope of a building loses through its faces, and the heating
// need it gives over a period: H_T, the sum of area times thermal
// transmittance over the faces facing outside (EN ISO 13789, direct term),
// and H_T times the heating degree-days of a temperature series times 24 h.
// Three topologies, a detached house, an apartment block between two
// neighbours over an unheated cellar, and an office block before and after
// its facades are insulated. Every figure below is worked by hand; nothing
// is stored.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase, one, organisation, participant, square } from '../../../tests/helpers/db.js';

let db: PGlite;
let house: string;
let block: string;
let temperature: string;

const loss = async (building: string) =>
  (await one<{ r: Record<string, any> }>(db, 'select building.transmission_heat_loss($1) r', [building])).r;
const need = async (building: string, base: number | null = 15) =>
  (await one<{ r: Record<string, any> }>(db, `select building.heating_need($1, $2, '2026-01-04T23:00:00Z', '2026-01-07T23:00:00Z', $3) r`,
    [building, temperature, base])).r;
const face = async (building: string, kind: string, name: string, area: number | null, u: number | null, external: boolean | null, azimuth = 180) => {
  const id = (await one<{ id: string }>(db, `select building.add_surface($1, $2, $3, null, $5, $4) id`,
    [building, kind, name, kind === 'roof' ? 35 : kind === 'facade' ? 90 : 0, azimuth])).id;
  await db.query('update building.surfaces set area_m2 = $2, u_value = $3, is_external = $4 where id = $1', [id, area, u, external]);
  return id;
};

beforeAll(async () => {
  db = await freshDatabase(['building', 'weather']);
  const org = await organisation(db, 'A heating engineer');
  house = await participant(db, { organisation_id: org, name: 'House', country: 'BE', time_zone: 'Europe/Brussels' });
  block = (await one<{ id: string }>(db, `select building.add_building($1, 'Detached house', ST_GeomFromGeoJSON($2), 2) id`,
    [house, JSON.stringify(square(4.36, 50.84, 12, 10))])).id;
  // 120 m² of roof at 0.2, 200 m² of walls at 0.5, a floor of 120 m² at 0.3:
  // 24 + 100 + 36 = 160 W/K. A party wall to the neighbour does not face outside.
  await face(block, 'roof', 'Roof', 120, 0.2, true);
  await face(block, 'facade', 'Walls', 200, 0.5, true);
  await face(block, 'ground', 'Floor slab', 120, 0.3, true);
  await face(block, 'facade', 'Party wall', 60, 1.2, false);
  // A sensor of the house: 5 °C all of 5 January, 14 and 18 °C in turn on the
  // 6th, nothing on the 7th (local days of Brussels, UTC+1).
  const hours = Array.from({ length: 48 }, (_, h) => new Date(Date.UTC(2026, 0, 4, 23 + h)).toISOString());
  const values = hours.map((_, h) => (h < 24 ? 5 : h % 2 === 0 ? 14 : 18));
  await db.query(`select store(null, $1::timestamptz[], $2::float8[], p_series => $3::jsonb)`, [hours, values, JSON.stringify({
    object_kind: 'participant', object_id: house, quantity_code: 'temperature', value_kind: 'instant', step: '1 hour', name: 'Living room sensor',
  })]);
  temperature = (await one<{ id: string }>(db, `select id from series where object_id = $1 and quantity_code = 'temperature'`, [house])).id;
});

afterAll(async () => {
  await db.close();
});

describe('transmission_heat_loss', () => {
  it('sums area times transmittance over the faces facing outside, each face with its share, and says what it does not model', async () => {
    const r = await loss(block);
    expect(r.h_t_w_per_k).toBe(160);
    expect(r.area_m2).toBe(440);
    expect(r.faces.map((f: any) => [f.name, f.w_per_k])).toEqual([['Floor slab', 36], ['Roof', 24], ['Walls', 100]]);
    expect(r).toMatchObject({ missing: [], undecided: [], not_modelled: ['thermal_bridges', 'ground', 'unheated_spaces', 'ventilation'] });
    expect(r.method).toMatch(/EN ISO 13789/);
  });

  it('answers no coefficient, and names the face, when a face facing outside lacks its figures or does not say which side it faces', async () => {
    const annex = (await one<{ id: string }>(db, `select building.add_building($1, 'Annex') id`, [house])).id;
    expect((await loss(annex)).h_t_w_per_k).toBeNull();
    await face(annex, 'roof', 'Annex roof', 20, 0.25, true);
    expect((await loss(annex)).h_t_w_per_k).toBe(5);
    const glazing = await face(annex, 'facade', 'Glazing', 6, null, true);
    const r = await loss(annex);
    expect(r).toMatchObject({ h_t_w_per_k: null, area_m2: null, missing: [{ surface_id: glazing, name: 'Glazing', lacks: ['u_value'] }] });
    await db.query('update building.surfaces set u_value = 1.4 where id = $1', [glazing]);
    const door = await face(annex, 'facade', 'Door wall', 4, 1.8, null);
    expect(await loss(annex)).toMatchObject({ h_t_w_per_k: null, undecided: [{ surface_id: door, name: 'Door wall' }] });
    await db.query('update building.surfaces set is_external = true where id = $1', [door]);
    // 20 x 0.25 + 6 x 1.4 + 4 x 1.8 = 5 + 8.4 + 7.2.
    expect((await loss(annex)).h_t_w_per_k).toBe(20.6);
  });

  it('refuses a building it cannot find by name', async () => {
    await expect(loss('00000000-0000-4000-8000-000000000001')).rejects.toThrow(/building_not_found/);
  });
});

describe('heating_need', () => {
  it('multiplies the coefficient by the heating degree-days of the period and 24 hours, a day without temperature counted as missing', async () => {
    // Base 15: 10 degree-days on the 5th, none on the 16 °C 6th, the 7th empty.
    // 160 W/K x 10 K·d x 24 h / 1000 = 38.4 kWh.
    const r = await need(block);
    expect(r).toMatchObject({ kwh: 38.4, h_t_w_per_k: 160, degree_days: 10, base: 15, days: 2, days_missing: 1, series_id: temperature });
    expect(r.transmission_heat_loss.faces).toHaveLength(3);
    // Base 18: 13 + 2 degree-days, 160 x 15 x 24 / 1000 = 57.6 kWh.
    expect((await need(block, 18)).kwh).toBe(57.6);
  });

  it('answers no need without a coefficient, and refuses a base it is not given', async () => {
    const shed = (await one<{ id: string }>(db, `select building.add_building($1, 'Shed') id`, [house])).id;
    expect(await need(shed)).toMatchObject({ kwh: null, h_t_w_per_k: null, degree_days: 10 });
    await expect(need(block, null)).rejects.toThrow(/base_required/);
  });
});

describe('an apartment block between two neighbours, over an unheated cellar', () => {
  let flats: string;

  beforeAll(async () => {
    const org = await organisation(db, 'A housing company');
    const owners = await participant(db, { organisation_id: org, name: 'Co-owners', country: 'BE', time_zone: 'Europe/Brussels' });
    flats = (await one<{ id: string }>(db, `select building.add_building($1, 'Apartment block', ST_GeomFromGeoJSON($2), 5) id`,
      [owners, JSON.stringify(square(4.35, 50.85, 20, 12))])).id;
    // 20 m of street front and 12 m deep, five floors, 15 m high: 300 m² of
    // front and of rear, 90 and 60 m² of them glazed; two gables of 180 m²
    // against the neighbours; 240 m² of flat roof and of floor over the cellar.
    await face(flats, 'roof', 'Flat roof', 240, 0.24, true);
    await face(flats, 'facade', 'Front wall', 210, 0.6, true, 180);
    await face(flats, 'facade', 'Front glazing', 90, 1.1, true, 180);
    await face(flats, 'facade', 'Rear wall', 240, 0.6, true, 0);
    await face(flats, 'facade', 'Rear glazing', 60, 1.1, true, 0);
    await face(flats, 'facade', 'East gable', 180, 1.0, false, 90);
    await face(flats, 'facade', 'West gable', 180, 1.0, false, 270);
    await face(flats, 'ground', 'Floor over the cellar', 240, 0.5, false);
  });

  it('counts the faces to the outside only: the gables to the neighbours and the floor over the cellar are not, and say so', async () => {
    // 240 x 0.24 + 210 x 0.6 + 90 x 1.1 + 240 x 0.6 + 60 x 1.1
    // = 57.6 + 126 + 99 + 144 + 66 = 492.6 W/K, over 840 m².
    const r = await loss(flats);
    expect(r.h_t_w_per_k).toBe(492.6);
    expect(r.area_m2).toBe(840);
    expect(r.faces.map((f: any) => [f.name, f.w_per_k])).toEqual([
      ['Flat roof', 57.6], ['Front glazing', 99], ['Front wall', 126], ['Rear glazing', 66], ['Rear wall', 144],
    ]);
    expect(r).toMatchObject({ missing: [], undecided: [] });
    expect(r.not_modelled).toContain('unheated_spaces');
  });

  it('gives its heating need over the same days as the house', async () => {
    // Base 15: 492.6 x 10 x 24 / 1000 = 118.224 kWh; base 18: x 15 = 177.336 kWh.
    expect(await need(flats)).toMatchObject({ kwh: 118.224, h_t_w_per_k: 492.6, degree_days: 10, days: 2, days_missing: 1 });
    expect((await need(flats, 18)).kwh).toBe(177.336);
  });
});

describe('an office block, before and after its facades are insulated', () => {
  let office: string;
  let outdoor: string;
  const officeNeed = async () =>
    (await one<{ r: Record<string, any> }>(db, `select building.heating_need($1, $2, '2026-01-11T23:00:00Z', '2026-01-14T23:00:00Z', 15) r`,
      [office, outdoor])).r;

  beforeAll(async () => {
    const org = await organisation(db, 'A property company');
    const company = await participant(db, { organisation_id: org, name: 'Office tenant', country: 'DE', time_zone: 'Europe/Berlin' });
    // The office of example 7 (docs/demo/07-office-heating.sql): about 44.6 by
    // 33.4 m and 21 m high, four facades at 1.4, a flat roof insulated to 0.22.
    office = (await one<{ id: string }>(db, `select building.add_building($1, 'Office block', ST_GeomFromGeoJSON($2), 6) id`,
      [company, JSON.stringify(square(11.6073, 48.12415, 44.6, 33.4))])).id;
    await face(office, 'facade', 'South facade', 936, 1.4, true, 180);
    await face(office, 'facade', 'North facade', 936, 1.4, true, 0);
    await face(office, 'facade', 'East facade', 701, 1.4, true, 90);
    await face(office, 'facade', 'West facade', 701, 1.4, true, 270);
    await face(office, 'roof', 'Flat roof', 1489, 0.22, true);
    // The outdoor temperature at the office, three local days of Berlin
    // (UTC+1): 0, 4 and 8 °C, 15 + 11 + 7 = 33 degree-days at base 15.
    const hours = Array.from({ length: 72 }, (_, h) => new Date(Date.UTC(2026, 0, 11, 23 + h)).toISOString());
    const values = hours.map((_, h) => [0, 4, 8][Math.floor(h / 24)]);
    await db.query(`select store(null, $1::timestamptz[], $2::float8[], p_series => $3::jsonb)`, [hours, values, JSON.stringify({
      object_kind: 'participant', object_id: company, quantity_code: 'temperature', value_kind: 'instant', step: '1 hour', name: 'Outdoor sensor',
    })]);
    outdoor = (await one<{ id: string }>(db, `select id from series where object_id = $1 and quantity_code = 'temperature'`, [company])).id;
  });

  it('loses 4911.18 W/K as built: the facades carry 93 % of it', async () => {
    // (936 + 936 + 701 + 701) x 1.4 + 1489 x 0.22 = 4583.6 + 327.58 = 4911.18 W/K, over 4763 m².
    const r = await loss(office);
    expect(r.h_t_w_per_k).toBe(4911.18);
    expect(r.area_m2).toBe(4763);
    const facades = r.faces.filter((f: any) => f.kind === 'facade').reduce((sum: number, f: any) => sum + f.w_per_k, 0);
    expect(facades).toBeCloseTo(4583.6, 6);
    expect(facades / r.h_t_w_per_k).toBeCloseTo(0.9333, 4);
  });

  it('needs 3889.655 kWh over the three days as built and 907.695 kWh once its facades are at 0.25', async () => {
    // 4911.18 x 33 x 24 / 1000 = 3889.65456 kWh.
    expect(await officeNeed()).toMatchObject({ kwh: 3889.655, degree_days: 33, base: 15, days: 3, days_missing: 0 });
    await db.query(`update building.surfaces set u_value = 0.25 where building_id = $1 and kind = 'facade'`, [office]);
    // 3274 x 0.25 + 327.58 = 1146.08 W/K; 1146.08 x 33 x 24 / 1000 = 907.69536 kWh.
    expect((await loss(office)).h_t_w_per_k).toBe(1146.08);
    expect((await officeNeed()).kwh).toBe(907.695);
  });
});
