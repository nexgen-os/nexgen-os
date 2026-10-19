// Home Assistant ⇄ Nexgen OS.
//
// Home Assistant describes a home as floors, areas, devices and entities,
// and keeps the states of its entities over time. Nexgen OS describes the
// same home as spaces (floors and rooms, one tree), devices, and series: the
// instrument is a device, the point it reads or is asked is a series. This
// library maps one onto the other, both ways, without losing a field:
//
//   floor   → spaces of kind floor  (level = floor level)
//   area    → spaces of kind room   (under its floor, or straight in the building)
//   device  → devices               (type sensor_box, in its area's room;
//                                    identifiers and versions kept)
//   entity  → series                (on its device, else its area, else the
//                                    building; quantity from device_class and
//                                    unit; kind from domain)
//   state   → series_values         (in the quantity's unit; on/off as 1/0;
//                                    unavailable as quality `missing`)
//
// Every Home Assistant field the model has no column for travels in
// `metadata.ha`, so that the export gives the registry back as it was. The
// library speaks SQL only, through the `Db` interface, and works with PGlite,
// node-postgres or postgres.js alike.
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

import type { Db } from '../db.js';
export type { Db };

export const SOURCE_CODE = 'homeassistant';

/**
 * Home Assistant device classes and units, to the core's quantities and the
 * factor that brings a value into the quantity's unit. Anything else gets a
 * quantity of its own, published by this library, so that nothing is lost.
 */
const QUANTITIES: Record<string, { quantity: string; factor: number }> = {
  'temperature|°C': { quantity: 'temperature', factor: 1 },
  'humidity|%': { quantity: 'humidity', factor: 1 },
  'carbon_dioxide|ppm': { quantity: 'co2', factor: 1 },
  'power|W': { quantity: 'power', factor: 0.001 },
  'power|kW': { quantity: 'power', factor: 1 },
  'energy|Wh': { quantity: 'energy', factor: 0.001 },
  'energy|kWh': { quantity: 'energy', factor: 1 },
  'energy|MWh': { quantity: 'energy', factor: 1000 },
  'battery|%': { quantity: 'charge_level', factor: 1 },
  'irradiance|W/m²': { quantity: 'irradiance', factor: 1 },
  'volume|m³': { quantity: 'volume', factor: 1 },
  'gas|m³': { quantity: 'volume', factor: 1 },
  'occupancy|': { quantity: 'occupancy', factor: 1 },
  'presence|': { quantity: 'occupancy', factor: 1 },
};

const SETPOINT_DOMAINS = new Set(['number', 'input_number', 'climate', 'water_heater']);
const COMMAND_DOMAINS = new Set(['switch', 'button', 'input_boolean', 'light', 'cover', 'fan', 'lock', 'script']);
const BINARY_DOMAINS = new Set(['binary_sensor', 'switch', 'input_boolean', 'light', 'lock']);

const domainOf = (entityId: string) => entityId.split('.')[0];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'none';

function quantityFor(entity: HaEntity): { quantity: string; factor: number; publish: boolean } {
  const cls = entity.device_class ?? entity.original_device_class ?? '';
  const key = `${cls}|${entity.unit_of_measurement ?? ''}`;
  const known = QUANTITIES[key];
  if (known) return { ...known, publish: false };
  return { quantity: `ha_${slug(cls || domainOf(entity.entity_id))}_${slug(entity.unit_of_measurement ?? 'none')}`, factor: 1, publish: true };
}

function kindFor(entity: HaEntity): 'measured' | 'setpoint' | 'command' {
  const domain = domainOf(entity.entity_id);
  if (SETPOINT_DOMAINS.has(domain)) return 'setpoint';
  if (COMMAND_DOMAINS.has(domain)) return 'command';
  return 'measured';
}

function valueKindFor(entity: HaEntity): 'instant' | 'cumulative' | 'interval' {
  return entity.state_class === 'total' || entity.state_class === 'total_increasing' ? 'cumulative' : 'instant';
}

export interface ImportTarget {
  organisationId: string;
  siteId: string;
  buildingId: string;
}

