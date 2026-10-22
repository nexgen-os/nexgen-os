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
  /** The PV system the estimate is of (a yield, a performance, an exceedance)… */
  deviceId?: string;
  /** …or the participant it is for, before any system (a potential, a sizing). */
  participantId?: string;
  /** The kind of figure; `yield` when absent. */
  kind?: 'yield' | 'performance' | 'exceedance' | 'potential' | 'sizing';
  inputs: unknown;
  /** The series it computed; their ids are given to `results`. */
  owned?: OwnedSeries[];
  results: (seriesIds: Record<string, string>) => Record<string, unknown>;
  /** The estimate this computation replaces. */
  replaces?: string;
  /** Its loss chain, in order, written as rows of `solar.estimate_losses`. */
  losses?: LossRow[];
  /** Its exceedance levels, written as rows of `solar.estimate_levels`. */
  levels?: { probability: number; energy_kwh: number }[];
}

/** One loss of a chain: a code of `solar.loss_kinds`, a fraction (null: a model computes it), where it was read, its status. */
export interface LossRow {
  array_name: string | null;
  code: string;
  fraction: number | null;
  source_code: string | null;
  reference: string;
  status: 'published' | 'measured' | 'estimated' | 'default';
}

/** A soiling as `solar.soiling_of()` gives it: the place's value, where it was found and its status. */
export interface FoundLoss {
  value: number;
  level: string;
  source_code: string | null;
  reference: string | null;
  status?: string;
}

/**
 * The loss chain of a yield as rows: the profile's losses in their order,
 * each a default of the profile (`solar.yield_profiles:<code>`), the
 * soiling the place says in place of the profile's when it says one, with
 * its source and status. Arrays whose chains are the same give one chain
 * (`array_name` null); otherwise one per array.
 */
export function lossChain(
  profileCode: string,
  profileLosses: { code: string; pct: number | null }[],
  arrays: { name: string; soiling: FoundLoss | null }[],
): LossRow[] {
  const chainOf = (soiling: FoundLoss | null, arrayName: string | null): LossRow[] =>
    profileLosses.map((l) => {
      if (l.code === 'soiling' && soiling) {
        return {
          array_name: arrayName, code: l.code, fraction: soiling.value, source_code: soiling.source_code,
          reference: soiling.reference ?? `soiling_loss of the ${soiling.level}`,
          status: (soiling.status as LossRow['status'] | undefined) ?? 'estimated',
        };
      }
      return {
        array_name: arrayName, code: l.code, fraction: l.pct === null ? null : Number(l.pct) / 100, source_code: null,
        reference: `solar.yield_profiles:${profileCode}${l.pct === null ? ', computed by the engine\'s model' : ''}`, status: 'default',
      };
    });
  const key = (a: { soiling: FoundLoss | null }) => JSON.stringify(a.soiling ? [a.soiling.value, a.soiling.source_code, a.soiling.reference] : null);
  if (arrays.every((a) => key(a) === key(arrays[0] ?? { soiling: null }))) return chainOf(arrays[0]?.soiling ?? null, null);
  return arrays.flatMap((a) => chainOf(a.soiling, a.name));
}

/** Writes an estimate and its series; returns its id and its results. */
export async function writeEstimate(db: Db, write: EstimateWrite): Promise<{ estimateId: string; results: Record<string, unknown> }> {
  const inputs = JSON.stringify(write.inputs);
  const subject = [write.deviceId ?? null, write.participantId ?? null, write.kind ?? 'yield', write.provenance, inputs];
  const row = write.replaces
    ? (await db.query<{ id: string }>(
        'update solar.estimates set device_id = $2, participant_id = $3, kind = $4, provenance = $5, inputs = $6::jsonb where id = $1 returning id',
        [write.replaces, ...subject])).rows[0]
    : (await db.query<{ id: string }>(
        `insert into solar.estimates (device_id, participant_id, kind, provenance, inputs, results)
         values ($1, $2, $3, $4, $5::jsonb, '{}') returning id`,
        subject)).rows[0];
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
  await db.query('delete from solar.estimate_losses where estimate_id = $1', [row.id]);
  if (write.losses && write.losses.length > 0) {
    await db.query(
      `insert into solar.estimate_losses (estimate_id, array_name, position, code, fraction, source_code, reference, status)
       select $1, l.array_name, l.position, l.code, l.fraction, l.source_code, l.reference, l.status
         from jsonb_to_recordset($2::jsonb) l(array_name text, position integer, code text, fraction numeric, source_code text, reference text, status text)`,
      [row.id, JSON.stringify(write.losses.map((l, i) => ({ ...l, position: i + 1 })))]);
  }
  await db.query('delete from solar.estimate_levels where estimate_id = $1', [row.id]);
  if (write.levels && write.levels.length > 0) {
    await db.query(
      `insert into solar.estimate_levels (estimate_id, probability, energy_kwh)
       select $1, l.probability, l.energy_kwh from jsonb_to_recordset($2::jsonb) l(probability numeric, energy_kwh numeric)`,
      [row.id, JSON.stringify(write.levels)]);
  }
  return { estimateId: row.id, results };
}
