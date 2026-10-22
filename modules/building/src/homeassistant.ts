/**
 * A Home Assistant home in the model, and back.
 *
 * `@nexgen-os/homeassistant` reads a snapshot into plain shapes; this
 * importer writes them through the gestures of the core and of the `building`
 * module, and the exporter
 * reads a building back into the same shapes:
 *
 *   space   → `building.add_space()`, kind floor or room (a floor's level is the
 *             file's, else its rank)
 *   device  → `install_device()`, type `sensor_box`, under the participant,
 *             with its nameplate, in service; its room stays in its
 *             `file_record` attribute (a device is not placed, decision 0026)
 *   point   → `series_ensure()`, on its device, else on the participant;
 *             its quantity from its class and unit; its kind from its role
 *   reading → `store()`, converted to the quantity's unit by the `units`
 *             vocabulary; a missing reading as quality 3
 *
 * What a shape carries that no column holds travels in `metadata.ha` (of a
 * space, of a series) or in the `file_record` attribute of a device, so that
 * the export gives the shapes back as they came.
 */
import type { Home, HomeDevice, HomePoint, HomeSpace } from '@nexgen-os/homeassistant';
import type { Db } from '@nexgen-os/core';
import { store } from '@nexgen-os/core';

export const HOMEASSISTANT_SOURCE = 'homeassistant';

/**
 * Home Assistant device classes to the core's quantities. The unit a point
 * states is looked up in the `units` vocabulary and converted by `store()`.
 * A class this list does not know, or a unit that does not measure its
 * quantity, gets a quantity of its own, published by the importer, so that
 * nothing is lost.
 */
