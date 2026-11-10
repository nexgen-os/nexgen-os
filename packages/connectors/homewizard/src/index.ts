// HomeWizard P1 meter — https://www.homewizard.com, a dongle on the P1 port
// of a smart meter, read on its local API v1
// (https://api-documentation.homewizard.com/docs/v1/measurement), as a
// connector. Source `homewizard`, shipped with the package.
//
// The dongle answers on the participant's own network, without a key, once
// the participant has enabled the local API in the HomeWizard Energy app:
// `GET /api` says what it is, `GET /api/v1/data` gives the meter as it read
// it last. No mandate is involved: the participant owns the dongle and runs
// the program that reads it; the operator's hub is another path
// (`MeterDataProvider`, under mandate).
//
// What comes back is in the core's terms, ready for `storeSeries()`:
//
// - the offtake and injection registers (`offtake_energy`,
//   `injection_energy`, cumulative, kWh), the total unnamed and each tariff
//   named `tariff <n>`;
// - the power of the connection and of each phase, split by direction
//   (`offtake_power`, `injection_power`, instant, W): the dongle gives one
//   signed figure, positive when the place takes from the grid;
// - the voltage of each phase (`voltage`, instant, V);
// - the meters on the bus (gas, water), each with its own identifier and
//   its own stamp, to be stored on its own meter.
//
// The electricity values carry no stamp of their own: they are dated when
// they are read, by the clock the caller gives. A meter of the bus stamps
// its value in local time without an offset: it is dated with the time zone
// of the participant (`time_zone_of()`), never one assumed here.
//
// Left out, on purpose: the running quarter-hour demand and the month's
// peak (the core computes demand from the series), the current (the core
// vocabulary has no `current` yet), the counts of sags, swells and power
// failures, the Wi-Fi signal.
//
// Nothing here reads the environment or the database: the address of the
// dongle comes from the organisation's `connectors` row.

import { readFileSync } from 'node:fs';
import { GestureError, type CollectedSeries, type SourceRow } from '@nexgen-os/core';
import { instantsOf } from '@nexgen-os/enedis-r6x';

