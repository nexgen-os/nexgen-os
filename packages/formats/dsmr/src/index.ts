/**
 * `@nexgen-os/dsmr` — what the P1 port of a smart meter says, read into
 * plain values: the DSMR telegram (2.2 to 5.0.2, and the Belgian e-MUCS
 * variant) and the JSON message of the open P1M5 dongle. Each value says
 * what it measures, in which direction (offtake or injection), on which
 * phase and in which tariff register, in the unit the meter writes; the
 * reading is dated by the meter's clock in UTC, with the zone the caller
 * gives. Problems by name, never corrected. No database, no network.
 */
export { readTelegram, readP1m5, crc16 } from './read.js';
export { obisMeaning, type ObisMeaning } from './obis.js';
export { meterTime, type MeterTime } from './time.js';
export type { DsmrKind, DsmrLine, DsmrMeasure, DsmrOptions, DsmrProblem, DsmrReading, DsmrValue } from './types.js';
