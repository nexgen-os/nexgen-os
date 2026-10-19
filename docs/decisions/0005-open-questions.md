# 0005 — The core is AGPL, the libraries MIT, and a sign-off is enough to contribute

> Status: accepted · 12/10/2026, rewritten 19/10/2026

## Context

Nexgen OS is a description of places in a database its owner keeps, and a
set of libraries that read the files and the services of the trades. Two
promises pull in different directions: whoever runs the core for others
must give back what they change, and a format library or a connector must
be usable by any product, open or not, without conditions. Contributions
also have to be accepted in a way that never lets anyone take the core away
from its licence: relicensing a community's work is what split Odoo's
community in 2015.

## Decision

**The core and the modules are AGPL-3.0.** The schema, its functions, the
modules, the installer and the core package: whoever runs a modified copy
as a service offers its source to the people who use it.

**The format libraries, the connectors and the engines are MIT**, each
package with its own licence file, so that they can be taken into any
product. An engine wrapping a third party's tool keeps that tool's licence
for the tool itself.

**A sign-off is enough to contribute.** Every commit carries
`Signed-off-by:` under the Developer Certificate of Origin 1.1
(`git commit -s`): the contributor certifies that they wrote the change or
have the right to submit it under the project's licences. The repository's
check refuses a commit without it.

**There is no contributor licence agreement**, and nothing in the sign-off
lets anyone, the maintainers included, relicense the core: it is AGPL-3.0,
and the libraries are MIT, for good.

**An operational paid line sits beside the open core, not inside it.**
Hosting, support, studies and the commercial platform built on the
foundation are services around it; no part of the open model is held back
for them ([`docs/nexgen-os-and-nexgen.md`](../nexgen-os-and-nexgen.md)).

## What it forbids

- A contributor licence agreement, or any clause that would let the core
  change licence.
- A commit without its sign-off.
- A feature of the open model reserved to the paid line.

## What it replaced

A list of questions to settle before 0.1. Its answers are records of their
own: the contributor terms here, products as catalogue entries in
[0027](0027-a-product-is-a-catalogue-entry.md), revised forecasts in
[0029](0029-a-series-belongs-to-an-object.md), the scale of series in
[0007](0007-series-at-scale.md), the place of Ekwo OS in
[0010](0010-ekwo-link.md). What is still to settle is in
[`docs/road-to-0.1.md`](../road-to-0.1.md).

## See also

- Inherits Ekwo OS 0061 (*AGPL core, MIT formats, an operational paid
  line*), with a reasoned divergence: a sign-off instead of Ekwo's
  contributor agreement.
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md), "Sign-off".
- [0035](0035-a-format-library-touches-no-database.md) — a format library
  is MIT.
