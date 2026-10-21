# `weather` — which weather a place reads

Status: shipped, decision [0012](../../docs/decisions/0012-solar-module.md)
("Weather: a module of its own, chosen per place").
Schema: `weather`.

Weather belongs to a place, not to a device: two PV systems on one site
share it, a heat pump on the same site reads the same temperature. So the
choice of a model and the point it is read at sit at the site, and every
other module (`solar`, `heating`, `consumption`, `storage`) reads them here.

## What it adds to the core

| Table | Holds |
|---|---|
| `weather.models` | which `sources` are weather models: their purposes (`irradiance`, `temperature`, `wind`, `typical_year`, `history`, `forecast`), resolution in metres, the grid in degrees that identifies a cell (`grid_deg`, null for stations), a priority. Coverage, licence and retention stay on the source. Seeded for `pvgis` (0.05°) and `open_meteo` (0.01°). |
| `weather.rules` | what a pack or an installation decides: for a country, or some of its regions (ISO 3166-2), the model to read for a purpose. The core seeds none. |
| `weather.points` | an object (`weather_point`): the grid cell or the station a site reads, with its model, position and resolution. One point per cell of a model in an organisation; weather series hang on it once. |

It publishes the link type `weather_from` (a site reads its weather from a
point) and the property `weather_source` (a site or a project pins a model).

## Functions

- `weather.source_for(site, purpose)` — the model a site reads for a
  purpose, in this order: the site's attribute `weather_source` (when that
  model serves the purpose); an active connector of the organisation to a
  model for the purpose (`config.purpose`, when set, restricts it); the
  rule of the site's region, then of its country; the preferred model
  whose source covers the site's country and region. Named error
  `weather_source_unknown` when none.
- `weather.point_for(site, model)` — the organisation's point in the
  model's cell of the site's position (the centroid of its geometry, rounded
  with `grid_deg`), created when missing, with the `weather_from` link.
  Named error `site_without_position` when the site has no geometry.
- `weather.cell_of(position, grid_deg)` — the cell a position falls in.

## What stays out

The database calls no weather API: a connector (`connectors/`, decision
[0011](../../docs/decisions/0011-external-data.md)) reads the model and
writes the series on the point. A project's pinned model is read by the run
that studies the project; `source_for` reads the site, which may take part
in several projects.
