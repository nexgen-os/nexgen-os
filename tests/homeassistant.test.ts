// A Home Assistant home goes in through the format library and the core's
// importer, comes back out identical through the exporter and the library,
// and lands on the right objects with the right quantities, units and kinds
// in between.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDatabase, insert, one, organisation, repoRoot, square } from './helpers/db.js';
import { readHomeAssistant, writeHomeAssistant, type HaSnapshot } from '@nexgen-os/homeassistant';
import { exportHomeAssistant, importHomeAssistant, type HomeImport } from '../modules/building/src/index.js';

// The home of the format library's own tests: two floors, four areas,
// three devices, nine entities and their recorder states.
const snapshot = JSON.parse(readFileSync(join(repoRoot, 'packages/formats/homeassistant/tests/fixtures/home.json'), 'utf8')) as HaSnapshot;

const sortSnapshot = (s: HaSnapshot): HaSnapshot => ({
  floors: [...s.floors].sort((a, b) => a.floor_id.localeCompare(b.floor_id)),
  areas: [...s.areas].sort((a, b) => a.area_id.localeCompare(b.area_id)),
  devices: [...s.devices].sort((a, b) => a.id.localeCompare(b.id)),
  entities: [...s.entities].sort((a, b) => a.entity_id.localeCompare(b.entity_id)),
  states: [...s.states].sort((a, b) => a.entity_id.localeCompare(b.entity_id) || a.last_updated.localeCompare(b.last_updated)),
});

let db: PGlite;
let org: string;
let building: string;
let imported: HomeImport;

beforeAll(async () => {
  db = await freshDatabase(['building']);
  org = await organisation(db, 'A home');
  const site = await insert(db, 'sites', { organisation_id: org, name: 'Home', country: 'FR', city: 'Lille', time_zone: 'Europe/Paris', profile: 'residential' });
  building = await insert(db, 'building.buildings', { organisation_id: org, site_id: site, name: 'House', profile: 'residential', footprint: square(3.06, 50.63, 9, 11), height_m: 7 });
  imported = await importHomeAssistant(db, { siteId: site, buildingId: building }, readHomeAssistant(snapshot));
});

afterAll(async () => {
  await db.close();
});

