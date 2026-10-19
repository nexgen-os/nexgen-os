// A Home Assistant home goes in, comes back out identical, and lands on the
// right objects with the right quantities, units and kinds in between.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase, insert, one, organisation, square } from './helpers/db.js';
import { exportHomeAssistant, importHomeAssistant, type HaSnapshot, type ImportResult } from '../formats/homeassistant/index.js';

const snapshot: HaSnapshot = {
  floors: [
    { floor_id: 'ground', name: 'Ground floor', level: 0, icon: 'mdi:home-floor-0', aliases: ['rez'] },
    { floor_id: 'first', name: 'First floor', level: 1, icon: null, aliases: [] },
  ],
  areas: [
    { area_id: 'living_room', name: 'Living room', floor_id: 'ground', icon: 'mdi:sofa', aliases: ['salon'] },
    { area_id: 'kitchen', name: 'Kitchen', floor_id: 'ground', icon: null, aliases: [] },
    { area_id: 'bedroom', name: 'Bedroom', floor_id: 'first', icon: null, aliases: [] },
    { area_id: 'garage', name: 'Garage', floor_id: null, icon: 'mdi:garage', aliases: [] },
  ],
  devices: [
    { id: 'dev-inverter', name: 'SUN2000-4KTL', name_by_user: 'Inverter', manufacturer: 'Huawei', model: 'SUN2000-4KTL-L1', sw_version: 'V200R001C00SPC120', hw_version: null,
      serial_number: 'HV2240012345', area_id: 'garage', via_device_id: null, identifiers: [['huawei_solar', 'HV2240012345']], connections: [['mac', 'aa:bb:cc:dd:ee:01']] },
    { id: 'dev-thermostat', name: 'Living room thermostat', name_by_user: null, manufacturer: 'Netatmo', model: 'NATherm1', sw_version: '2.1', hw_version: 'B',
      serial_number: null, area_id: 'living_room', via_device_id: 'dev-relay', identifiers: [['netatmo', '70:ee:50:aa:bb:cc']], connections: [] },
    { id: 'dev-relay', name: 'Netatmo relay', name_by_user: null, manufacturer: 'Netatmo', model: 'NAPlug', sw_version: null, hw_version: null,
      serial_number: null, area_id: null, via_device_id: null, identifiers: [['netatmo', '70:ee:50:00:00:01']], connections: [] },
  ],
  entities: [
    { entity_id: 'sensor.inverter_active_power', unique_id: 'HV2240012345-active_power', platform: 'huawei_solar', name: null, original_name: 'Active power', device_id: 'dev-inverter', area_id: null,
      device_class: 'power', original_device_class: 'power', state_class: 'measurement', unit_of_measurement: 'W', icon: null, entity_category: null, disabled_by: null },
    { entity_id: 'sensor.inverter_total_yield', unique_id: 'HV2240012345-total_yield', platform: 'huawei_solar', name: 'PV yield', original_name: 'Total yield', device_id: 'dev-inverter', area_id: null,
      device_class: 'energy', original_device_class: 'energy', state_class: 'total_increasing', unit_of_measurement: 'kWh', icon: null, entity_category: null, disabled_by: null },
    { entity_id: 'sensor.living_room_temperature', unique_id: 'netatmo-temp-1', platform: 'netatmo', name: null, original_name: 'Temperature', device_id: 'dev-thermostat', area_id: null,
      device_class: 'temperature', original_device_class: 'temperature', state_class: 'measurement', unit_of_measurement: '°C', icon: null, entity_category: null, disabled_by: null },
    { entity_id: 'climate.living_room', unique_id: 'netatmo-climate-1', platform: 'netatmo', name: null, original_name: 'Living room', device_id: 'dev-thermostat', area_id: null,
      device_class: null, original_device_class: null, state_class: null, unit_of_measurement: '°C', icon: 'mdi:thermostat', entity_category: null, disabled_by: null },
    { entity_id: 'sensor.kitchen_co2', unique_id: 'aranet-co2-7', platform: 'aranet', name: 'Kitchen CO2', original_name: 'CO2', device_id: null, area_id: 'kitchen',
      device_class: 'carbon_dioxide', original_device_class: 'carbon_dioxide', state_class: 'measurement', unit_of_measurement: 'ppm', icon: null, entity_category: null, disabled_by: null },
    { entity_id: 'binary_sensor.bedroom_motion', unique_id: 'aqara-motion-3', platform: 'zha', name: null, original_name: 'Motion', device_id: null, area_id: 'bedroom',
      device_class: 'occupancy', original_device_class: 'motion', state_class: null, unit_of_measurement: null, icon: null, entity_category: null, disabled_by: null },
    { entity_id: 'sensor.thermostat_battery', unique_id: 'netatmo-batt-1', platform: 'netatmo', name: null, original_name: 'Battery', device_id: 'dev-thermostat', area_id: null,
      device_class: 'battery', original_device_class: 'battery', state_class: 'measurement', unit_of_measurement: '%', icon: null, entity_category: 'diagnostic', disabled_by: null },
    { entity_id: 'switch.garage_heater', unique_id: 'shelly-1-garage', platform: 'shelly', name: 'Garage heater', original_name: 'Switch', device_id: null, area_id: 'garage',
      device_class: null, original_device_class: null, state_class: null, unit_of_measurement: null, icon: null, entity_category: null, disabled_by: null },
    { entity_id: 'sensor.outdoor_noise', unique_id: 'netatmo-noise-1', platform: 'netatmo', name: null, original_name: 'Noise', device_id: null, area_id: null,
      device_class: 'sound_pressure', original_device_class: 'sound_pressure', state_class: 'measurement', unit_of_measurement: 'dB', icon: null, entity_category: null, disabled_by: 'user' },
  ],
  states: [
    { entity_id: 'sensor.inverter_active_power', state: '2345', last_updated: '2026-06-21T10:00:00.000Z' },
    { entity_id: 'sensor.inverter_active_power', state: '3120.5', last_updated: '2026-06-21T11:00:00.000Z' },
    { entity_id: 'sensor.inverter_active_power', state: 'unavailable', last_updated: '2026-06-21T12:00:00.000Z' },
    { entity_id: 'sensor.inverter_total_yield', state: '8123.4', last_updated: '2026-06-21T10:00:00.000Z' },
    { entity_id: 'sensor.inverter_total_yield', state: '8126.1', last_updated: '2026-06-21T11:00:00.000Z' },
    { entity_id: 'sensor.living_room_temperature', state: '21.3', last_updated: '2026-06-21T10:00:00.000Z' },
    { entity_id: 'climate.living_room', state: '20', last_updated: '2026-06-21T06:00:00.000Z' },
    { entity_id: 'sensor.kitchen_co2', state: '812', last_updated: '2026-06-21T10:00:00.000Z' },
    { entity_id: 'binary_sensor.bedroom_motion', state: 'on', last_updated: '2026-06-21T07:12:00.000Z' },
    { entity_id: 'binary_sensor.bedroom_motion', state: 'off', last_updated: '2026-06-21T07:20:00.000Z' },
    { entity_id: 'sensor.thermostat_battery', state: '87', last_updated: '2026-06-21T10:00:00.000Z' },
    { entity_id: 'switch.garage_heater', state: 'off', last_updated: '2026-06-21T10:00:00.000Z' },
    { entity_id: 'sensor.outdoor_noise', state: '41', last_updated: '2026-06-21T10:00:00.000Z' },
  ],
};

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
let imported: ImportResult;