export interface ImportResult {
  /** Floor id → space of kind floor. */
  floors: Map<string, string>;
  /** Area id → space of kind room. */
  spaces: Map<string, string>;
  devices: Map<string, string>;
  /** Entity id → series. */
  series: Map<string, string>;
}

async function id(db: Db, sql: string, params: unknown[]): Promise<string> {
  const r = await db.query<{ id: string }>(sql, params);
  return r.rows[0].id;
}

/** Writes a Home Assistant snapshot into a building. Idempotent on a fresh building. */
export async function importHomeAssistant(db: Db, target: ImportTarget, snapshot: HaSnapshot): Promise<ImportResult> {
  const { organisationId: org, siteId, buildingId } = target;
  await db.query(
    `insert into sources (code, name, kind, docs_url, auth, published_by, description)
     values ($1, 'Home Assistant', 'api', 'https://developers.home-assistant.io/docs/api/rest/', 'api_key', 'homeassistant',
             'A Home Assistant instance: its registries and the states its recorder keeps.')
     on conflict (code) do nothing`,
    [SOURCE_CODE],
  );

  const floors = new Map<string, string>();
  for (const [i, f] of snapshot.floors.entries()) {
    floors.set(f.floor_id, await id(db,
      `insert into spaces (organisation_id, building_id, kind, name, level, source_code, metadata)
       values ($1, $2, 'floor', $3, $4, $5, $6) returning id`,
      [org, buildingId, f.name, f.level ?? i, SOURCE_CODE, { ha: { floor_id: f.floor_id, level: f.level, icon: f.icon, aliases: f.aliases } }]));
  }

  const spaces = new Map<string, string>();
  for (const a of snapshot.areas) {
    const floorId = a.floor_id ? floors.get(a.floor_id) ?? null : null;
    spaces.set(a.area_id, await id(db,
      `insert into spaces (organisation_id, building_id, parent_id, kind, name, source_code, metadata)
       values ($1, $2, $3, 'room', $4, $5, $6) returning id`,
      [org, buildingId, floorId, a.name, SOURCE_CODE, { ha: { area_id: a.area_id, floor_id: a.floor_id, icon: a.icon, aliases: a.aliases } }]));
  }

  const devices = new Map<string, string>();
  for (const d of snapshot.devices) {
    devices.set(d.id, await id(db,
      `insert into devices (organisation_id, site_id, building_id, space_id, name, device_type, manufacturer, model, serial_number, source_code, metadata)
       values ($1, $2, $3, $4, $5, 'sensor_box', $6, $7, $8, $9, $10) returning id`,
      [org, siteId, buildingId, (d.area_id && spaces.get(d.area_id)) || null, d.name_by_user ?? d.name ?? d.id, d.manufacturer, d.model, d.serial_number, SOURCE_CODE,
       { ha: { id: d.id, name: d.name, name_by_user: d.name_by_user, sw_version: d.sw_version, hw_version: d.hw_version,
               area_id: d.area_id, via_device_id: d.via_device_id, identifiers: d.identifiers, connections: d.connections } }]));
  }

  // One series per entity, whether the recorder kept states for it or not:
  // the point exists before its first value. Its name is the entity id,
  // which Home Assistant keeps unique.
  const series = new Map<string, string>();
  const factors = new Map<string, number>();
  for (const e of snapshot.entities) {
    const q = quantityFor(e);
    if (q.publish) {
      await db.query(
        `insert into quantities (code, name, unit, aggregation, published_by) values ($1, $2, $3, $4, 'homeassistant') on conflict (code) do nothing`,
        [q.quantity, `${e.device_class ?? domainOf(e.entity_id)} (${e.unit_of_measurement ?? 'no unit'})`, e.unit_of_measurement ?? 'UNITLESS',
         valueKindFor(e) === 'cumulative' ? 'last' : 'mean'],
      );
    }
    const device = (e.device_id && devices.get(e.device_id)) || null;
    const observed = device || (e.area_id && spaces.get(e.area_id)) || buildingId;
    factors.set(e.entity_id, q.factor);
    series.set(e.entity_id, await id(db,
      `select open_series($1, $2, $3, $4, null, $5, $6, $7, $8, null, $9) id`,
      [observed, q.quantity, kindFor(e), valueKindFor(e), device, `homeassistant://${e.entity_id}`, SOURCE_CODE, e.entity_id,
       { ha: { ...e, binary: BINARY_DOMAINS.has(domainOf(e.entity_id)), factor: q.factor } }]));
  }

  const byEntity = new Map<string, HaState[]>();
  for (const s of snapshot.states) byEntity.set(s.entity_id, [...(byEntity.get(s.entity_id) ?? []), s]);
  for (const [entityId, states] of byEntity) {
    const seriesId = series.get(entityId);
    if (!seriesId) continue;
    const factor = factors.get(entityId) ?? 1;
    const values = states.map((s) => {
      const n = s.state === 'on' ? 1 : s.state === 'off' ? 0 : Number(s.state);
      const missing = s.state === 'unavailable' || s.state === 'unknown' || Number.isNaN(n);
      return { at: s.last_updated, value: missing ? 0 : round(n * factor), quality: missing ? 3 : 0 };
    });
    await db.query(`select store_values($1, $2::timestamptz[], $3::float8[], $4::smallint[])`,
      [seriesId, values.map((v) => v.at), values.map((v) => v.value), values.map((v) => v.quality)]);
  }
  return { floors, spaces, devices, series };
}

