# Decisions

Why Nexgen OS is shaped the way it is: one record per decision, each titled
as the rule it sets, so that a contributor can argue with the reason rather
than guess at it. The rules on one screen: [`docs/doctrine.md`](../doctrine.md).

**A record states a rule that holds.** It says why in a few lines and what
the rule forbids; it carries no plan, no road map and no "later". What is
planned lives in the [road map](../road-to-1.0.md), and a record is written
when its rule is decided, even where the code still has to follow it (the
road map lists where). A decision that changes is rewritten in place and
its record says what the rule is; the history of the change is in the git
log and in [`CHANGELOG.md`](../../CHANGELOG.md). A withdrawn record keeps
its file and its number, with one line saying what superseded it.

A record has a **Status** line and four parts: **Context**, **Decision**,
**What it forbids** and **See also**, where the decisions of Ekwo OS it
inherits are named. New records take the next free number; numbers and
file names never change.

**A weakness that is still open is not written here.** A security issue goes
first through a private advisory, as [`SECURITY.md`](../../SECURITY.md)
describes; its record is written once the fix has shipped.

## Objects

- [0006](0006-the-core-names-six-objects.md) · The core names six objects, and everything else is attached to them · accepted
- [0043](0043-the-participant-is-the-node.md) · The participant is the node: it carries the place, the meters and the devices, and every module starts from it · accepted
- [0001](0001-the-hierarchy-is-the-foreign-keys.md) · The hierarchy is the foreign keys, and an attachment names its object's kind · accepted
- [0023](0023-an-organisation-is-an-object.md) · An organisation is an object · accepted
- [0019](0019-a-column-only-for-what-every-row-has.md) · A column only for what every row has and every query filters on · accepted
- [0022](0022-the-instrument-is-a-device-the-point-is-the-series.md) · The instrument is a device, the point is the series · accepted
- [0027](0027-a-product-is-a-catalogue-entry.md) · A product is a catalogue entry, and a device is an instance of it · accepted
- [0028](0028-two-objects-that-are-one-are-merged.md) · Two objects that are one are merged, and the absorbed one is retired · accepted
- [0002](0002-standards-as-vocabulary-mappings.md) · A standard enters as a mapping of a vocabulary row · accepted
- [0048](0048-a-value-says-what-kind-of-value-it-is.md) · A value says what kind of value it is: published, measured, estimated or default, in the words of the series quality · accepted

## Places

- [0003](0003-geometry-wgs84-3d-utm.md) · Geometry is stored in WGS 84 in 3D, and measured in UTM · accepted
- [0025](0025-a-place-has-one-shape.md) · A place has one shape · accepted
- [0009](0009-what-applies-follows-the-region.md) · What applies to a place follows its region, its municipality or its area · accepted
- [0026](0026-a-device-belongs-to-its-participant.md) · A device belongs to its participant; the `building` module describes the place, and a space is one notion with a kind · accepted
- [0008](0008-the-building-module-describes-what-is-built.md) · The `building` module describes what is built; a 3D model is a file a row points to, and it enriches a place without changing it · accepted

## Series

- [0029](0029-a-series-belongs-to-an-object.md) · A series belongs to an object, and a value is dated at the start of its interval · accepted
- [0030](0030-a-value-is-stored-in-the-unit-of-its-quantity.md) · A value is stored in the unit of its quantity · accepted
- [0031](0031-one-way-to-write-a-series-one-way-to-read-it.md) · One way to write a series, one way to read it, and an aggregate is derived · accepted
- [0007](0007-series-at-scale.md) · Series live in plain Postgres, on any host · accepted

## Computation

- [0018](0018-one-function-per-gesture.md) · One function per gesture · accepted
- [0004](0004-a-figure-says-where-it-comes-from.md) · A figure says where it comes from: a row of the module that computes it, with its provenance and its inputs · accepted
- [0013](0013-a-program-connector-reads-one-request.md) · A program connector reads one request and answers one result · accepted
- [0024](0024-one-language-per-layer.md) · One language per layer · accepted
- [0016](0016-naming-third-party-methods.md) · A third party's name goes where its data, its computation or its file is · accepted

