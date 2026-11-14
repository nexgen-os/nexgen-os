/** What the reader is told: nothing it could guess. */
export interface DsmrOptions {
  /**
   * The IANA time zone of the meter's clock, from the caller's data (the
   * place of the meter). A meter writes its local time with a season letter
   * and no offset; a stamp read without a zone is refused by name
   * (`time_zone_required`).
   */
  timeZone?: string;
}

/** What an object of the telegram measures, by its OBIS code (IEC 62056-61). */
export type DsmrMeasure = 'energy' | 'power' | 'voltage' | 'current' | 'volume';

/**
 * How a value stands in time: `instant` the value at the reading (D = 7),
 * `cumulative` a register that only grows (D = 8, and the volume of a
 * device on the meter's bus), `average` the mean demand of the running
 * quarter hour (D = 4), `maximum` the highest quarter hour of the month
 * (D = 6), dated at its own stamp.
 */
export type DsmrKind = 'instant' | 'cumulative' | 'average' | 'maximum';

export interface DsmrValue {
  /** The OBIS code as the telegram writes it, `1-0:1.8.1`. */
  obis: string;
  measure: DsmrMeasure;
  kind: DsmrKind;
  /**
   * `offtake` what the connection takes from the grid (the standard's
   * "delivered to the client", C = 1, 21, 41, 61), `injection` what it puts
   * back ("delivered by the client", C = 2, 22, 42, 62); null for a voltage,
   * a current or a volume.
   */
  direction: 'offtake' | 'injection' | null;
  /** The phase of a per-phase value; null for the whole connection. */
  phase: 'L1' | 'L2' | 'L3' | null;
  /** The tariff register of a cumulative energy (E: 1, 2…); 0 for the total, null otherwise. */
  tariff: number | null;
  /** The channel on the meter's bus (B): 0 the electricity meter, 1 to 4 a gas, water or heat meter. */
  channel: number;
  /** In `unit`, as written. */
  value: number;
  /** As the telegram writes it: `kWh`, `kW`, `V`, `A`, `m3`; null when it writes none. */
  unit: string | null;
  /** The value's own stamp (a device of the bus, the month's maximum), ISO 8601 in UTC; null when it has none. */
  at: string | null;
  /** That stamp as the meter wrote it. */
  local: string | null;
}

/** One object of the telegram, as written: its code and the text of each of its groups. */
export interface DsmrLine {
  obis: string;
  values: string[];
}

export interface DsmrProblem {
  /**
   * `telegram_unreadable`, `crc_mismatch`, `no_values`,
   * `time_zone_required`, `date_unreadable`, `local_time_nonexistent`,
   * `local_time_ambiguous`, `season_mismatch`, `time_missing`, `value_unreadable`.
   */
  code: string;
  detail: string;
}

export interface DsmrReading {
  /** The identification line without its `/` (`ISK5\2M550E-1012`); null in a P1M5 message. */
  header: string | null;
  /** The meter's equipment identifier (`0-0:96.1.1`), decoded from its hexadecimal octets. */
  equipment_id: string | null;
  /** The version of the P1 interface the meter speaks (`1-3:0.2.8`, or `0-0:96.1.4` in Belgium). */
  version: string | null;
  /** The instant of the reading, the meter's clock (`0-0:1.0.0`), ISO 8601 in UTC. */
  at: string | null;
  /** That stamp as the meter wrote it (`YYMMDDhhmmssX`, X = S summer, W winter). */
  local: string | null;
  /** The tariff the meter counts in now (`0-0:96.14.0`), as written. */
  tariff: string | null;
  /** The checksum of the telegram: `valid`, `invalid` or `absent` (a meter before DSMR 4 writes none); null in a P1M5 message. */
  crc: 'valid' | 'invalid' | 'absent' | null;
  /** The measures read, in the order of the telegram. */
  values: DsmrValue[];
  /** Every object as written, those read into `values` included: nothing is lost. */
  lines: DsmrLine[];
  /** The fields of a P1M5 message that are not OBIS codes (`id`, `dongle_id`, `timestamp`…), as sent. */
  fields: Record<string, unknown>;
  /** By name, never corrected. */
  problems: DsmrProblem[];
}
