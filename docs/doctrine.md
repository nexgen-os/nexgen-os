# The doctrine of Nexgen OS

The rules that hold, one line each, grouped by theme; each links to the
record that says why and what it forbids. The full index,
with the statuses, is in [`decisions/`](decisions/README.md).

## The spirit

Eight sentences every record answers to; Ekwo OS, the invoicing and
bookkeeping core built on the same playbook, is the measure.

- **Simple.** A repository that reads in one screen — the core, the modules,
  the packs, the formats, the connectors — and nothing between
  them ([README](../README.md), [0024](decisions/0024-one-language-per-layer.md)).
- **Concrete.** The core names things of the trades — an organisation, a
  project, a participant, a meter, a device, a series — never an
  abstraction that stands for several
  ([0006](decisions/0006-the-core-names-six-objects.md), [0022](decisions/0022-the-instrument-is-a-device-the-point-is-the-series.md)).
- **Factorised.** Two objects that are one are merged; one shape of a place;
  one way to write a series; one function per gesture; nothing implemented
  twice ([0028](decisions/0028-two-objects-that-are-one-are-merged.md),
  [0025](decisions/0025-a-place-has-one-shape.md),
  [0031](decisions/0031-one-way-to-write-a-series-one-way-to-read-it.md),
  [0018](decisions/0018-one-function-per-gesture.md)).
- **Few words.** One word per thing, across schemas, folders and documents:
  the meter is `meters` in the core and `grid.meters` in the grid module,
  the ground of a participant is `building.sites`, code that reaches outside is a connector whatever language it
  runs, in the folder and in the table; a figure is named after what it is, an
  estimate or a settlement; no synonym, no second name for a thing the
  core already names
  ([0042](decisions/0042-a-module-starts-from-an-object-of-the-core.md),
  [0011](decisions/0011-external-data.md),
  [0013](decisions/0013-a-program-connector-reads-one-request.md)).
- **Proven.** The shape follows the platform this core was taken from, which
  earned it in the field — organisation, project, participant, meter, device —
  and when two structures compete, the one the platform runs wins
  ([services.md](services.md), [0006](decisions/0006-the-core-names-six-objects.md)).
- **Few tables, complete on the functions.** The core is twenty-seven
  tables and one view: the six objects and what they need, nothing a single
  trade needs. A column only for what every
  row has, everything else attached to one of the six; the actions of the trades are
  functions of the schema, many of them, each one gesture
  ([0019](decisions/0019-a-column-only-for-what-every-row-has.md),
  [0006](decisions/0006-the-core-names-six-objects.md),
  [0018](decisions/0018-one-function-per-gesture.md)).
- **A module is one thing.** It starts from an object of the core and
  enriches it, with its own physics and its own schema, named after what it
  holds and never after a drawer
  ([0042](decisions/0042-a-module-starts-from-an-object-of-the-core.md),
  [0041](decisions/0041-a-module-names-one-thing.md),
  [0032](decisions/0032-a-module-has-its-own-schema.md)).
- **A country is data, a figure names its inputs and never changes, a file
  is a library.** Packs compiled into SQL, estimates and settlements that
  never change, format libraries that touch no
  database ([0020](decisions/0020-a-pack-holds-what-a-function-reads.md),
  [0004](decisions/0004-a-figure-names-its-inputs-and-never-changes.md),
  [0035](decisions/0035-a-format-library-touches-no-database.md)).

## Objects

- [0006](decisions/0006-the-core-names-six-objects.md) The core names six objects (the organisation, the project, the participant, the meter, the device, the series), and everything else is attached to them
- [0043](decisions/0043-the-participant-is-the-node.md) The participant is the node: it carries the place, the meters and the devices, and every module starts from it
- [0001](decisions/0001-the-hierarchy-is-the-foreign-keys.md) The hierarchy is the foreign keys, and an attachment names its object's kind, one of the six, and its id
- [0023](decisions/0023-an-organisation-is-an-object.md) An organisation is an object
- [0019](decisions/0019-a-column-only-for-what-every-row-has.md) A column only for what every row has and every query filters on; the rest is an attribute with its period and its source
- [0022](decisions/0022-the-instrument-is-a-device-the-point-is-the-series.md) The instrument is a device, the point is the series
- [0027](decisions/0027-a-product-is-a-catalogue-entry.md) A product is a catalogue entry, and a device is an instance of it
- [0028](decisions/0028-two-objects-that-are-one-are-merged.md) Two objects that are one are merged, and the absorbed one is retired
- [0002](decisions/0002-standards-as-vocabulary-mappings.md) A standard enters as a mapping of a vocabulary row

## Places

The place of the core is the participant's, geolocated but not described;
its ground and what is built on it are the `building` module's, and a
device belongs to its participant.

- [0003](decisions/0003-geometry-wgs84-3d-utm.md) Geometry is stored in WGS 84 in 3D, and measured in UTM
- [0025](decisions/0025-a-place-has-one-shape.md) A place has one shape: address, point, precision, source
- [0009](decisions/0009-what-applies-follows-the-region.md) What applies to a place follows its region, its municipality or its area
- [0008](decisions/0008-the-building-module-describes-what-is-built.md) The `building` module describes what is built; a 3D model is a file a row points to, and it enriches a place without changing it
- [0026](decisions/0026-a-device-belongs-to-its-participant.md) A device belongs to its participant; the `building` module describes the place, and a space is one notion with a kind

