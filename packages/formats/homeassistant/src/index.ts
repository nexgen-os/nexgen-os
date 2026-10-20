// Home Assistant ⇄ plain shapes.
//
// Home Assistant describes a home as floors, areas, devices and entities,
// and keeps the states of its entities over time. This library reads such a
// snapshot into plain shapes any tool can use — spaces (floors and rooms,
// one tree), devices, and points with their readings — and writes the
// shapes back as a snapshot, without losing a field:
//
//   floor   → a space of kind floor  (level as the file says it, or null)
//   area    → a space of kind room   (under its floor, or at the top)
//   device  → a device               (in its area)
//   entity  → a point                (on its device and in its area; its
//                                     class and unit as the file says them;
//                                     its role from its domain, measured,
//                                     setpoint or command; instant or
//                                     cumulative from its state class)
//   state   → a reading              (on/off as 1/0; unavailable, unknown
//                                     or not a number as null)
//
// Every Home Assistant field a shape has no field for travels in its
// `extra`, so that `writeHomeAssistant(readHomeAssistant(s))` gives the
// snapshot back as it was. The one thing the round trip flattens: `unknown`
// comes back as `unavailable`. No unit is converted and no value invented:
// the library carries what the snapshot says. It imports nothing, opens no
// connection and calls no network.
//
// SPDX-License-Identifier: MIT

export interface HaFloor {
  floor_id: string;
  name: string;
  level: number | null;
  icon: string | null;
  aliases: string[];
}

export interface HaArea {
  area_id: string;
  name: string;
  floor_id: string | null;
  icon: string | null;
  aliases: string[];
}

export interface HaDevice {
  id: string;
  name: string | null;
  name_by_user: string | null;
  manufacturer: string | null;
  model: string | null;
  sw_version: string | null;
  hw_version: string | null;
  serial_number: string | null;
  area_id: string | null;
  via_device_id: string | null;
  identifiers: [string, string][];
  connections: [string, string][];
}

export interface HaEntity {
  entity_id: string;
  unique_id: string;
  platform: string;
  name: string | null;
  original_name: string | null;
  device_id: string | null;
  area_id: string | null;
  device_class: string | null;
  original_device_class: string | null;
  state_class: string | null;
  unit_of_measurement: string | null;
  icon: string | null;
  entity_category: string | null;
  disabled_by: string | null;
}

export interface HaState {
  entity_id: string;
  state: string;
  last_updated: string;
}

/** What `hass` exports: its registries and the recorder's states. */
export interface HaSnapshot {
  floors: HaFloor[];
  areas: HaArea[];
  devices: HaDevice[];
  entities: HaEntity[];
  states: HaState[];
}

// ---------------------------------------------------------------------------
// The plain shapes
// ---------------------------------------------------------------------------

/** A floor or a room. `key` is Home Assistant's id (`floor_id`, `area_id`). */
export interface HomeSpace {
  key: string;
  kind: 'floor' | 'room';
  name: string;
  /** The floor's level as the file says it; null for a room, or a floor without one. */
  level: number | null;
  /** The floor a room is on, by key; null for a floor, or a room on no floor. */
  parent: string | null;
  /** The fields of the floor or the area no other field carries (`icon`, `aliases`). */
  extra: Record<string, unknown>;
}

/** A device. `key` is Home Assistant's device id. */
export interface HomeDevice {
  key: string;
  /** The name a person gave it, else its own, else its key. */
  name: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  /** The room it is in, by key. */
  space: string | null;
  /** `name`, `name_by_user`, versions, `via_device_id`, identifiers and connections, as the registry holds them. */
  extra: Record<string, unknown>;
}

/** One reading of a point: `value` null when the state was unavailable, unknown or not a number. */
export interface HomeReading {
  at: string;
  value: number | null;
}

/** An entity: a point read or commanded, with its readings. `key` is the entity id. */
export interface HomePoint {
  key: string;
  /** The device it belongs to, by key. */
  device: string | null;
  /** The room it was placed in, by key (its device's room otherwise). */
  space: string | null;
  /** The part of the entity id before the dot: `sensor`, `switch`, `climate`… */
  domain: string;
  /** `device_class`, else `original_device_class`, else null. */
  deviceClass: string | null;
  /** `unit_of_measurement`, as the entity states it. */
  unit: string | null;
  /** What the point is: read (`measured`), a value asked of the device (`setpoint`), an order (`command`). */
  role: 'measured' | 'setpoint' | 'command';
  /** `cumulative` for a total (`total`, `total_increasing`), else `instant`. */
  valueKind: 'instant' | 'cumulative';
  /** Whether its states are `on` and `off`. */
  binary: boolean;
  /** The fields of the entity no other field carries. */
  extra: Record<string, unknown>;
  readings: HomeReading[];
}

