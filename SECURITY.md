# Security

Nexgen OS holds the description of places and the series that come from
their meters and sensors. A flaw here is not a crash: it is an organisation
reading another organisation's sites, or a series written without a trace.
Please report it, and please report it privately first.

## Reporting a vulnerability

Use GitHub's private reporting: **Security → Report a vulnerability** on
this repository. It opens a private advisory that only the maintainers can
read, and it keeps the report, the fix and the credit in one place.

Say what you found, where, and how to reproduce it. A failing test is the
best report. You will get an answer within five working days, and the fix
will name you unless you ask otherwise.

## What is in scope

- row level security: any path by which a member of one organisation reads
  or writes another's rows, or by which a shared vocabulary row is written
  by an ordinary member;
- the functions that run as their definer (`resample`, `store` and the
  series reads): any way to make them act beyond the caller's rights;
- the connectors and format readers: any input that makes them write where
  they should not, or leak a secret reference.

## What is not

- Nexgen, WeSmart's commercial platform, which has its own channel;
- a weak password on an installation you run, or a key left in a client.

## How the schema defends itself

Every table carries row level security from its first migration
(`secure_table`); the organisation of every attachment is derived from the
object it is attached to, never trusted from the client; secrets never live
in the database — a `sources` or `connections` row names a secret, the
installation's vault holds it.
