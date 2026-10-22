/**
 * Weather files in the model, and back.
 *
 * `@nexgen-os/weather-files` reads an EPW or a TMY3 file into hourly
 * series dated at their start, or instant, in UTC; this importer stores
 * them on an object through `store()`, one series per quantity, converted
 * from the file's units by the `units` vocabulary. The exporter reads an
 * object's weather series back through `resample()` as the calendar year
 * `writeEpw()` writes.
 */
import { WEATHER_QUANTITIES, type WeatherFile, type WeatherFileLocation, type WeatherFileWarning, type WeatherSeries, type WeatherYear } from '@nexgen-os/weather-files';
import type { Db } from '../db.js';
import { storeSeries } from '../connectors/interfaces.js';

const HOUR_MS = 3_600_000;

export interface WeatherTarget {
  organisationId: string;
  /** The object the weather is about, by its kind and its id: a weather point, a participant. */
  objectKind: string;
  objectId: string;
}

/**
 * Stores what a file holds on an object, one series per quantity, with the
 * source the caller names (the `sources` row of the dataset: `pvgis`, a
 * station network, a licensed model). A typical year is `simulated` and
 * named after its years (`typical year 2005-2020`); real years are
 * `measured` and unnamed, unless told otherwise. Importing the same file
 * again replaces the values.
 */
export async function importWeatherFile(
  db: Db,
  target: WeatherTarget,
  file: WeatherFile,
  options: { sourceCode: string; kind?: 'measured' | 'simulated'; name?: string | null },
): Promise<{ series: { quantity_code: string; seriesId: string; inserted: number }[]; warnings: WeatherFileWarning[] }> {
  const kind = options.kind ?? (file.typical ? 'simulated' : 'measured');
  const name = options.name !== undefined ? options.name : file.typical ? `typical year ${file.years[0]}-${file.years[file.years.length - 1]}` : null;
  const series = [];
  for (const s of file.series) {
    const stored = await storeSeries(db, { organisationId: target.organisationId, objectKind: target.objectKind, objectId: target.objectId, sourceCode: options.sourceCode, kind, name }, s);
    series.push({ quantity_code: s.quantity_code, ...stored });
  }
  return { series, warnings: file.warnings };
}

/**
 * The weather series of an object for one calendar year in the location's
 * standard time, read through `resample()`, for `writeEpw()`. The series
 * are those of the source, kind and name given; a quantity the object does
 * not have is left out, and written missing.
 */
export async function exportWeatherYear(
  db: Db,
  request: { objectId: string; sourceCode: string; kind: 'measured' | 'simulated'; name?: string | null; year: number; location: WeatherFileLocation; comment?: string },
): Promise<WeatherYear> {
  const found = await db.query<{ id: string; quantity_code: string; value_kind: WeatherSeries['value_kind'] }>(
    `select id, quantity_code, value_kind from series
      where object_id = $1 and source_code = $2 and kind = $3 and name is not distinct from $4
        and quantity_code = any($5)`,
    [request.objectId, request.sourceCode, request.kind, request.name ?? null, WEATHER_QUANTITIES],
  );
  const offsetMs = request.location.utc_offset_hours * HOUR_MS;
  const from = new Date(Date.UTC(request.year, 0, 1) - offsetMs).toISOString();
  const to = new Date(Date.UTC(request.year + 1, 0, 1) - offsetMs + HOUR_MS).toISOString();
  const series: WeatherSeries[] = [];
  for (const s of found.rows) {
    const values = await db.query<{ bucket: string | Date; value: number }>(`select bucket, value from resample($1, $2, $3, '1 hour')`, [s.id, from, to]);
    series.push({
      quantity_code: s.quantity_code,
      value_kind: s.value_kind,
      step: '1 hour',
      values: values.rows.map((v) => ({ at: new Date(v.bucket).toISOString(), value: v.value })),
    });
  }
  return { location: request.location, series, year: request.year, ...(request.comment !== undefined ? { comment: request.comment } : {}) };
}
