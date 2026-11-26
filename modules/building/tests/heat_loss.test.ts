// What the envelope of a building loses through its faces, and the heating
// need it gives over a period: H_T, the sum of area times thermal
// transmittance over the faces facing outside (EN ISO 13789, direct term),
// and H_T times the heating degree-days of a temperature series times 24 h.
// Every figure below is worked by hand; nothing is stored.
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
const face = async (building: string, kind: string, name: string, area: number | null, u: number | null, external: boolean | null) => {
  const id = (await one<{ id: string }>(db, `select building.add_surface($1, $2, $3, null, 180, $4) id`,
    [building, kind, name, kind === 'roof' ? 35 : kind === 'facade' ? 90 : 0])).id;
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
