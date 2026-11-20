# `weather` — which weather a place reads

Status: shipped, decision [0012](../../docs/decisions/0012-a-yield-says-what-it-was-computed-from.md)
("Weather: a module of its own, chosen per place").
Schema: `weather`.

Weather belongs to a place, not to a device: two PV systems of one participant
share it, a heat pump of the same participant reads the same temperature. So the
choice of a source and the point it is read at sit at the participant, and every
other module (`solar`, `heating`, `consumption`, `battery`) reads them here.

## What it adds to the core

| Table | Holds |
|---|---|
| `weather.sources` | which `sources` are weather sources: their purposes (`irradiance`, `temperature`, `wind`, `typical_year`, `history`, `forecast`), resolution in metres, the grid in degrees that identifies a cell (`grid_deg`, null for stations), a priority. Coverage, licence and retention stay on the source. Seeded for `pvgis` (0.05°) and `open_meteo` (0.01°). |
| `weather.rules` | what a pack or an installation decides: for a country, or some of its regions (ISO 3166-2), the source to read for a purpose. The core seeds none. |
| `weather.points` | the grid cell or the station a participant reads, with its source, position, resolution and time zone. One point per cell of a source in an organisation; its weather series are stored once, as series of the organisation named by the point (`name` the point's, `external_ref` its id, `source_code` its source). |
| `weather.participants` | which point each participant reads, one row per participant and point. |

It publishes the attribute type `weather_source` (a participant or a project pins a source).

## Functions

- `weather.source_for(participant, purpose)` — the source a participant reads for a
  purpose, in this order: the participant's attribute `weather_source` (when that
  source serves the purpose); an active connector of the organisation to a
  source for the purpose (`config.purpose`, when set, restricts it); the
  rule of the participant's region, then of its country; the preferred source
  whose source covers the participant's country and region. Named error
  `weather_source_unknown` when none.
- `weather.point_for(participant, source)` — the organisation's point in the
  source's cell of the participant's position (the centroid of its geometry, rounded
  with `grid_deg`), created when missing, and records that the participant
  reads it (`weather.participants`). A new point takes the participant's time
  zone; a point without one takes the first one a participant brings, and
  keeps it.
  Named error `participant_without_position` when the participant has no geometry.
- `weather.time_zone_of(series)` — the time zone a series is cut in by day
  and by month: its participant's, else, for a series of a point, the
  point's; null when there is none. No participant owns the series of a
  point, so `resample()` refuses its days as `time_zone_required` unless it
  is given one:
  `resample(s, from, to, '1 day', weather.time_zone_of(s))`. A time zone
  Postgres does not know is refused as `time_zone_unknown`.
- `weather.cell_of(position, grid_deg)` — the cell a position falls in.
- `weather.degree_days(series, from, to, base, kind)` — the degree-days of
  each local day of a temperature series, a point's or a participant's own,
  by the mean daily temperature method: `heating` (the default),
  `max(base − mean, 0)`; `cooling`, `max(mean − base, 0)`, in kelvin days,
  with the mean temperature of the day and its samples as `resample()`
  gives them. The base is the caller's — a pack, a study, the standard it
  cites — and the module holds none. Days are cut in the time zone of
  `time_zone_of()`; a day without values has no degree-days. Refuses
  `base_required`, `degree_day_kind_unknown`, `series_not_found` (a series
  the caller cannot see too), `temperature_required` and
  `time_zone_required`:
  `select sum(degree_days) from weather.degree_days(s, '2025-10-01', '2026-05-01', 15)`.

## What stays out

The database calls no weather API: a connector (`connectors/`, decision
[0011](../../docs/decisions/0011-external-data.md)) reads the source and
writes the series on the point. A project's pinned source is read by the estimate
that studies the project; `source_for` reads the participant, which may take part
in several projects.
