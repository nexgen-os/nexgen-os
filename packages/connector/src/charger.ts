// What a connector of a charging station speaks: what it read of a charger
// over a window, handed to its caller. `recordCharger()` of the `charging`
// module writes it: each session once through `charging.record()`, each
// series on the charger with its source.

import type { CollectedSeries } from './weather.js';

/** A session in the shape `charging.record()` takes: its id at its source, when it started, and what the station gave. */
export interface ChargingSessionRecord {
  /** The session's id at its source: a second record of the same id changes nothing. */
  transaction_id: string;
  started_at: string;
  /** Absent while the car is connected. */
  ended_at?: string;
  energy_kwh: number | null;
  /** The token the station read, as given: it may name a person. */
  id_token?: string;
  metadata?: object;
}

/** What a connector read of one charger over a window: ready for `recordCharger()`. */
export interface ChargerReading {
  /** The `sources` code of the connector, kept on every series it brings. */
  source_code: string;
  /** The sessions, each with the reference its station is known by at the source (its serial), null when none. */
  sessions: { record: ChargingSessionRecord; source_ref: string | null }[];
  /** The series of the charger, `measured`. */
  series: CollectedSeries[];
}
