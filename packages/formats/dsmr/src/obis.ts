// What an OBIS code of a P1 telegram measures, read from the code itself
// (IEC 62056-61, A-B:C.D.E): A the medium (1 electricity, 0 abstract or a
// device of the meter's bus), B the channel, C the quantity, D how it stands
// in time, E the tariff. The codes of the DSMR P1 companion standard and of
// its Belgian variant (e-MUCS) are all of this shape; a code not decoded
// here is kept in the reading's lines, never dropped.

import type { DsmrKind, DsmrMeasure, DsmrValue } from './types.js';

export type ObisMeaning = Pick<DsmrValue, 'measure' | 'kind' | 'direction' | 'phase' | 'tariff' | 'channel'>;

/** C of an electricity code: what it measures, in which direction, on which phase. */
const QUANTITIES: Record<number, Pick<DsmrValue, 'measure' | 'direction' | 'phase'>> = {
  1: { measure: 'power', direction: 'offtake', phase: null },
  2: { measure: 'power', direction: 'injection', phase: null },
  21: { measure: 'power', direction: 'offtake', phase: 'L1' },
  22: { measure: 'power', direction: 'injection', phase: 'L1' },
  41: { measure: 'power', direction: 'offtake', phase: 'L2' },
  42: { measure: 'power', direction: 'injection', phase: 'L2' },
  61: { measure: 'power', direction: 'offtake', phase: 'L3' },
  62: { measure: 'power', direction: 'injection', phase: 'L3' },
  31: { measure: 'current', direction: null, phase: 'L1' },
  51: { measure: 'current', direction: null, phase: 'L2' },
  71: { measure: 'current', direction: null, phase: 'L3' },
  32: { measure: 'voltage', direction: null, phase: 'L1' },
  52: { measure: 'voltage', direction: null, phase: 'L2' },
  72: { measure: 'voltage', direction: null, phase: 'L3' },
};

/** D of an electricity code: how its value stands in time. */
const KINDS: Record<number, DsmrKind> = { 4: 'average', 6: 'maximum', 7: 'instant', 8: 'cumulative' };

/**
 * The meaning of an OBIS code, or null for one that is not a measure (an
 * identifier, a stamp, a switch, a message, a log). C = 1 or 2 with D = 8 is
 * the energy register of that direction, E its tariff (0 the total); with
 * D = 4 or 6 the quarter-hour demand. On channel 1 to 4 (A = 0), C = 24 with
 * D = 2 is the volume a gas, water or heat meter of the bus last sent.
 */
export function obisMeaning(obis: string): ObisMeaning | null {
  const m = /^(\d+)-(\d+):(\d+)\.(\d+)\.(\d+)$/.exec(obis.trim());
  if (!m) return null;
  const [a, b, c, d, e] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (a === 0 && b >= 1 && c === 24 && d === 2) {
    return { measure: 'volume', kind: 'cumulative', direction: null, phase: null, tariff: null, channel: b };
  }
  if (a !== 1) return null;
  const quantity = QUANTITIES[c];
  const kind = KINDS[d];
  if (!quantity || !kind) return null;
  if (kind === 'cumulative') {
    if (quantity.phase !== null || quantity.measure !== 'power') return null;
    return { measure: 'energy', kind, direction: quantity.direction, phase: null, tariff: e, channel: b };
  }
  if ((kind === 'average' || kind === 'maximum') && (quantity.measure !== 'power' || quantity.phase !== null)) return null;
  return { ...quantity, measure: quantity.measure as DsmrMeasure, kind, tariff: null, channel: b };
}
