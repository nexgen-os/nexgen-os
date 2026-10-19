# 0035 — A format library is MIT, one package per format, and touches no database

> Status: accepted · 19/10/2026

## Context

`formats/` started as the place where files are read and written: IFC,
CityJSON, GeoJSON, EPW, PAN and OND. Some libraries then grew an importer
that writes the buildings, the floors and the series of the model, through a
database interface of their own; one held the national geocoders. A library
that writes the schema is an importer, tied to one version of the model and
unusable by anyone else; a library organised around a country is no longer a
format. The libraries are meant to be the part of the project any product
can use, under MIT, and that only holds when they know nothing of the model.

## Decision

**One package per format, named after the format, never after a country or
a product.** A standard keeps its standard's name (IFC, CityJSON, EPW); a
vendor's file keeps the vendor's file name (PAN and OND)
([0016](0016-naming-third-party-methods.md)). Which formats a country uses is
data of its pack.

**A format library touches nothing of Nexgen OS.** It parses a file into
plain shapes declared in its own types, and writes a file from plain shapes.
It imports nothing of the core, of a module or of another library, opens no
database connection and calls no network.

**Importing is not a format.** What turns parsed shapes into rows of the
model — buildings with their footprint, spaces, series with their
provenance — is an importer, and lives in the core package or in the module
that owns the rows, where it writes through the gestures of the schema
([0018](0018-one-function-per-gesture.md)).

**A library computes no figure and invents no value.** It carries what the
file says, in the file's units and conventions, converted only where the
format defines the conversion; a default unit, a default country or a
guessed time zone is a value nobody chose
([0036](0036-a-file-is-imported-once.md)).

**Each package keeps its own MIT licence** and is published on its own, so
that a tool outside Nexgen OS can read an IFC or an EPW file with it.

## What it forbids

- A format library that writes or reads the database, or imports a type of
  the model.
- A folder of format libraries organised by country, or a national register
  among them: a geocoder is a connector
  ([0025](0025-a-place-has-one-shape.md)).
- A factor list for units repeated in a library where the core holds the
  conversion as data ([0030](0030-a-value-is-stored-in-the-unit-of-its-quantity.md)).

## What it replaced

Four libraries that wrote the model through a database interface of their
own (`cityjson`, `homeassistant`, `ifc`, `geojson`), and the geocoders kept
as a format library with national adapters inside it.

## See also

- Inherits Ekwo OS 0048 (*Format libraries are MIT, one package per
  format*).
- [0036](0036-a-file-is-imported-once.md) — a reader reports rather than
  corrects.
- [0024](0024-one-language-per-layer.md) — TypeScript ships under the
  packages, another language is an engine.