export interface Home {
  spaces: HomeSpace[];
  devices: HomeDevice[];
  points: HomePoint[];
}

const SETPOINT_DOMAINS = new Set(['number', 'input_number', 'climate', 'water_heater']);
const COMMAND_DOMAINS = new Set(['switch', 'button', 'input_boolean', 'light', 'cover', 'fan', 'lock', 'script']);
const BINARY_DOMAINS = new Set(['binary_sensor', 'switch', 'input_boolean', 'light', 'lock']);

const domainOf = (entityId: string) => entityId.split('.')[0];

function roleOf(domain: string): HomePoint['role'] {
  if (SETPOINT_DOMAINS.has(domain)) return 'setpoint';
  if (COMMAND_DOMAINS.has(domain)) return 'command';
  return 'measured';
}

function reading(state: HaState): HomeReading {
  const n = state.state === 'on' ? 1 : state.state === 'off' ? 0 : Number(state.state);
  const missing = state.state === 'unavailable' || state.state === 'unknown' || state.state.trim() === '' || Number.isNaN(n);
  return { at: state.last_updated, value: missing ? null : n };
}

/** A snapshot as plain shapes. */
export function readHomeAssistant(snapshot: HaSnapshot): Home {
  const spaces: HomeSpace[] = [
    ...snapshot.floors.map(({ floor_id, name, level, ...extra }): HomeSpace => ({ key: floor_id, kind: 'floor', name, level, parent: null, extra })),
    ...snapshot.areas.map(({ area_id, name, floor_id, ...extra }): HomeSpace => ({ key: area_id, kind: 'room', name, level: null, parent: floor_id, extra })),
  ];
  const devices = snapshot.devices.map(({ id, manufacturer, model, serial_number, area_id, ...extra }): HomeDevice => ({
    key: id, name: extra.name_by_user ?? extra.name ?? id, manufacturer, model, serialNumber: serial_number, space: area_id, extra,
  }));
  const readings = new Map<string, HomeReading[]>();
  for (const s of snapshot.states) readings.set(s.entity_id, [...(readings.get(s.entity_id) ?? []), reading(s)]);
  const points = snapshot.entities.map(({ entity_id, device_id, area_id, unit_of_measurement, ...extra }): HomePoint => {
    const domain = domainOf(entity_id);
    return {
      key: entity_id,
      device: device_id,
      space: area_id,
      domain,
      deviceClass: extra.device_class ?? extra.original_device_class ?? null,
      unit: unit_of_measurement,
      role: roleOf(domain),
      valueKind: extra.state_class === 'total' || extra.state_class === 'total_increasing' ? 'cumulative' : 'instant',
      binary: BINARY_DOMAINS.has(domain),
      extra,
      readings: readings.get(entity_id) ?? [],
    };
  });
  return { spaces, devices, points };
}

/** Twelve significant digits: what survives a conversion there and back. */
const round = (n: number) => Number(n.toPrecision(12));

/** Plain shapes as a snapshot, in the order of the shapes. */
export function writeHomeAssistant(home: Home): HaSnapshot {
  return {
    floors: home.spaces.filter((s) => s.kind === 'floor').map((s) => ({ ...(s.extra as object), floor_id: s.key, name: s.name, level: s.level }) as HaFloor),
    areas: home.spaces.filter((s) => s.kind === 'room').map((s) => ({ ...(s.extra as object), area_id: s.key, name: s.name, floor_id: s.parent }) as HaArea),
    devices: home.devices.map((d) => ({
      ...(d.extra as object), id: d.key, manufacturer: d.manufacturer, model: d.model, serial_number: d.serialNumber, area_id: d.space,
    }) as HaDevice),
    entities: home.points.map((p) => ({
      ...(p.extra as object), entity_id: p.key, device_id: p.device, area_id: p.space, unit_of_measurement: p.unit,
    }) as HaEntity),
    states: home.points.flatMap((p) => p.readings.map((r) => ({
      entity_id: p.key,
      state: r.value === null ? 'unavailable' : p.binary ? (r.value >= 1 ? 'on' : 'off') : String(round(r.value)),
      last_updated: new Date(r.at).toISOString(),
    }))),
  };
}
