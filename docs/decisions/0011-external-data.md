# 0011 — External data: sources, connections, connectors

**Decided 13/10/2026.**

## Context

Most of what a page shows was not typed by anyone in the organisation: the
weather comes from a model, the meter readings from the grid operator's
hub, the prices and the carbon intensity from the transmission operator or a
market, the buildings and the companies around a site from registers and
maps, the roof from a solar API. The product this core comes from reads
some forty such sources, each through code of its own, and keeps what they
answered in columns and JSON that no longer say where it came from.

Three questions: where does external data live in the model, how does an
organisation's access to a source get described, and how does a connector
whose data or code cannot be open plug into an open core.

## Decision

### Three layers, one rule: data carries its source

1. **Sources** are vocabulary rows (`sources`): what exists out there, its
   licence, its attribution, how it authenticates, which countries it
   covers, how long what it answered may be kept and whether it may be
   passed on (`retention_days`, `redistributable`). Worldwide open sources
   ship with the core, national ones with their pack, the others with the
   module or the private package that uses them (`published_by`).
2. **Connections** are core rows (`connections`): this organisation reads
   that source, for what (`config`, as the connector documents it), with
   which credential by name (`secret_ref`, resolved in the installation's
   vault), and how the last collection went. A connection holds no secret
   and no data.
3. **Connectors** are code outside the database, under `connectors/`: one
   interface per kind of answer — `WeatherProvider`, `MeterDataProvider`,
   `PlacesProvider`, and the `Geocoder` of `formats/geocoding` — and one
   implementation per source. A connector answers in the core's terms:
   quantities, value kinds, steps, identifier schemes. What it brings back
   is written on ordinary objects by the application, a job or an edge
   function, never by the database itself.

Whatever a connector writes says where it came from: `source_code` on a
series, an attribute, a document, a site's position; the scheme of an
external identifier. Licence, attribution and retention follow the data
because the data names its source.

### Where each kind of data lands

| Data | Lands on | Kind | Note |
|---|---|---|---|
| weather forecast (a model, an API) | `series` on the site, `forecast` | `forecast_values`, one row per instant **and issue time** | pages read the latest issue; an accuracy study reads what was known at a given time (`resample(..., p_issued_before)`) |
| weather observed, reanalysis | `series` on the site | `series_values`, `measured` or `simulated` | a reanalysis is a model's view of the past: `simulated`, with its source |
| meter readings (grid operator's hub, data hub) | `series` on the meter, `measured` | `series_values`, quality from the hub's codes | the mandate that allows the reading is the `grid` module's |
| prices, imbalance, carbon intensity (transmission operator, market) | `series` on a zone the `grid` module declares as an object (bidding zone, balancing area) | `series_values` or `forecast_values` | a site is linked to its zone; one series serves every site in it |
| grid topology (substation, feeder, cabin) | objects of the `grid` module, `links` to the meters they serve | — | with the operator's identifiers in `external_ids` |
| registers, cadastre, building datasets, company data | `sites`, `buildings`, `external_ids`, `attributes`, `documents` | — | each with `source_code`; a licensed answer expires with `retention_days` |
| roof faces from a survey or a solar API | `surfaces` with their source | — | a solar API's layers are a 30-day cache, never redistributed |

An external series needs an object to hang on. When no site owns it — a
weather grid point shared by many sites, a bidding zone, a substation — the
module that knows it declares the object, and sites are linked to it.

### Open connectors, private connectors

The interfaces are the contract. A connector is open when its data is: the
weather of Open-Meteo, the places of OpenStreetMap, a public register. A
connector whose data or terms are not open — a commercial map or solar
provider, a licensed register, a company's own data service for cartography
and company data — is a **private package that implements the same
interface**, ships its `sources` rows with licence and retention, and is
listed in the installation's configuration. The core, the pages and the
open connectors never import it; a page reads a site's position, a series
or an attribute the same way whichever connector wrote it.

### What the core does not do

The database calls no API: no HTTP from a function, no job inside Postgres.
Collection is a job of the application or the hosted edition, scheduled by
the `monitoring` module when it is installed, and it writes through
`storeSeries()` and the ordinary tables.

## Consequences

- `sources` gains `retention_days` and `redistributable`; `connections` is
  a core table; `forecast_values` holds forecast issues and `resample()`
  takes `p_issued_before`; each kind of series has its one store, checked
  on write. The "revised forecasts" question of 0005 is settled.
- `connectors/` holds the interfaces, `storeSeries()` and the Open-Meteo
  connector; the Home Assistant library and the geocoders are the same
  pattern for their own kinds of source.
- The product's forty source readers become connectors of these interfaces:
  the open ones here, the others in a private package that the hosted
  edition installs.