const QUANTITIES: Record<string, string> = {
  temperature: 'temperature',
  humidity: 'humidity',
  carbon_dioxide: 'co2',
  power: 'power',
  energy: 'energy',
  battery: 'charge_level',
  irradiance: 'irradiance',
  volume: 'volume',
  gas: 'volume',
  occupancy: 'occupancy',
  presence: 'occupancy',
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'none';

/** The quantity of a point, and whether its unit is converted by the core or a quantity is published for it. */
async function quantityFor(db: Db, point: HomePoint): Promise<{ quantity: string; converted: boolean; publish: boolean }> {
  const known = QUANTITIES[point.deviceClass ?? ''];
  if (known && point.unit === null) return { quantity: known, converted: false, publish: false };
  if (known) {
    const r = await db.query<{ ok: boolean }>(
      `select exists (select 1 from units a join units b on b.quantity_kind = a.quantity_kind join quantities q on q.unit = b.code
                       where q.code = $1 and (a.code = $2 or a.symbol = $2)) ok`, [known, point.unit]);
    if (r.rows[0].ok) return { quantity: known, converted: true, publish: false };
  }
  return { quantity: `ha_${slug(point.deviceClass ?? point.domain)}_${slug(point.unit ?? 'none')}`, converted: false, publish: true };
}

export interface HomeTarget {
  /** The participant the devices belong to. */
  participantId: string;
  /** Its building, where the floors and rooms are described. */
  buildingId: string;
}

export interface HomeImport {
  /** Space key (floor or area id) → space. */
  spaces: Map<string, string>;
  devices: Map<string, string>;
  /** Point key (entity id) → series. */
  series: Map<string, string>;
}

async function id(db: Db, sql: string, params: unknown[]): Promise<string> {
  const r = await db.query<{ id: string }>(sql, params);
  return r.rows[0].id;
}

/** Writes a home: its floors and rooms into a building, its devices under the participant, one series per point and their readings. */
export async function importHomeAssistant(db: Db, target: HomeTarget, home: Home): Promise<HomeImport> {
  const { participantId, buildingId } = target;
  await db.query(
    `insert into sources (code, name, kind, docs_url, auth, published_by, description)
     values ($1, 'Home Assistant', 'api', 'https://developers.home-assistant.io/docs/api/rest/', 'api_key', 'homeassistant',
             'A Home Assistant instance: its registries and the states its recorder keeps.')
     on conflict (code) do nothing`,
    [HOMEASSISTANT_SOURCE],
  );

  const spaces = new Map<string, string>();
  const floors = home.spaces.filter((s) => s.kind === 'floor');
  for (const [i, s] of floors.entries()) {
    spaces.set(s.key, await id(db,
      `select building.add_space($1, 'floor', $2, null, $3, null, null, null, $4, $5) id`,
      [buildingId, s.name, s.level ?? i, HOMEASSISTANT_SOURCE, { ha: { key: s.key, level: s.level, extra: s.extra } }]));
  }
  for (const s of home.spaces.filter((x) => x.kind === 'room')) {
    spaces.set(s.key, await id(db,
      `select building.add_space($1, 'room', $2, $3, null, null, null, null, $4, $5) id`,
      [buildingId, s.name, (s.parent && spaces.get(s.parent)) || null, HOMEASSISTANT_SOURCE, { ha: { key: s.key, parent: s.parent, extra: s.extra } }]));
  }

  const devices = new Map<string, string>();
  for (const d of home.devices) {
    const device = await id(db,
      `select install_device($1, 'sensor_box', $2, p_source_code => $3, p_nameplate => $4, p_status => 'in_service') id`,
      [participantId, d.name, HOMEASSISTANT_SOURCE,
       { manufacturer: d.manufacturer, model: d.model, serial_number: d.serialNumber }]);
    await db.query(`select set_attribute('device', $1, 'file_record', $2::jsonb, null, $3)`,
      [device, JSON.stringify({ ha: { key: d.key, space: d.space, extra: d.extra } }), HOMEASSISTANT_SOURCE]);
    devices.set(d.key, device);
  }

  // One series per point, whether the recorder kept states for it or not:
  // the point exists before its first value. Its name is the entity id,
  // which Home Assistant keeps unique.
  const series = new Map<string, string>();
  for (const p of home.points) {
    const q = await quantityFor(db, p);
    if (q.publish) {
      await db.query(
        `insert into quantities (code, name, unit, aggregation, published_by) values ($1, $2, $3, $4, 'homeassistant') on conflict (code) do nothing`,
        [q.quantity, `${p.deviceClass ?? p.domain} (${p.unit ?? 'no unit'})`, p.unit ?? 'UNITLESS', p.valueKind === 'cumulative' ? 'last' : 'mean'],
      );
    }
    const device = (p.device && devices.get(p.device)) || null;
    const [kind, observed] = device ? ['device', device] : ['participant', participantId];
    const seriesId = await id(db,
      `select series_ensure($1, $2, $3, $4, $5, null, $6, $7, $8, $9, $10) id`,
      [kind, observed, q.quantity, p.role, p.valueKind, device, `homeassistant://${p.key}`, HOMEASSISTANT_SOURCE, p.key,
       { ha: { key: p.key, device: p.device, space: p.space, unit: p.unit, binary: p.binary, converted: q.converted, extra: p.extra } }]);
    series.set(p.key, seriesId);
    if (p.readings.length) {
      await store(db, seriesId, p.readings.map((r) => ({ at: r.at, value: r.value ?? 0, quality: r.value === null ? 3 : 0 })),
        { unit: q.converted ? p.unit : null });
    }
  }
  return { spaces, devices, series };
}

interface Stored<T> {
  name: string;
  ha: T;
}

/** A building read back as a home: the spaces, the devices of its participant and the points an import wrote, with their readings in the units they came in. */
export async function exportHomeAssistant(db: Db, buildingId: string): Promise<Home> {
  const floors = await db.query<Stored<{ key: string; level: number | null; extra: Record<string, unknown> }>>(
    `select name, metadata->'ha' ha from building.spaces where building_id = $1 and kind = 'floor' and metadata ? 'ha' order by level`, [buildingId]);
  const rooms = await db.query<Stored<{ key: string; parent: string | null; extra: Record<string, unknown> }>>(
    `select name, metadata->'ha' ha from building.spaces where building_id = $1 and kind = 'room' and metadata ? 'ha' order by name`, [buildingId]);
  const devices = await db.query<Stored<{ key: string; space: string | null; extra: Record<string, unknown> }> & {
    manufacturer: string | null; model: string | null; serial_number: string | null;
  }>(
    `select d.name, a.value->'ha' ha, d.manufacturer, d.model, d.serial_number
       from devices d join building.buildings b on b.participant_id = d.participant_id
       join attributes a on a.object_kind = 'device' and a.object_id = d.id and a.property_code = 'file_record'
      where b.id = $1 and a.value ? 'ha' order by d.name`,
    [buildingId]);
  const points = await db.query<{ id: string; unit: string; quantity: string; kind: HomePoint['role']; value_kind: HomePoint['valueKind'];
    ha: { key: string; device: string | null; space: string | null; unit: string | null; binary: boolean; converted: boolean; extra: Record<string, unknown> } }>(
    `select se.id, q.unit, se.quantity_code quantity, se.kind, se.value_kind, se.metadata->'ha' ha
       from series se join quantities q on q.code = se.quantity_code
      where se.metadata ? 'ha' and participant_of(se.object_kind, se.object_id) = (select participant_id from building.buildings where id = $1)
      order by se.metadata->'ha'->>'key'`, [buildingId]);

  const spaces: HomeSpace[] = [
    ...floors.rows.map((r): HomeSpace => ({ key: r.ha.key, kind: 'floor', name: r.name, level: r.ha.level, parent: null, extra: r.ha.extra })),
    ...rooms.rows.map((r): HomeSpace => ({ key: r.ha.key, kind: 'room', name: r.name, level: null, parent: r.ha.parent, extra: r.ha.extra })),
  ];
  const homeDevices = devices.rows.map((r): HomeDevice => ({
    key: r.ha.key, name: r.name, manufacturer: r.manufacturer, model: r.model, serialNumber: r.serial_number, space: r.ha.space, extra: r.ha.extra,
  }));
  const homePoints: HomePoint[] = [];
  for (const s of points.rows) {
    // Back into the unit the point states, through the same vocabulary.
    const values = await db.query<{ at: Date; value: number; quality: number }>(
      `select w.at, case when $2::text is null then w.value else convert_unit(w.value, $3, $2) end as value, w.quality
         from nexgen.window($1, '-infinity', 'infinity', 2147483647) w`,
      [s.id, s.ha.converted ? s.ha.unit : null, s.unit]);
    const domain = s.ha.key.split('.')[0];
    const deviceClass = (s.ha.extra.device_class ?? s.ha.extra.original_device_class ?? null) as string | null;
    homePoints.push({
      key: s.ha.key, device: s.ha.device, space: s.ha.space, domain, deviceClass, unit: s.ha.unit,
      role: s.kind, valueKind: s.value_kind === 'cumulative' ? 'cumulative' : 'instant', binary: s.ha.binary, extra: s.ha.extra,
      readings: values.rows.map((v) => ({ at: new Date(v.at).toISOString(), value: v.quality === 3 ? null : v.value })),
    });
  }
  return { spaces, devices: homeDevices, points: homePoints };
}
