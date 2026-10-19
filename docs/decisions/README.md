# Decisions

Why Nexgen OS is shaped the way it is: one record per decision, each titled
as the rule it sets, so that a contributor can argue with the reason rather
than guess at it. The rules on one screen: [`docs/doctrine.md`](../doctrine.md).

**A record states a rule that holds.** It says why in a few lines, what the
rule forbids and what it replaced; it carries no plan, no road map and no
"later". What is planned lives in the [road map](../road-to-0.1.md), and a
record is written when its rule is decided, even where the code still has to
follow it (the road map lists where). A decision that changes is rewritten in
place and its record says what the rule now is; the history of the change is
in the git log and in [`CHANGELOG.md`](../../CHANGELOG.md). A withdrawn
record keeps its file and its number, with one line saying what superseded it.

A record has a **Status** line and five parts: **Context**, **Decision**,
**What it forbids**, **What it replaced** and **See also**, where the
decisions of Ekwo OS it inherits are named. New records take the next free
number; numbers and file names never change, so a file name may keep an older
title.

**A weakness that is still open is not written here.** A security issue goes
first through a private advisory, as [`SECURITY.md`](../../SECURITY.md)
describes; its record is written once the fix has shipped.

## Objects

- [0006](0006-named-objects.md) · The core names a few objects, and everything else is attached to them · accepted
- [0023](0023-an-organisation-is-an-object.md) · An organisation is an object · accepted
- [0019](0019-a-column-only-for-what-every-row-has.md) · A column only for what every row has and every query filters on · accepted
- [0022](0022-the-instrument-is-a-device-the-point-is-the-series.md) · The instrument is a device, the point is the series · accepted
- [0027](0027-a-product-is-a-catalogue-entry.md) · A product is a catalogue entry, and a device is an instance of it · accepted
- [0028](0028-two-objects-that-are-one-are-merged.md) · Two objects that are one are merged, and the absorbed one is retired · accepted
- [0002](0002-standards-as-vocabulary-mappings.md) · A standard enters as a mapping of a vocabulary row · accepted

## Places

- [0003](0003-geometry-wgs84-3d-utm.md) · Geometry is stored in WGS 84 in 3D, and measured in UTM · accepted
- [0025](0025-a-place-has-one-shape.md) · A place has one shape · accepted
- [0009](0009-addresses-and-geocoding.md) · What applies to a place follows its region, its municipality or its area · accepted
- [0026](0026-a-device-is-placed-on-a-surface-or-in-a-space.md) · A device is placed on a surface or in a space, and a space is one notion with a kind · accepted
- [0008](0008-3d-module.md) · A 3D model is a file a row points to, and it enriches a place without changing it · accepted

## Series

- [0029](0029-a-series-belongs-to-an-object.md) · A series belongs to an object, and a value is dated at the start of its interval · accepted
- [0030](0030-a-value-is-stored-in-the-unit-of-its-quantity.md) · A value is stored in the unit of its quantity · accepted
- [0031](0031-one-way-to-write-a-series-one-way-to-read-it.md) · One way to write a series, one way to read it, and an aggregate is derived · accepted
- [0007](0007-series-at-scale.md) · Series live in plain Postgres, on any host · accepted

## Computation

- [0018](0018-one-function-per-gesture.md) · One function per gesture · accepted
- [0004](0004-deterministic-runs.md) · A figure is a run, and a finished run never changes · accepted
- [0013](0013-external-engines.md) · An engine reads one request and answers one result · accepted
- [0024](0024-one-language-per-layer.md) · One language per layer · accepted
- [0016](0016-naming-third-party-methods.md) · A third party's name goes where its data, its computation or its file is · accepted

## Modules

- [0032](0032-a-module-has-its-own-schema.md) · A module has its own schema and writes the core through a function · accepted
- [0033](0033-a-module-code-outlives-its-names.md) · A module code outlives its names · accepted

## Packs

- [0020](0020-a-pack-holds-what-a-function-reads.md) · A pack holds what a function reads, and data cannot execute · accepted
- [0021](0021-one-cascade-of-defaults.md) · One cascade of defaults, and no global fallback · accepted
- [0034](0034-a-pack-upgrade-is-never-silent.md) · A pack upgrade is never silent, and a golden site is its contract · accepted

## Formats and external data

- [0035](0035-a-format-library-touches-no-database.md) · A format library is MIT, one package per format, and touches no database · accepted
- [0036](0036-a-file-is-imported-once.md) · A file is imported once, and a reader reports rather than corrects · accepted
- [0011](0011-external-data.md) · A source is a row, a connection names a secret, a connector is code · accepted

## Rights and refusals

- [0037](0037-the-schema-grants-its-own-rights.md) · The schema grants its own rights, and the surface is closed · accepted
- [0038](0038-everything-raises-by-name.md) · Everything raises, by name · accepted

## Agents and the public

- [0039](0039-an-agent-is-a-user-of-the-model.md) · An agent is a user of the model · accepted
- [0014](0014-integrations-dashboards-warehouses-streams.md) · Integrations come through three doors · accepted
- [0015](0015-publications.md) · Nothing is public until an owner publishes it, and a publication is kept as published · accepted

## Releases

- [0040](0040-a-release-has-a-tag-a-schema-version-and-a-floor.md) · A release has a tag, a schema version and a schema floor · accepted
- [0005](0005-open-questions.md) · The core is AGPL, the libraries MIT, and a sign-off is enough to contribute · accepted

## Records of single modules

- [0010](0010-ekwo-link.md) · The accounting bridge: one module reaches the accounting side · accepted
- [0012](0012-solar-module.md) · A yield says what it was computed from · accepted
- [0017](0017-tasks-as-data.md) · What has to be done is a template, the same in every country · accepted

## Superseded

- [0001](0001-one-entity-table-attached-values.md) · One entity table, with everything else attached to it · superseded by 0006