## Modules

- [0032](0032-a-module-has-its-own-schema.md) · A module has its own schema and writes the core through a function · accepted
- [0042](0042-a-module-starts-from-an-object-of-the-core.md) · A module starts from an object of the core and enriches it · accepted
- [0041](0041-a-module-names-one-thing.md) · A module names one thing with its own physics, and there is no catch-all · accepted
- [0033](0033-a-module-code-outlives-its-names.md) · A module code outlives its names · accepted
- [0054](0054-a-module-that-cannot-install-changes-its-code.md) · A module that cannot install changes its code, once, before 1.0 · accepted

## Packs

- [0020](0020-a-pack-holds-what-a-function-reads.md) · A pack holds what a function reads, and data cannot execute · accepted
- [0021](0021-one-cascade-of-defaults.md) · One cascade of defaults, climbing a region to its parent, and no global fallback · accepted, amended by 0053
- [0053](0053-a-technology-figure-holds-everywhere-below-every-place.md) · A technology figure holds everywhere, below every place · accepted
- [0044](0044-a-condition-has-one-shape.md) · A condition has one shape, checked and matched by one function · accepted
- [0034](0034-a-pack-upgrade-is-never-silent.md) · A pack upgrade is never silent, and a golden case is its contract · accepted, implemented

## Formats and external data

- [0035](0035-a-format-library-touches-no-database.md) · A format library is MIT, one package per format, and touches no database · accepted
- [0036](0036-a-file-is-imported-once.md) · A file is imported once, and a reader reports rather than corrects · accepted
- [0050](0050-an-energy-bill-is-read-once-a-generic-invoice-then-its-energy.md) · An energy bill is read once: a generic invoice, then its energy · accepted
- [0011](0011-external-data.md) · A source is a row, a connector is code, and an organisation's use of it is a `connectors` row naming its secret · accepted

## Rights and refusals

- [0037](0037-the-schema-grants-its-own-rights.md) · The schema grants its own rights, and the surface is closed · accepted
- [0038](0038-everything-raises-by-name.md) · Everything raises, by name · accepted

## Agents and the public

- [0039](0039-an-agent-is-a-user-of-the-model.md) · An agent is a user of the model · accepted
- [0046](0046-a-key-acts-as-its-issuer-an-agent-reaches-the-database-as-the-person.md) · A key acts as its issuer, and an agent reaches the database as the person · accepted
- [0051](0051-roles-resolve-into-capabilities.md) · Roles resolve into capabilities; a project is shared through `project_shares` · accepted
- [0052](0052-the-end-customer-is-a-participant.md) · The end customer is a participant, with one account · accepted
- [0014](0014-integrations-dashboards-warehouses-streams.md) · Integrations come through three doors · accepted
- [0015](0015-publications.md) · Nothing is public until an owner publishes it, and a publication is kept as published · accepted

## Releases

- [0040](0040-a-release-has-a-tag-a-schema-version-and-a-floor.md) · A release has a tag, a schema version and a schema floor · accepted
- [0005](0005-agpl-core-mit-libraries-sign-off.md) · The core is AGPL, the libraries MIT, and a sign-off is enough to contribute · accepted

## Records of single modules

- [0010](0010-the-participant-is-billed-ekwo-os-keeps-the-invoice.md) · The participant is billed, Ekwo OS keeps the invoice: one thin bridge module · accepted
- [0012](0012-a-yield-says-what-it-was-computed-from.md) · A yield says what it was computed from · accepted
- [0017](0017-an-action-is-something-to-do.md) · An action is something to do on an object of the core, now or later: a step, a recommendation or a command, in one lifecycle; what a project needs is a template, the same in every country · accepted
- [0045](0045-to-size-is-one-gesture.md) · To size is one gesture, `size()`, with a named criterion · accepted
- [0047](0047-a-charging-profile-is-a-command.md) · A charging profile is a command of the `actions` module on the charger, its effect a setpoint series · accepted
- [0049](0049-the-market-follows-the-place-a-scheme-is-the-countrys-its-contract-the-devices.md) · The market follows the place; a support scheme is the country's, its contract the device's · accepted