/** The subset of `fetch` the connector uses, so a test or a proxy can stand in. */
export type HttpFetch = (url: string, init?: { method?: string; headers?: Record<string, string> }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface HomeWizardOptions {
  /** The dongle on the local network: `192.168.1.20`, `p1meter-0a1b2c.local` or a whole `http://` base. From `connectors.config.host`. */
  host: string;
  /** The IANA time zone of the participant, by which the meters of the bus stamp their values. Without it, their values are skipped (`time_zone_required`). */
  timeZone?: string | null;
  fetch?: HttpFetch;
  /** When a reading is taken, in UTC milliseconds; `Date.now` by default. */
  now?: () => number;
}

/** What the dongle says it is (`GET /api`). */
export interface HomeWizardDevice {
  /** `HWE-P1` for the P1 meter. */
  product_type: string;
  product_name: string;
  /** The dongle's own serial, which `identifiers` may keep on its device. */
  serial: string;
  firmware_version: string;
  api_version: string;
}

/** A meter on the bus of the P1 port: its identifier as the meter sends it, and its register. */
export interface BusMeter {
  /** `gas_meter`, `water_meter`… as the dongle names it. */
  type: string;
  /** The meter's equipment identifier, decoded from the hex the dongle gives when it is printable text. */
  identifier: string | null;
  series: CollectedSeries;
}

/** One reading of the dongle, in the core's terms. */
export interface HomeWizardReading {
  /** When the electricity values were read, ISO 8601 UTC, to the second. */
  at: string;
  /** The smart meter itself: its equipment identifier, its DSMR version, the tariff that runs. */
  meter: { identifier: string | null; model: string | null; smr_version: number | null; active_tariff: number | null };
  /** The series of the electricity meter, to be stored on the meter of the connection. */
  series: CollectedSeries[];
  /** The meters of the bus, each to be stored on its own meter. */
  bus: BusMeter[];
  /** What could not be read, with the name of the reason. */
  skipped: { field: string; reason: string }[];
}

export interface HomeWizardConnector {
  readonly source_code: 'homewizard';
  /** What the dongle is; refuses `device_unsupported` for another product than the P1 meter, or another API than v1. */
  identify(): Promise<HomeWizardDevice>;
  /** One reading of the meter, dated now. */
  read(): Promise<HomeWizardReading>;
}

/** The product the connector reads: the P1 meter. HomeWizard's kWh meters and sockets measure a device, not a connection. */
export const P1_METER = 'HWE-P1';

/** A connector on the local API v1 of a HomeWizard P1 meter. `source_code` is `homewizard`. */
export function homewizard(options: HomeWizardOptions): HomeWizardConnector {
  if (!options.host) throw new GestureError('connector_config_required: homewizard needs the address of the dongle (host in its connectors row)');
  const base = (/^https?:\/\//.test(options.host) ? options.host : `http://${options.host}`).replace(/\/+$/, '');
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as HttpFetch);
  const now = options.now ?? Date.now;

  const call = async (path: string): Promise<unknown> => {
    let response: Awaited<ReturnType<HttpFetch>>;
    try {
      response = await doFetch(`${base}${path}`, { method: 'GET', headers: { Accept: 'application/json' } });
    } catch (error) {
      throw new GestureError(`source_unavailable: homewizard at ${base} does not answer: ${(error as Error).message}`);
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      // The dongle answers 403 while its local API is not enabled in the app.
      if (response.status === 403) throw new GestureError(`source_unauthorised: homewizard ${path} answers 403; enable the local API in the HomeWizard Energy app: ${detail}`);
      throw new GestureError(`source_unavailable: homewizard ${response.status} on ${path}: ${detail}`);
    }
    return response.json();
  };

  return {
    source_code: 'homewizard',
    async identify() {
      const r = (await call('/api')) as Record<string, unknown>;
      const device: HomeWizardDevice = {
        product_type: String(r.product_type ?? ''),
        product_name: String(r.product_name ?? ''),
        serial: String(r.serial ?? ''),
        firmware_version: String(r.firmware_version ?? ''),
        api_version: String(r.api_version ?? ''),
      };
      if (device.product_type !== P1_METER) throw new GestureError(`device_unsupported: homewizard reads the P1 meter (${P1_METER}), not ${device.product_type || 'an unnamed product'}`);
      if (device.api_version !== 'v1') throw new GestureError(`device_unsupported: homewizard reads the local API v1, the dongle gives ${device.api_version || 'none'}`);
      return device;
    },
    async read() {
      const data = await call('/api/v1/data');
      return readingOfHomeWizard(data, { at: now(), timeZone: options.timeZone ?? null });
    },
  };
}

type Json = Record<string, unknown>;

/**
 * An answer of `GET /api/v1/data` in the core's terms, dated `at` (UTC
 * milliseconds). A field the meter does not give is absent, and so is its
 * series; a value that is not a number is skipped by name.
 */
export function readingOfHomeWizard(data: unknown, options: { at: number; timeZone?: string | null }): HomeWizardReading {
  const r = (data ?? {}) as Json;
  const at = new Date(Math.floor(options.at / 1000) * 1000).toISOString();
  const skipped: HomeWizardReading['skipped'] = [];
  const series: CollectedSeries[] = [];

  const num = (field: string): number | null => {
    const v = r[field];
    if (v === undefined || v === null) return null;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      skipped.push({ field, reason: 'value_invalid' });
      return null;
    }
    return v;
  };
  const push = (quantity_code: string, value_kind: 'instant' | 'cumulative', unit: string, name: string | null, value: number) => {
    series.push({ quantity_code, value_kind, step: null, unit, name, values: [{ at, value }] });
  };

  // Registers: the total, then each tariff the meter gives.
  for (const [direction, quantity] of [['import', 'offtake_energy'], ['export', 'injection_energy']] as const) {
    const total = num(`total_power_${direction}_kwh`);
    if (total !== null) push(quantity, 'cumulative', 'KiloW-HR', null, total);
    for (let t = 1; t <= 4; t++) {
      const v = num(`total_power_${direction}_t${t}_kwh`);
      if (v !== null) push(quantity, 'cumulative', 'KiloW-HR', `tariff ${t}`, v);
    }
  }

  // Power: one signed figure per phase, positive when taking from the grid.
  for (const [field, name] of [['active_power_w', null], ['active_power_l1_w', 'L1'], ['active_power_l2_w', 'L2'], ['active_power_l3_w', 'L3']] as const) {
    const v = num(field);
    if (v === null) continue;
    push('offtake_power', 'instant', 'W', name, Math.max(v, 0));
    push('injection_power', 'instant', 'W', name, Math.max(-v, 0));
  }

  for (const phase of [1, 2, 3]) {
    const v = num(`active_voltage_l${phase}_v`);
    if (v !== null) push('voltage', 'instant', 'V', `L${phase}`, v);
  }

  return {
    at,
    meter: {
      identifier: decodeIdentifier(r.unique_id),
      model: typeof r.meter_model === 'string' ? r.meter_model : null,
      smr_version: typeof r.smr_version === 'number' ? r.smr_version : null,
      active_tariff: typeof r.active_tariff === 'number' ? r.active_tariff : null,
    },
    series,
    bus: busMeters(r, options.timeZone ?? null, skipped),
    skipped,
  };
}

