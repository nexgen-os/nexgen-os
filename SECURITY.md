# Security

Nexgen OS holds the description of places and the series that come from
their meters and devices. A flaw here is not a crash: it is an organisation
reading another organisation's participants, or a series written without a trace.
Please report it, and please report it privately first.

## Reporting a vulnerability

Use GitHub's private reporting: **Security → Report a vulnerability** on
this repository. It opens a private advisory that only the maintainers can
read, and it keeps the report, the fix and the credit in one place.

Say what you found, where, and how to reproduce it. A failing test is the
best report. You will get an answer within five working days, and the fix
will name you unless you ask otherwise.

## How a vulnerability is handled

A report, or an advisory on a package Nexgen OS ships, goes through the
same steps:

1. **Acknowledged** within five working days, in the private advisory.
2. **Assessed**: which packages and which releases it reaches, read from
   their software bill of materials (below), and how severe it is.
3. **Fixed** on `main`, with the test that shows it, and released as a
   patch release.
4. **Published**: the advisory is made public with the release that fixes
   it, names the affected and the fixed versions, and credits the reporter.
   The changelog says it under *Security*.

A vulnerability actively exploited is fixed and published first, before
any other work.

## What a release ships

Every package published to npm comes with its **software bill of
materials**: one CycloneDX document per package, listing every package it
ships, transitively, with its version, its hash and its licence. The Release
workflow writes them (`node scripts/sbom.mjs`) and keeps them with the run of
each release; anyone can write them again from the tag, after `npm ci`, and
get the same list, read from `package-lock.json`. Development tools are not
shipped and are not listed.

What a package may ship is checked on every pull request
(`node scripts/check-licences.mjs`): a format library or a connector, under
MIT, takes nothing a closed product could not take, and no package takes a
licence that forbids commercial use, a source-available licence, or a
package that names no licence ([decision 0005](docs/decisions/0005-agpl-core-mit-libraries-sign-off.md)).

## What is in scope

- row level security: any path by which a member of one organisation reads
  or writes another's rows, or by which a shared vocabulary row is written
  by an ordinary member;
- the functions that run as their definer (`resample`, `store` and the
  series reads): any way to make them act beyond the caller's rights;
- the connectors and format readers: any input that makes them write where
  they should not, or leak a secret reference.

## What is not

- a platform built on Nexgen OS, which has its own channel;
- a weak password on an installation you run, or a key left in a client.

## How the schema defends itself

Every table carries row level security from its first migration
(`secure_table`); the organisation of every attachment is derived from the
object it is attached to, never trusted from the client; secrets never live
in the database — a `sources` or `connectors` row names a secret, the
installation's vault holds it.
