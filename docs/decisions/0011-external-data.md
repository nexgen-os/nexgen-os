# 0011 — A source is a row, a connector is code, and an organisation's use of it is a `connectors` row naming its secret

> Status: accepted

## Context

Most of what a page shows was not typed by anyone in the organisation: the
weather comes from a model, the meter readings from the grid operator's
hub, the prices and the carbon intensity from the transmission operator or
a market, the buildings and the companies around a place from registers and
maps, the roof from a solar API. A platform of the trade reads some forty
such sources; read each through code of its own, with the answers kept in
columns and JSON, nobody can say any more where a value came from. Three
questions follow: where external data lives in the model, how an
organisation's access to a source is described, and how a connector whose
data or code cannot be open plugs into an open core.

## Decision

**Two words, three layers, one rule: data carries its source.** A
*source* is what exists outside; a *connector* is the code that reads it
and, in the database, an organisation's configured use of that code. No
third word.

1. **A source is a row** of `sources`: what exists out there, its licence,
   its attribution, how it authenticates, which countries it covers, how
   long what it answered may be kept and whether it may be passed on.
   Worldwide open sources ship with the core, national ones with their
   pack, the others with the module or the private package that uses them.
2. **A connector is code outside the database**, in `packages/connectors/`,
   whatever language it runs: a client of an external API in TypeScript,
   or a program that reads one JSON request and answers one JSON result
   ([0013](0013-a-program-connector-reads-one-request.md)). A client has one interface per kind of
   answer (weather, meter data, places, addresses) and one implementation
   per source. It answers in the core's terms (quantities, value kinds,
   steps, identifier schemes), and what it brings back is written on
   ordinary objects through the gestures of the schema: series through the
   one write path ([0031](0031-one-way-to-write-a-series-one-way-to-read-it.md)),
   places in the one shape of a place ([0025](0025-a-place-has-one-shape.md)).
   A geocoder is a connector.
3. **An organisation's use of a connector is a `connectors` row naming its
   secret.** It says that this organisation reads that source, for what
   (`config`), with which credential by name (`secret_ref`, resolved in the
   installation's vault), and how the last collection went (`status`,
   `last_read_at`, `last_error`). It holds no secret and no data. The table
   takes the word of the code because the row is that code, configured.

Whatever a connector writes says where it came from: the source of a
series, an attribute, a document, a participant's position; the scheme of an
external identifier. Licence, attribution and retention follow the data
because the data names its source.

**Where each kind of data lands.**

| Data | Lands on | Note |
|---|---|---|
| weather forecast | a series of the participant or of a weather point, `forecast`, every issue kept | pages read the latest issue; an accuracy study reads what was known at a given time |
| weather observed, reanalysis | a series, `measured` or `simulated` | a reanalysis is a model's view of the past: `simulated`, with its source |
| meter readings | a series of the meter, `measured`, quality from the hub's codes | the mandate that allows the reading is the `grid` module's |
| prices, imbalance, carbon intensity | a series of the organisation, named by its zone | one series serves every participant in the zone |
| grid topology | rows of the `grid` module, pointing to the meters they serve | with the operator's identifiers |
| registers, cadastre, building datasets, company data | places, buildings, identifiers, attributes, documents | each with its source; a licensed answer expires with its retention |
| roof faces from a survey or a solar API | surfaces, with their source | a solar API's layers are a cache, never redistributed |

An external series needs an object to hang on. When no participant owns
it — a weather point shared by many participants, a bidding zone — it is a
series of the organisation, named by the point or the zone; the module
that knows the point holds it and says which participants read it
(`weather.participant_points`).

**Open connectors, private connectors.** The interfaces are the contract. A
connector is open when its data is. A connector whose data or terms are not
open is a private package that implements the same interface and ships its
`sources` rows with licence and retention; the core, the pages and the open
connectors never import it, and a page reads what it wrote the same way
whichever connector wrote it.

**The database calls no API**: no HTTP from a function, no job inside
Postgres. Collection is a job of the application, scheduled outside the
database.

## What it forbids

- A secret in a row of the database.
- External data without its source.
- A function of the schema that calls a network.
- A page, a module or an open connector that imports a private connector.

## See also

- Inherits Ekwo OS 0006 (*A machine key is a caller narrower than a
  person*) and 0027 (*The sources of a pack are a register, not a
  bibliography*).
- [`packages/connectors/README.md`](../../packages/connectors/README.md).
- [0016](0016-naming-third-party-methods.md) — a connector keeps its
  provider's name.
- [0029](0029-a-series-belongs-to-an-object.md) — forecasts and their
  issues.