describe('a Home Assistant home in Nexgen OS', () => {
  it('lands floors and areas on one tree of spaces, devices in their rooms, entities on series', async () => {
    const r = await db.query<{ kind: string; n: number }>(`select kind, count(*)::int n from objects where organisation_id = $1 group by kind order by kind`, [org]);
    expect(Object.fromEntries(r.rows.map((x) => [x.kind, x.n]))).toEqual({ building: 1, device: 3, organisation: 1, site: 1, space: 6 });
    const rooms = await db.query<{ name: string; kind: string; floor: string | null }>(
      `select s.name, s.kind, f.name floor from building.spaces s left join building.spaces f on f.id = s.parent_id where s.building_id = $1 order by s.kind, s.name`, [building]);
    expect(rooms.rows).toEqual([
      { name: 'First floor', kind: 'floor', floor: null },
      { name: 'Ground floor', kind: 'floor', floor: null },
      { name: 'Bedroom', kind: 'room', floor: 'First floor' },
      { name: 'Garage', kind: 'room', floor: null },
      { name: 'Kitchen', kind: 'room', floor: 'Ground floor' },
      { name: 'Living room', kind: 'room', floor: 'Ground floor' },
    ]);
    const placed = await db.query<{ name: string; room: string | null; building: boolean }>(
      `select d.name, s.name room, p.building_id = $1 building
         from devices d join building.devices p on p.device_id = d.id left join building.spaces s on s.id = p.space_id order by d.name`, [building]);
    expect(placed.rows).toEqual([
      { name: 'Inverter', room: 'Garage', building: true },
      { name: 'Living room thermostat', room: 'Living room', building: true },
      { name: 'Netatmo relay', room: null, building: true },
    ]);
  });

  it('opens one series per entity, on its device, else its area, else the building, with the right quantity and kind', async () => {
    const r = await db.query<{ ref: string; observed: string; device: boolean; quantity: string; kind: string }>(
      `select s.external_ref ref, o.kind observed, s.device_id is not null device, s.quantity_code quantity, s.kind
         from series s join objects o on o.id = s.object_id order by s.external_ref`);
    expect(r.rows).toEqual([
      { ref: 'homeassistant://binary_sensor.bedroom_motion', observed: 'space', device: false, quantity: 'occupancy', kind: 'measured' },
      { ref: 'homeassistant://climate.living_room', observed: 'device', device: true, quantity: 'ha_climate_c', kind: 'setpoint' },
      { ref: 'homeassistant://sensor.inverter_active_power', observed: 'device', device: true, quantity: 'power', kind: 'measured' },
      { ref: 'homeassistant://sensor.inverter_total_yield', observed: 'device', device: true, quantity: 'energy', kind: 'measured' },
      { ref: 'homeassistant://sensor.kitchen_co2', observed: 'space', device: false, quantity: 'co2', kind: 'measured' },
      { ref: 'homeassistant://sensor.living_room_temperature', observed: 'device', device: true, quantity: 'temperature', kind: 'measured' },
      { ref: 'homeassistant://sensor.outdoor_noise', observed: 'building', device: false, quantity: 'ha_sound_pressure_db', kind: 'measured' },
      { ref: 'homeassistant://sensor.thermostat_battery', observed: 'device', device: true, quantity: 'charge_level', kind: 'measured' },
      { ref: 'homeassistant://switch.garage_heater', observed: 'space', device: false, quantity: 'ha_switch_none', kind: 'command' },
    ]);
    const published = await db.query<{ code: string; unit: string; published_by: string }>(
      `select code, unit, published_by from quantities where published_by = 'homeassistant' order by code`);
    expect(published.rows).toEqual([
      { code: 'ha_climate_c', unit: '°C', published_by: 'homeassistant' },
      { code: 'ha_sound_pressure_db', unit: 'dB', published_by: 'homeassistant' },
      { code: 'ha_switch_none', unit: 'UNITLESS', published_by: 'homeassistant' },
    ]);
  });

  it('converts values into the quantity units and keeps the state classes', async () => {
    const power = await db.query<{ value: number; quality: number }>(
      `select v.value, v.quality from series_values v where v.series_id = $1 order by v.at`, [imported.series.get('sensor.inverter_active_power')]);
    expect(power.rows).toEqual([{ value: 2.345, quality: 0 }, { value: 3.1205, quality: 0 }, { value: 0, quality: 3 }]);
    const kinds = await db.query<{ ref: string; value_kind: string; kind: string }>(
      `select external_ref ref, value_kind, kind from series order by external_ref`);
    expect(kinds.rows.find((r) => r.ref.endsWith('total_yield'))).toMatchObject({ value_kind: 'cumulative', kind: 'measured' });
    expect(kinds.rows.find((r) => r.ref.endsWith('active_power'))).toMatchObject({ value_kind: 'instant', kind: 'measured' });
    expect(kinds.rows.find((r) => r.ref.endsWith('climate.living_room'))).toMatchObject({ value_kind: 'instant', kind: 'setpoint' });
    const motion = await db.query<{ value: number }>(
      `select value from series_values where series_id = $1 order by at`, [imported.series.get('binary_sensor.bedroom_motion')]);
    expect(motion.rows.map((r) => r.value)).toEqual([1, 0]);
  });

  it('reads the register through resample as the energy of the day, and its index as a window', async () => {
    const id = imported.series.get('sensor.inverter_total_yield');
    const r = await one<{ value: number }>(db, `select value from resample($1, '2026-06-21', '2026-06-22', '1 day')`, [id]);
    expect(r.value).toBeCloseTo(2.7, 9);
    const index = await db.query<{ value: number }>(`select value from nexgen.window($1, '2026-06-21', '2026-06-22')`, [id]);
    expect(index.rows.map((x) => x.value)).toEqual([8123.4, 8126.1]);
  });

  it('comes back out identical', async () => {
    const again = writeHomeAssistant(await exportHomeAssistant(db, building));
    expect(sortSnapshot(again)).toEqual(sortSnapshot(snapshot));
  });
});
