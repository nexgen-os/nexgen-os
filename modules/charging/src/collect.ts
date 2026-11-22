// What a charging station's connector read of a charger, written on the
// charger: the connector reads its cloud and hands a `ChargerReading` to its
// caller; this writes it, with its provenance, so that the connector itself
// never reaches the database nor the core (decision 0064).

import { storeSeries, type ChargerReading, type Db } from '@nexgen-os/core';

export interface RecordedCharger {
  /** The sessions recorded, by id in `charging.sessions`, in the order of the reading. */
  sessions: string[];
  /** The series of the charger written, with the readings each received. */
  series: { quantity: string; seriesId: string; inserted: number }[];
}

/**
 * Writes what a connector read of a charger described in `charging.devices`:
 * each session once through `charging.record()` (source `station`, the
 * reference the connector gave as `source_ref`), each series as a `measured`
 * series of the device, source the connector's. A second record of the same
 * reading changes nothing. Refuses as `charging.record()` does
 * (`charger_not_described`).
 */
export async function recordCharger(
  db: Db,
  target: { organisationId: string; deviceId: string },
  reading: ChargerReading,
): Promise<RecordedCharger> {
  const sessions: string[] = [];
  for (const s of reading.sessions) {
    const r = await db.query<{ id: string }>('select charging.record($1, $2::jsonb, $3, $4) id', [target.deviceId, JSON.stringify(s.record), 'station', s.source_ref]);
    sessions.push(r.rows[0]!.id);
  }
  const series: RecordedCharger['series'] = [];
  for (const s of reading.series) {
    const stored = await storeSeries(db, { organisationId: target.organisationId, objectKind: 'device', objectId: target.deviceId, sourceCode: reading.source_code, kind: 'measured' }, s);
    series.push({ quantity: s.quantity_code, ...stored });
  }
  return { sessions, series };
}