## Series

- [0029](decisions/0029-a-series-belongs-to-an-object.md) A series belongs to an object, and a value is dated at the start of its interval
- [0030](decisions/0030-a-value-is-stored-in-the-unit-of-its-quantity.md) A value is stored in the unit of its quantity
- [0031](decisions/0031-one-way-to-write-a-series-one-way-to-read-it.md) One way to write a series, one way to read it, and an aggregate is derived
- [0007](decisions/0007-series-at-scale.md) Series live in plain Postgres, on any host

## Computation

- [0018](decisions/0018-one-function-per-gesture.md) One function per gesture
- [0004](decisions/0004-a-figure-names-its-inputs-and-never-changes.md) A figure names its inputs and never changes: a row of the module that computes it, named after what it is (an estimate, a settlement), written by the one gesture the core keeps
- [0013](decisions/0013-a-program-connector-reads-one-request.md) A program connector reads one request and answers one result; "engine" names what computed a figure
- [0024](decisions/0024-one-language-per-layer.md) One language per layer: SQL for the model, TypeScript for the tools, any language as a connector
- [0016](decisions/0016-naming-third-party-methods.md) A third party's name goes where its data, its computation or its file is

## Modules

- [0032](decisions/0032-a-module-has-its-own-schema.md) A module has its own schema and writes the core through a function
- [0042](decisions/0042-a-module-starts-from-an-object-of-the-core.md) A module starts from an object of the core and enriches it: a derived table, a secondary table or vocabulary rows
- [0033](decisions/0033-a-module-code-outlives-its-names.md) A module code outlives its names
- [0041](decisions/0041-a-module-names-one-thing.md) A module names one thing with its own physics, and there is no catch-all
- Records of single modules: [0010](decisions/0010-the-participant-is-billed-ekwo-os-keeps-the-invoice.md) the participant is billed, Ekwo OS keeps the invoice, [0012](decisions/0012-a-yield-says-what-it-was-computed-from.md) the yield, [0017](decisions/0017-tasks-as-data.md) the tasks

## Packs

- [0020](decisions/0020-a-pack-holds-what-a-function-reads.md) A pack holds what a function reads, and data cannot execute
- [0021](decisions/0021-one-cascade-of-defaults.md) One cascade of defaults, climbing a region to its parent, and no global fallback
- [0034](decisions/0034-a-pack-upgrade-is-never-silent.md) A pack upgrade is never silent, and a golden case is its contract

## Formats and external data

- [0035](decisions/0035-a-format-library-touches-no-database.md) A format library is MIT, one package per format, and touches no database
- [0036](decisions/0036-a-file-is-imported-once.md) A file is imported once, and a reader reports rather than corrects
- [0011](decisions/0011-external-data.md) A source is a row, a connector is code, and an organisation's use of it is a `connectors` row naming its secret

## Rights and refusals

- [0037](decisions/0037-the-schema-grants-its-own-rights.md) The schema grants its own rights, and the surface is closed
- [0038](decisions/0038-everything-raises-by-name.md) Everything raises, by name

## Agents and the public

- [0039](decisions/0039-an-agent-is-a-user-of-the-model.md) An agent is a user of the model
- [0014](decisions/0014-integrations-dashboards-warehouses-streams.md) Integrations come through three doors: SQL, files, stream
- [0015](decisions/0015-publications.md) Nothing is public until an owner publishes it, and a publication is kept as published

## Releases

- [0040](decisions/0040-a-release-has-a-tag-a-schema-version-and-a-floor.md) A release has a tag, a schema version and a schema floor
- [0005](decisions/0005-agpl-core-mit-libraries-sign-off.md) The core is AGPL, the libraries MIT, and a sign-off is enough to contribute

## Inherited

These decisions of Ekwo OS, the invoicing and bookkeeping core built on the same playbook,
apply as they are written there: 0002 *The surface is closed, not merely
empty* · 0003 *The schema grants its own rights* · 0005 *A guard answers
true or false, and reads as the schema* · 0007 *An invitation names an
address, not a user id* · 0013 *Locks live in the database, and everything
raises* · 0025 *A country is a pack of data, compiled into SQL* · 0028 *A
pack upgrade is never silent* · 0034 *A label is data, and a declared
language is a promise* · 0040 *A portfolio is what the caller may read* ·
0042 *A document is shared by a link that is the whole secret* · 0043 *A
company leaves with its books* · 0052 *The installer needs only Node and the
customer's project* · 0053 *The MCP server acts as the user* · 0054 *The
command line answers one document and an exit code* · 0055 *The command line
acts as a signed-in person* · 0058 *`doctor` compares against a generated
inventory* · 0059 *A release has a tag, a schema version and a schema floor*
· 0060 *Under load, the plan is the assertion, not the clock* · 0062 *A
machine key reaches the API, and is on its own company* · 0063 *A module code
outlives its names* · 0064 *A key writes as the person who issued it* · 0065
*A shared instance keeps its tenants apart*. Read "organisation" for
"company" and "installation" for "customer's project".
