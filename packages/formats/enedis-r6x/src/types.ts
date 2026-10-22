/** What the reader is told: nothing it could guess. */
export interface R6xOptions {
  /**
   * The IANA time zone of the stamps without an offset: the legal time of
   * the operator, from the caller's data. A stamp without an offset and no
   * zone is refused by name (`time_zone_required`).
   */
  timeZone?: string;
  /**
   * The nature letter of a point (`n`) mapped to a quality code, as the
   * caller's data says; the key `missing` gives the code of a step the
   * file does not carry, `none` the code of a point without a letter. A
   * letter the table does not hold is reported (`quality_unknown`).
   */
  qualityCodes: Record<string, number>;
}

export interface R6xPoint {
  /** The start of the step (load curve) or the instant of the reading (index), ISO 8601 in UTC. */
  start: string;
  /** The stamp as the file wrote it; null for a step the file does not carry. */
  local: string | null;
  /** In the unit of its quantity (`unit`); NaN when missing. */
  value: number;
  /** The nature letter (`n`): B raw, R real, E estimated, C corrected, D imported, H/P reconstructed at a clock change, S/T/F/G outage. */
  nature: string | null;
  /** The code the caller's table maps the letter to; null when the table has none. */
  quality: number | null;
  /** The correction type (`tc`), the likelihood index (`iv`) and the additional state (`ec`), as the file writes them. */
  correction: string | null;
  likelihood: string | null;
  state: string | null;
}

export interface R6xSeries {
  /** The metering point (`idPrm`). */
  prm: string;
  /** `BRUT` or `BEST` (`etapeMetier`). */
  stage: string | null;
  /** `CONS` (taken from the grid) or `PROD` (injected into it) (`grandeurMetier`). */
  business: string;
  /** `PA` active power, `PRI` / `PRC` reactive power inductive / capacitive, `E` voltage, `EA` active energy (`grandeurPhysique`). */
  physical: string;
  /** As the file writes it: `W`, `VAr`, `V`, `Wh`. */
  unit: string | null;
  kind: 'load_curve' | 'index';
  /** The step of a load curve, an ISO 8601 duration (`PT5M`, `PT1H`); null for an index or a curve of several steps. */
  step: string | null;
  /** The calendar, time class and dial of an index (`idCalendrier`, `idClasseTemporelle`, `codeCadran`). */
  calendar: string | null;
  time_class: string | null;
  dial: string | null;
  /** In time order; a load curve has one point per step of its period, missing ones included. */
  points: R6xPoint[];
}

export interface R6xProblem {
  /** `file_unreadable`, `no_measures`, `time_zone_required`, `local_time_nonexistent`, `date_unreadable`, `value_unreadable`, `quality_unknown`, `step_irregular`. */
  code: string;
  detail: string;
}

export interface R6xFile {
  /** The header of the file as it is (`header`). */
  header: Record<string, unknown>;
  series: R6xSeries[];
  problems: R6xProblem[];
}
