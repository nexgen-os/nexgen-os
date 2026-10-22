// The import of what a charging station said, as its central system
// recorded it or as a file holds it: the sessions, recorded once per
// transaction of their source by `charging.record()`, and the readings of
// its meters, stored as series of the charger by `store()` in the unit the
// station gave, converted to the unit of their quantity.
//
// Only the totals of a measurand are stored (no phase), and only the
// measurands `MEASURANDS` of `@nexgen-os/ocpp` gives a quantity; the rest
// is counted in what the import returns, never dropped silently.

import { store, type Db } from '@nexgen-os/core';
import { MEASURANDS, readStationLog, type LogEntry, type OcppVersion, type StationIdentity } from '@nexgen-os/ocpp';

export interface ImportedLog {
  /** The sessions recorded, by id, in the order of the log. */
  sessions: string[];
  /** The series of the charger written, by id, with the values each received. */
  series: { seriesId: string; quantity: string; evseId: number; values: number }[];
  /** Readings not stored: a phase, or a measurand with no quantity. */
  skipped: number;
  identity: StationIdentity | null;
}

/**
 * Imports a station's log into a charger described in `charging.devices`:
 * its sessions through `charging.record()` (a second import changes
 * nothing), its readings as `measured` series of the device, one per
 * quantity and EVSE (EVSE 0 is the station), and the identity it booted
 * with into the charger's metadata.
 */
export async function importStationLog(
  db: Db,
  deviceId: string,
  entries: LogEntry[],
  version: OcppVersion,
  origin: { source?: 'station' | 'file'; sourceRef?: string | null } = {},
): Promise<ImportedLog> {
  const log = readStationLog(entries, version);
  const source = origin.source ?? 'station';
  const sessions: string[] = [];
  for (const s of log.sessions) {
    const r = await db.query<{ id: string }>('select charging.record($1, $2::jsonb, $3, $4) id', [deviceId, JSON.stringify(s), source, origin.sourceRef ?? null]);
    sessions.push(r.rows[0].id);
  }

  const groups = new Map<string, { quantity: string; valueKind: string; evseId: number; unit: string; points: Map<string, number> }>();
  let skipped = 0;
  for (const r of log.readings) {
    const m = MEASURANDS[r.measurand];
    if (!m || r.phase !== null) {
      skipped++;
      continue;
    }
    const key = `${m.quantity}|${r.evseId}|${r.unit}`;
    const g = groups.get(key) ?? { quantity: m.quantity, valueKind: m.valueKind, evseId: r.evseId, unit: r.unit, points: new Map() };
    g.points.set(r.at, r.value);
    groups.set(key, g);
  }
  const series: ImportedLog['series'] = [];
  for (const g of groups.values()) {
    const points = [...g.points].sort(([a], [b]) => a.localeCompare(b)).map(([at, value]) => ({ at, value }));
    const { seriesId } = await store(db, {
      object_kind: 'device', object_id: deviceId, device_id: deviceId, quantity_code: g.quantity, kind: 'measured',
      value_kind: g.valueKind as 'cumulative' | 'instant', step: null, name: g.evseId === 0 ? 'station' : `EVSE ${g.evseId}`,
      source: `ocpp ${version}`,
    }, points, { unit: g.unit });
    series.push({ seriesId, quantity: g.quantity, evseId: g.evseId, values: points.length });
  }

  if (log.identity) {
    await db.query(`update charging.devices set metadata = metadata || jsonb_build_object('boot', $2::jsonb) where id = $1`, [deviceId, JSON.stringify(log.identity)]);
  }
  return { sessions, series, skipped, identity: log.identity };
}