const round = (n: number) => Number(n.toPrecision(12));

/** Reads a building back as a Home Assistant snapshot. */
export async function exportHomeAssistant(db: Db, buildingId: string): Promise<HaSnapshot> {
  const floors = await db.query<{ ha: Omit<HaFloor, 'name'>; name: string }>(
    `select metadata->'ha' ha, name from spaces where building_id = $1 and kind = 'floor' and metadata ? 'ha' order by level`, [buildingId]);
  const areas = await db.query<{ ha: Omit<HaArea, 'name'>; name: string }>(
    `select metadata->'ha' ha, name from spaces where building_id = $1 and kind = 'room' and metadata ? 'ha' order by name`, [buildingId]);
  const devices = await db.query<{ ha: Record<string, unknown>; manufacturer: string | null; model: string | null; serial_number: string | null }>(
    `select metadata->'ha' ha, manufacturer, model, serial_number from devices where building_id = $1 and metadata ? 'ha' order by name`, [buildingId]);
  const points = await db.query<{ id: string; ha: HaEntity & { binary: boolean; factor: number } }>(
    `select se.id, se.metadata->'ha' ha from series se where se.metadata ? 'ha' and building_of(se.object_id) = $1
      order by se.metadata->'ha'->>'entity_id'`, [buildingId]);
  const states: HaState[] = [];
  for (const s of points.rows) {
    const values = await db.query<{ at: Date; value: number; quality: number }>(
      `select at, value, quality from series_values where series_id = $1 order by at`, [s.id]);
    for (const v of values.rows) {
      const state = v.quality === 3 ? 'unavailable'
        : s.ha.binary ? (v.value >= 1 ? 'on' : 'off')
        : String(round(v.value / s.ha.factor));
      states.push({ entity_id: s.ha.entity_id, state, last_updated: new Date(v.at).toISOString() });
    }
  }
  return {
    floors: floors.rows.map((r) => ({ floor_id: r.ha.floor_id, name: r.name, level: r.ha.level, icon: r.ha.icon, aliases: r.ha.aliases })),
    areas: areas.rows.map((r) => ({ area_id: r.ha.area_id, name: r.name, floor_id: r.ha.floor_id, icon: r.ha.icon, aliases: r.ha.aliases })),
    devices: devices.rows.map((r) => ({
      id: r.ha.id as string, name: r.ha.name as string | null, name_by_user: r.ha.name_by_user as string | null,
      manufacturer: r.manufacturer, model: r.model, sw_version: r.ha.sw_version as string | null, hw_version: r.ha.hw_version as string | null,
      serial_number: r.serial_number, area_id: r.ha.area_id as string | null, via_device_id: r.ha.via_device_id as string | null,
      identifiers: r.ha.identifiers as [string, string][], connections: r.ha.connections as [string, string][],
    })),
    entities: points.rows.map(({ ha }) => {
      const { binary: _b, factor: _f, ...entity } = ha;
      return entity;
    }),
    states,
  };
}
