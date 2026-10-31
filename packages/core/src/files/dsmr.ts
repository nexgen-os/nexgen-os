/**
 * The readings of a P1 port, once read by `@nexgen-os/dsmr`, as the series
 * of a meter, ready for `storeSeries()`: the electricity meter on channel 0,
 * or a gas, water or heat meter of its bus on channel 1 to 4. One mapping,
 * whichever way the readings came (a telegram on the port, a P1M5 message
 * through a broker, a file of them).
 *
 * | Reading | Quantity | Value kind | Name |
 * |---|---|---|---|
 * | energy register, offtake / injection | `offtake_energy` / `injection_energy` | cumulative | `tariff <n>`; none for the total |
 * | power, offtake / injection | `offtake_power` / `injection_power` | instant | the phase, none for the connection |
 * | voltage | `voltage` | instant | the phase |
 * | volume of a meter of the bus | `volume` | cumulative, at the stamp that meter sent | none |
 *
 * Every value is dated by the meter's clock, never by its reception. A
 * reading that cannot be dated or whose checksum does not match is left out
 * whole and said in `skipped`, with its problems; a stream of readings is not
 * refused for one bad telegram. Values stay in the meter's unit, which
 * `store()` converts. The running quarter-hour demand and the month's
 * maximum are left out: the core computes demand from the series. A current
 * is left out until the core's vocabulary carries `current`.
 */
import type { DsmrProblem, DsmrReading, DsmrValue } from '@nexgen-os/dsmr';
import type { CollectedSeries } from '../connectors/interfaces.js';

/** Problems that leave a whole reading out: what is left would be wrong or undated. */
const BLOCKING = new Set([
  'telegram_unreadable', 'crc_mismatch', 'time_missing', 'time_zone_required', 'date_unreadable',
  'local_time_nonexistent', 'local_time_ambiguous', 'season_mismatch',
]);

/** The meter's units by the `units` vocabulary's codes, where its spelling is not one. */
const UNITS: Record<string, string> = { m3: 'M3' };

export interface DsmrMeterSeries {
  series: CollectedSeries[];
  /** The readings left out, by their index in the input, with the problems that did it. */
  skipped: { index: number; problems: DsmrProblem[] }[];
}

/**
 * The series of one meter in readings of a P1 port: the electricity meter
 * (`channel` 0, the default) or the meter of the bus on that channel.
 */
export function meterSeriesOfDsmr(readings: DsmrReading[], options: { channel?: number } = {}): DsmrMeterSeries {
  const channel = options.channel ?? 0;
  const skipped: DsmrMeterSeries['skipped'] = [];
  const out = new Map<string, CollectedSeries>();
  readings.forEach((reading, index) => {
    const blocking = reading.problems.filter((p) => BLOCKING.has(p.code));
    if (blocking.length > 0 || reading.at === null) {
      skipped.push({ index, problems: blocking });
      return;
    }
    for (const v of reading.values) {
      if (v.channel !== channel) continue;
      const shape = shapeOf(v);
      if (!shape) continue;
      const at = v.measure === 'volume' ? v.at : reading.at;
      if (at === null) continue;
      const unit = v.unit ? UNITS[v.unit] ?? v.unit : undefined;
      const key = `${shape.quantity_code} ${shape.name ?? ''} ${unit ?? ''}`;
      let s = out.get(key);
      if (!s) {
        s = { ...shape, step: null, ...(unit ? { unit } : {}), values: [] };
        out.set(key, s);
      }
      s.values.push({ at, value: v.value, quality: 0 });
    }
  });
  const series = [...out.values()];
  for (const s of series) {
    // One value per instant, in time order: a meter of the bus repeats its
    // last volume in every telegram until it sends a new one.
    const seen = new Set<string>();
    s.values = s.values.sort((a, b) => a.at.localeCompare(b.at)).filter((p) => !seen.has(p.at) && seen.add(p.at));
  }
  return { series, skipped };
}

function shapeOf(v: DsmrValue): Pick<CollectedSeries, 'quantity_code' | 'value_kind' | 'name'> | null {
  if (v.measure === 'energy' && v.kind === 'cumulative' && v.direction) {
    return { quantity_code: `${v.direction}_energy`, value_kind: 'cumulative', name: v.tariff ? `tariff ${v.tariff}` : null };
  }
  if (v.measure === 'power' && v.kind === 'instant' && v.direction) {
    return { quantity_code: `${v.direction}_power`, value_kind: 'instant', name: v.phase };
  }
  if (v.measure === 'voltage' && v.kind === 'instant') return { quantity_code: 'voltage', value_kind: 'instant', name: v.phase };
  if (v.measure === 'volume' && v.kind === 'cumulative') return { quantity_code: 'volume', value_kind: 'cumulative', name: null };
  return null;
}
