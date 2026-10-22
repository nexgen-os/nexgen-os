/**
 * An R63 or R64 file of Enedis, once read, as the series of a meter.
 *
 * `@nexgen-os/enedis-r6x` reads the file with the zone and the quality table
 * of the operator's hub (`grid.operators.meter_data`); `meterSeriesOfR6x()`
 * names what it read in the core's terms, ready for `storeSeries()` or
 * `collectMeterReadings()`. One reading, one mapping, whichever way the file
 * came: through an intermediary (Switchgrid), from the operator's own
 * channel, or uploaded by a person.
 *
 * | File | Quantity | Value kind |
 * |---|---|---|
 * | `PA` `CONS` / `PROD` | `offtake_power` / `injection_power` | interval, the file's step |
 * | `PRI` / `PRC` `CONS` | `reactive_power_inductive` / `_capacitive` | interval |
 * | `E` | `voltage` | interval |
 * | `EA` index `CONS` / `PROD` | `offtake_energy` / `injection_energy` | cumulative, one series per dial named `calendar/time class` |
 *
 * Values stay in the file's unit, which `store()` converts. A problem that
 * would make a value wrong (no zone, a letter without a code, a date not
 * read) refuses the file by name; nothing is stored half.
 */
import { readR6x, durationMs, type R6xFile, type R6xOptions, type R6xSeries } from '@nexgen-os/enedis-r6x';
import { GestureError } from '../refusal.js';
import type { CollectedSeries } from '../connectors/interfaces.js';
import type { MeterDataHub } from '../connectors/meter-data.js';

/** Problems of a reading that refuse the file: what is left would be wrong. */
const BLOCKING = new Set(['file_unreadable', 'time_zone_required', 'local_time_nonexistent', 'date_unreadable', 'quality_unknown']);

/** The file's units by the `units` vocabulary's codes, where its spelling is not one. */
const UNITS: Record<string, string> = { VAr: 'V-A_Reactive', var: 'V-A_Reactive', kVAr: 'KiloV-A_Reactive' };

/** Reads a file with the conventions of the hub it came from. */
export function readMeterFile(text: string | Record<string, unknown>, hub: Pick<MeterDataHub, 'time_zone' | 'quality_codes'>): R6xFile {
  const options: R6xOptions = { qualityCodes: hub.quality_codes, ...(hub.time_zone ? { timeZone: hub.time_zone } : {}) };
  return readR6x(text, options);
}

/**
 * The series of one metering point in a file read by `@nexgen-os/enedis-r6x`,
 * as `CollectedSeries`. Refuses `meter_file_unreadable` with the problems
 * that make it so, `meter_file_empty` when the point is not in the file.
 */
export function meterSeriesOfR6x(file: R6xFile, prm: string): CollectedSeries[] {
  const blocking = file.problems.filter((p) => BLOCKING.has(p.code));
  if (blocking.length) {
    throw new GestureError(`meter_file_unreadable: ${blocking.slice(0, 3).map((p) => `${p.code} (${p.detail})`).join('; ')}`);
  }
  const ours = file.series.filter((s) => s.prm === prm);
  if (ours.length === 0) throw new GestureError(`meter_file_empty: the file holds no measures of ${prm}`);
  const out: CollectedSeries[] = [];
  for (const s of ours) {
    const quantity = quantityOf(s);
    if (!quantity) continue;
    out.push({
      quantity_code: quantity,
      value_kind: s.kind === 'index' ? 'cumulative' : 'interval',
      step: s.kind === 'index' ? null : postgresStep(s.step),
      ...(s.unit ? { unit: UNITS[s.unit] ?? s.unit } : {}),
      ...(s.kind === 'index' ? { name: [s.calendar, s.time_class].filter(Boolean).join('/') || null } : {}),
      values: s.points.map((p) => ({ at: p.start, value: p.value, quality: p.quality! })),
    });
  }
  return out;
}

function quantityOf(s: R6xSeries): string | null {
  const offtake = s.business === 'CONS';
  const injection = s.business === 'PROD';
  if (!offtake && !injection) return null;
  if (s.kind === 'index') return s.physical === 'EA' ? (offtake ? 'offtake_energy' : 'injection_energy') : null;
  switch (s.physical) {
    case 'PA': return offtake ? 'offtake_power' : 'injection_power';
    // Reactive power and voltage are read on the offtake side; the core has
    // one series of each per meter.
    case 'PRI': return offtake ? 'reactive_power_inductive' : null;
    case 'PRC': return offtake ? 'reactive_power_capacitive' : null;
    case 'E': return offtake ? 'voltage' : null;
    default: return null;
  }
}

/** `PT5M` as Postgres writes an interval, `5 minutes`; null for an irregular curve. */
function postgresStep(step: string | null): string | null {
  const ms = step ? durationMs(step) : null;
  if (!ms) return null;
  const minutes = ms / 60_000;
  return minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}` : `${minutes} minutes`;
}
