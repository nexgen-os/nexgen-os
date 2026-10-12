# 0006 — Named objects, in the words of the trades

**Decided 12/10/2026.** Supersedes [0001](0001-one-entity-table-attached-values.md).

## Context

The first core described everything as an `entity` of a class held in a
vocabulary, with values, relationships and representations attached. It was
clean and it was abstract: nobody could tell what the model contained
without reading the vocabulary, and every query started with "which class is
this". Projects that went that way (InterConnect, SAREF-only models) became
languages to learn before being useful.

Two products that work well took the other road. Nexgen and EMS name four
levels — organisation, project, participant, device — and the participant
carries the one rule everyone understands: one participant is what sits
behind one grid meter. Ekwo names its objects after the accounting trade —
company, invoice, document, contact, product — and specialises them in
modules (e-invoicing, fixed assets). Both stay small, and both stay concrete.

Two inventories of the production schemas (EMS, 52 business tables; Nexgen,
3,024 participants and 1,496 devices) also showed what the four levels lack:

- the meter is folded into the participant (its identifier in four places);
- places are not objects: footprints, roof faces and zones live in JSON;
- `devices` is one 79-column table where PV, battery, charger, wind and heat
  pump columns sit side by side, and building load profiles are reused as
  device types — the same categories serving participants and devices;
- legal identity is spread over four tables and the organisation holds none;
- membership and allocation keys have three generations and no validity;
- three series stores coexist and the time zone is hard-coded;
- the catalogue of external sources (about 42 APIs and datasets) lives in
  code.

## Decision

The core names its objects after what the trades call them, in the words
Nexgen already uses. Every object is a table with the columns that object
always has. Genericity lives in three places only: the **attributes** a
trade can add from a vocabulary, the **modules** that derive an object into
a specialised one, and the **packs** that hold what varies by country.

### The core

| Object | What it is | Standard |
|---|---|---|
| `organisations`, `organisation_members` | the tenant and who works in it; its legal identity is its Ekwo company | — |
| `contacts` | a person or a company the organisation deals with: an Ekwo contact, referenced | Ekwo `contacts` |
| `projects` | a working perimeter: an energy community, a portfolio, a study, a district plan; a country, a lifecycle | Nexgen `projects` |
| `sites` | a place with an address and a parcel: the unit a person owns, rents or operates, and the thing behind a meter | CityGML LandUse, cadastral parcel |
| `buildings` | footprint, elevation, height, storeys, use, lifecycle; the LoD 1 block derives from it | CityGML Building, IfcBuilding |
| `surfaces` | a roof face, a facade, a ground area, a canopy: what a device is mounted on, with azimuth and tilt | CityGML RoofSurface, Nexgen orientation segments |
| `meters` | a connection point: identifier and scheme, commodity, direction, grid operator, validity | IEC CIM UsagePoint |
| `participants` | a site's role in a project — producer, consumer, prosumer — behind its meters, with its contact, its group and its period | Nexgen `participants`, CIM Customer |
| `devices` | what every device has: type, site, building, surface, meter, catalogue product, rated power, status; derived per type by a module table with the same id | Nexgen `devices`, Brick Equipment |
| `device_directory` | the products: manufacturer, model, unit power, capacity, price | Nexgen `device_directory` |
| `sensors` | a measurable or controllable point of any object: quantity, kind (sensor, setpoint, command), address at the source | Brick Point, Home Assistant entity |
| `series`, `readings` | one quantity over time for one object, measured, simulated, forecast or asked; one store | OGC SensorThings |
| `attributes` | a typed value a trade attaches to any object, with validity and provenance | IFC property sets, bSDD |
| `external_ids` | the identifiers an object is known by elsewhere | IFC GlobalId, OSM, Overture GERS, GS1 |
| `links` | a typed, dated link that is not a column of either side: serves, shades, occupies, owns | Brick, IFC relationships |
| `lineage` | splits, merges, replacements | Overture GERS changelog |
| `documents` | files about an object: permit, datasheet, report, photo, video | Nexgen `documents` |
| `scenarios`, `runs`, `modules` | design variants, immutable computations, the module registry | [0004](0004-deterministic-runs.md) |
| `device_types`, `profiles`, `link_types`, `quantities`, `property_defs`, `tags`, `id_schemes`, `sources` | the vocabularies, as data | Brick, IFC, CityGML, QUDT, Haystack |

Two things are not objects of their own. **Legal identity and invoicing are
Ekwo's**: Nexgen OS computes what is owed — an allocation, a settlement line
per participant per period — and hands it to Ekwo OS, which issues the
invoice, its VAT, its e-invoicing, its payment and its accounting entry. An
organisation and a contact keep the Ekwo id they are known by: real foreign
keys when Ekwo shares the database, a reference and a display name when it
runs elsewhere. **Device types and profiles are two vocabularies**: a device
type says what a device is; a profile says what a building or a site is used
for. A production site is a site with the profile `plant` and a device of
type `solar`.

### The registry

What every object shares — an id, an organisation, a scenario, a kind — is
kept once in `objects`, maintained by the triggers of the named tables. It is
plumbing: attachments point to it, pages read `from buildings`. A module
registers the kinds it adds (`storey`, `space`) the same way.

### Sources and connectors

The external systems data comes from — an open-data API, a grid operator's
hub, a solar API, a register, a device protocol — are rows of `sources`:
base URL, documentation, type of authentication (the secret itself stays in
the installation's vault), countries covered, licence, attribution. An
identifier scheme, a series, a document or an attribute says which source it
comes from. A **connector** — an organisation's configured link to a source,
with its credentials reference, schedule, mappings to sensors and series and
collection log — is the `monitoring` module's (and the `grid` module's for
meter-data mandates), as Nexgen's `connectors`, `connector_configs` and
`connector_mappings` are today.

### Modules

Each module owns a Postgres schema, derives the core's objects into its own
tables with the same id, registers the kinds it adds, and writes results
back as runs. The first one, `architecture`, ships with the core. The list is
in [`modules/README.md`](../../modules/README.md).

### Packs

Grid operators, meter identifier schemes, community scheme types, tariff
components, protected zones and national sources are rows a pack ships,
never enums in the core.

## Consequences

- Twenty named tables and eight vocabularies in the core; queries read
  `from buildings`, never `from entities where class = 'building'`.
- A new kind of thing is a module table; a new property is a vocabulary row;
  a new API is a source row.
- 0001 is withdrawn. 0002 (standards as mappings), 0003 (WGS 84 3D) and 0004
  (deterministic runs) stand. The PostGIS helpers, row level security,
  vocabularies, series, scenarios and runs of the first core are kept.
- The vocabulary is Nexgen's wherever Nexgen has a word: `organisations`,
  `projects`, `participants`, `devices`, `device_directory`, `profiles`,
  `documents`, the statuses of projects and participants.