beforeAll(async () => {
  db = await freshDatabase();
  org = await organisation(db, 'A home');
  const site = await insert(db, 'sites', { organisation_id: org, name: 'Home', country: 'FR', city: 'Lille', time_zone: 'Europe/Paris', profile: 'residential' });
  building = await insert(db, 'buildings', { organisation_id: org, site_id: site, name: 'House', profile: 'residential', footprint: square(3.06, 50.63, 9, 11), height_m: 7 });
  imported = await importHomeAssistant(db, { organisationId: org, siteId: site, buildingId: building }, snapshot);
});

afterAll(async () => {
  await db.close();
});

describe('a Home Assistant home in Nexgen OS', () => {
  it('lands floors and areas on one tree of spaces, devices in their rooms, entities on series', async () => {
    const r = await db.query<{ kind: string; n: number }>(`select kind, count(*)::int n from objects where organisation_id = $1 group by kind order by kind`, [org]);
    expect(Object.fromEntries(r.rows.map((x) => [x.kind, x.n]))).toEqual({ building: 1, device: 3, organisation: 1, site: 1, space: 6 });
    const rooms = await db.query<{ name: string; kind: string; floor: string | null }>(
      `select s.name, s.kind, f.name floor from spaces s left join spaces f on f.id = s.parent_id where s.building_id = $1 order by s.kind, s.name`, [building]);
    expect(rooms.rows).toEqual([
      { name: 'First floor', kind: 'floor', floor: null },
      { name: 'Ground floor', kind: 'floor', floor: null },
      { name: 'Bedroom', kind: 'room', floor: 'First floor' },
      { name: 'Garage', kind: 'room', floor: null },
      { name: 'Kitchen', kind: 'room', floor: 'Ground floor' },
      { name: 'Living room', kind: 'room', floor: 'Ground floor' },
    ]);
    const placed = await db.query<{ name: string; room: string | null; building: boolean }>(
      `select d.name, s.name room, d.building_id = $1 building from devices d left join spaces s on s.id = d.space_id order by d.name`, [building]);
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
    const again = await exportHomeAssistant(db, building);
    expect(sortSnapshot(again)).toEqual(sortSnapshot(snapshot));
  });
});