/** The volume units of the bus the core's `volume` takes; another unit (`GJ` of a heat meter) waits for its quantity. */
const VOLUME_UNITS: Record<string, string> = { m3: 'M3' };

function busMeters(r: Json, timeZone: string | null, skipped: HomeWizardReading['skipped']): BusMeter[] {
  // `external` lists every meter of the bus; older firmware gives the gas
  // meter alone in `total_gas_m3`, `gas_timestamp` and `gas_unique_id`.
  const external: Json[] = Array.isArray(r.external)
    ? (r.external as Json[])
    : r.total_gas_m3 !== undefined && r.total_gas_m3 !== null
      ? [{ type: 'gas_meter', unique_id: r.gas_unique_id, timestamp: r.gas_timestamp, value: r.total_gas_m3, unit: 'm3' }]
      : [];
  const out: BusMeter[] = [];
  external.forEach((e, i) => {
    const type = String(e.type ?? 'unknown');
    const field = Array.isArray(r.external) ? `external[${i}]` : 'total_gas_m3';
    const unit = VOLUME_UNITS[String(e.unit ?? '').toLowerCase()];
    if (!unit) return skipped.push({ field, reason: 'unit_unsupported' });
    if (typeof e.value !== 'number' || !Number.isFinite(e.value)) return skipped.push({ field, reason: 'value_invalid' });
    if (!timeZone) return skipped.push({ field, reason: 'time_zone_required' });
    const wall = wallClockOf(e.timestamp);
    if (wall === null) return skipped.push({ field, reason: 'stamp_invalid' });
    const instants = instantsOf(timeZone, wall);
    // The dongle drops the summer or winter flag of the telegram: the hour
    // repeated in autumn names two instants, and neither is chosen.
    if (instants.length !== 1) return skipped.push({ field, reason: instants.length ? 'stamp_ambiguous' : 'stamp_invalid' });
    out.push({
      type,
      identifier: decodeIdentifier(e.unique_id),
      series: { quantity_code: 'volume', value_kind: 'cumulative', step: null, unit, name: null, values: [{ at: new Date(instants[0]!).toISOString(), value: e.value }] },
    });
  });
  return out;
}

/** `YYMMDDhhmmss`, as a number or a string, read as a wall-clock time in UTC milliseconds; null when it is not one. */
export function wallClockOf(stamp: unknown): number | null {
  const s = typeof stamp === 'number' ? String(Math.trunc(stamp)).padStart(12, '0') : typeof stamp === 'string' ? stamp : '';
  const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const [, yy, mo, dd, hh, mi, ss] = m.map(Number) as number[];
  const ms = Date.UTC(2000 + yy!, mo! - 1, dd!, hh!, mi!, ss!);
  const d = new Date(ms);
  // Refuses a date that does not exist (a 31st of June rolls over).
  if (d.getUTCMonth() !== mo! - 1 || d.getUTCDate() !== dd! || hh! > 23 || mi! > 59 || ss! > 59) return null;
  return ms;
}

/** The dongle gives a meter's identifier as the hex of its text; the text when it is printable, the value as given otherwise. */
export function decodeIdentifier(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(value)) return value;
  const text = value.match(/../g)!.map((h) => String.fromCharCode(parseInt(h, 16))).join('');
  return /^[\x20-\x7e]+$/.test(text) ? text.trim() : value;
}

/** The `sources` row this package ships (`source.json`): write it with `registerSource()`. */
export const homewizardSource: SourceRow = JSON.parse(readFileSync(new URL('../source.json', import.meta.url), 'utf8')) as SourceRow;
