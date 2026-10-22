/**
 * How the `solar` module writes what it computed: one row of
 * `solar.estimates` per yield, performance or exceedance, with its inputs,
 * its provenance (the program and the version that computed it) and its
 * results; the series it computed name the row in their source
 * (`solar.estimates:<id>`). A new computation adds a row, or replaces the one
 * it is given: the row keeps its id and takes the new provenance, inputs and
 * results, and the series it wrote are written again.
 *
 * Named errors: `estimate_not_found` (the row to replace is not there, or
 * not the caller's to write).
 */
import type { CollectedSeries, Db } from '@nexgen-os/core';
import { store } from '@nexgen-os/core';

/** A series an estimate computed, under the key its results name it by. */
export interface OwnedSeries {
  key: string;
  objectKind: string;
  objectId: string;
  sourceCode: string;
  name?: string | null;
  series: CollectedSeries;
  /** The unit the values are in, a code or symbol of the `units` vocabulary; the quantity's own when absent. `store()` converts. */
  unit?: string;
}

export interface EstimateWrite {
  /** The program and the version that computed it. */
  provenance: string;
  /** The PV system the estimate is of. */
  deviceId: string;
  inputs: unknown;
  /** The series it computed; their ids are given to `results`. */
  owned?: OwnedSeries[];
  results: (seriesIds: Record<string, string>) => Record<string, unknown>;
  /** The estimate this computation replaces. */
  replaces?: string;
}

/** Writes an estimate and its series; returns its id and its results. */
export async function writeEstimate(db: Db, write: EstimateWrite): Promise<{ estimateId: string; results: Record<string, unknown> }> {
  const inputs = JSON.stringify(write.inputs);
  const row = write.replaces
    ? (await db.query<{ id: string }>(
        'update solar.estimates set device_id = $2, provenance = $3, inputs = $4::jsonb where id = $1 returning id',
        [write.replaces, write.deviceId, write.provenance, inputs])).rows[0]
    : (await db.query<{ id: string }>(
        `insert into solar.estimates (organisation_id, device_id, provenance, inputs, results)
         values (object_organisation('device', $1), $1, $2, $3::jsonb, '{}') returning id`,
        [write.deviceId, write.provenance, inputs])).rows[0];
  if (!row) throw new Error(`estimate_not_found: ${write.replaces}`);
  const source = `solar.estimates:${row.id}`;
  if (write.replaces) await db.query('delete from series where source = $1', [source]);
  const ids: Record<string, string> = {};
  // An engine says the unit of its values; `store()` converts them to the quantity's.
  for (const o of write.owned ?? []) {
    const stored = await store(db, {
      object_kind: o.objectKind, object_id: o.objectId, quantity_code: o.series.quantity_code, kind: 'simulated', value_kind: o.series.value_kind,
      step: o.series.step, source_code: o.sourceCode, name: o.name ?? null, source,
    }, o.series.values, { unit: o.unit ?? null });
    ids[o.key] = stored.seriesId;
  }
  const results = write.results(ids);
  await db.query('update solar.estimates set results = $2::jsonb where id = $1', [row.id, JSON.stringify(results)]);
  return { estimateId: row.id, results };
}
