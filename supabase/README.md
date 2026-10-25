# `supabase/` — the core in the database

Everything of the core that ends up in your Postgres lives here: the schema
`nexgen`, in plain SQL for Postgres with PostGIS, and the rows it starts with.
A module carries its own migrations in `modules/<code>/supabase/migrations/`
([`modules/`](../modules/README.md)).

| Folder | What it is | When it runs |
|---|---|---|
| [`migrations/`](migrations/) | The schema `nexgen`: one file per family of tables, functions and row level security, the schema version last | `npx nexgen-os init`, then `npx nexgen-os migrate` for what a release adds |
| [`seed/`](seed/) | The vocabularies of the core (`0001_core_vocabularies.sql`) and one seed per country, compiled from its pack (`<n>_pack_<cc>.sql`, written by `nexgen-os pack build`, never by hand) | After the core's migrations and the modules asked for; a pack's seed only when the pack is asked for (`--packs`) |
| `config.toml` | The Supabase CLI configuration, for a local project started with `supabase start` | Read by the Supabase CLI |

How `npx nexgen-os init` applies the folder: the core's migrations in the
order of their names, then the core's seed, then each module asked for
(`--modules`, every module by default) with its migrations in order, then
each pack asked for (`--packs`, none by default). Each file runs in its own
transaction and is recorded by its path in `nexgen.schema_migrations`, so a
second pass applies only what is missing and `npx nexgen-os doctor` names
what is pending. The installer is the project's own: the Supabase CLI does
not know the modules or the packs, which is why `config.toml` seeds the
vocabularies only. The published package carries a copy of this folder, the
modules' migrations and the packs' manifests, in the same layout
([`packages/cli`](../packages/cli/README.md)).

Two rules hold for the whole folder:

- **A released migration is never edited**: it has already run on databases
  nobody here controls. A change is a new migration
  ([releasing](../docs/releasing.md)).
- **A country is data.** What a country decides is a row of its pack,
  compiled into `seed/`; fix the pack and build again, never a function.

## The model in one screen

The core names six objects, in the order a page walks them — the
organisation, the project it works on, the participants taking part in it,
the meters they carry, the devices behind those meters, the series they
produce — and what describes them beyond their columns is attached to one
of them by kind and id: an attribute, an identifier, a document or a series
names its object as `('participant', id)`, `('device', id)`, the kind one of
the six words, and the hierarchy is the foreign keys
([0001](../docs/decisions/0001-the-hierarchy-is-the-foreign-keys.md)). The core is
thirty-six tables and one view; a calculation, a design variant, the use of a
building or a relation of a trade is the module's that needs it.
The participant carries the place, geolocated but not described: its
ground, its buildings, floors, rooms and roof faces are the `building`
module's ([`modules/building`](../modules/building/README.md)), and a device
is not placed. Each named object is a table with the columns every row
has; what a trade knows beyond them is an attribute with its period and its
source.

Why this hierarchy: it is the one the commercial platform this core comes
from has run for years, and it reads the way the trades speak
([0043](../docs/decisions/0043-the-participant-is-the-node.md)). A
**participant** is the envelope facing the grid: an actor of the project —
a household, a company, a tenant, a PV plant — with its address and its
point on the map, that carries the meter and groups the devices behind it;
seen from the grid, everything *behind the meter* is the participant's,
everything in front of it is the grid's, the market's or the community's.
It is the node every module links to: the description of its buildings,
the grid side of its meters, its bills, its share of a community, its
actions, its weather. A **meter** is that frontier, one per participant and
exceptionally several; a **device** belongs to a participant and has as
many series as it measures. Three rules settle every question about the
structure: keep it simple, one word per thing across schemas, folders and
documents, and stay close to the platform that proved it
([docs/doctrine.md](../docs/doctrine.md), the spirit).

| Table | Holds | Standard it follows |
|---|---|---|
| `organisations`, `organisation_members`, `contacts` | who owns the descriptions and who they deal with; an organisation is an object like the others | Ekwo companies and contacts |
| `capabilities`, `role_capabilities`, `project_shares`, `invitations`, `api_keys` | who reaches what: a role is a preset of capabilities, and every policy asks `has_capability()`; a member of the organisation, a person a project is shared with, and the account of a participant (`participants.user_id`) are the three ways in ([docs/access.md](../docs/access.md)) | Ekwo capabilities, invitations and keys |
| `projects`, `participants` | what a person works on (an energy community, a set of buildings, a study, a construction site, a district plan) with its country and lifecycle, and its actors as producer, consumer or prosumer, each carrying its place in one standard shape (address, WGS 84 point, precision, source, time zone), grouped when they answer together | schema.org `PostalAddress` |
| `meters` | the connection points of a participant to a network, under the identifier its operator knows, with their direction and the period that identifier names them | IEC CIM `UsagePoint`, GS1 GSRN |
| `devices`, `products` | what a participant has behind its meters, instruments included; the products it is an instance of | Brick equipment, Home Assistant devices |
| `series`, `series_values`, `forecast_values`, `series_rollups`; the view `series_latest` | one quantity of an object over time, by the device that measures or is set when there is one: measured, simulated, forecast, setpoint, command; its values with their quality code; its hourly and daily aggregates, refreshed by every write; its latest value, a view | OGC SensorThings datastream, Brick and Haystack points |
| `attributes`, `identifiers`, `documents` | what attaches to one of the six objects, named by its kind and its id: typed values with validity and source, identifiers, files | IFC property sets, bSDD |
| `modules`, `connectors` | the modules installed, an organisation's use of a source through a connector; a module keeps its figures in its own schema | — |
| `countries`, `regions`, `defaults` | what a country pack publishes: the country, its regions, the values it decides; `parameter_of()` resolves a parameter from the object up to the country along the foreign keys and a region's parents, with no global fallback | ISO 3166, ISO 4217 |
| `device_types`, `quantities`, `units`, `attribute_types`, `identifier_schemes`, `sources` | the vocabularies, as data, including the external APIs, datasets and published texts | Brick, IFC, QUDT |

Every act that writes several rows or carries a rule is one function named
after the gesture — `join_project`, `locate_participant`, `declare_meter`,
`assign_meter`, `install_device`, `series_ensure`, `store`…
— that refuses by name. The grid side of a connection
point (`grid`), the physical description of a participant's place
(`building`: its ground, buildings, spaces, surfaces), the energy sharing
of a community (`community`) and the billing bridge (`billing`) are
modules with their own schema, each starting from an object of the core
([0042](../docs/decisions/0042-a-module-starts-from-an-object-of-the-core.md)). Details, diagram and rules: [docs/model.md](../docs/model.md); the
rules and why: [docs/doctrine.md](../docs/doctrine.md).
