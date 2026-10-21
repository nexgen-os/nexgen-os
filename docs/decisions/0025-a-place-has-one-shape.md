# 0025 — A place has one shape

> Status: accepted · 19/10/2026, completed 21/10/2026

## Context

A place is found by its address in one country and by its coordinates in
another, and a form takes either and shows both. The geocoders the
repository reads (open ones worldwide, national registers, commercial
services an installation configures) each answered in a JSON shape of
their own, and the importers that create places from a file did the same.
Every caller translated, each a little differently, and the precision and
the origin of a point were lost on the way more often than not.

## Decision

**A place has one shape, defined by the core**, that every geocoder, every
importer and every connector produces and that a participant stores
([0045](0045-the-participant-is-the-node.md)): `join_project()` takes it,
`locate_participant()` places a participant again from it, `place_of()`
gives it back; a group of participants has none:

- **the address**: the street with its number as the country writes it, an
  extra line (building, floor, unit, box), the postal code, the city, the
  region (ISO 3166-2) and the country (ISO 3166-1). The postal address of
  schema.org and of Overture's address theme, and nothing more;
- **the point**: WGS 84, with its height
  ([0003](0003-geometry-wgs84-3d-utm.md));
- **its precision**: rooftop, parcel, street, postal code, city or region;
- **its source**: the geocoder, the register, the device or the person that
  placed it, as a source row, and the identifier that source knows the
  place by.

A point without its precision and its source is a point nobody vouches for,
and a page can say so.

**GeoJSON is the one interchange format of places.** A place travels as a
GeoJSON feature whose properties are the shape above.

**How a country writes an address is the pack's.** The order of the fields
on an envelope, which ones are required, the pattern of a postal code are
data of the country ([0020](0020-a-pack-holds-what-a-function-reads.md)).

**A geocoder is a connector.** One interface (search a text, reverse a
point) and one connector per geocoder, open by default, national and
commercial ones beside them under their own terms of storage. Nothing in
the database calls a geocoder: the core stores what came back and from
whom.

**The physical description of a place enriches it without changing it**
([0008](0008-3d-module.md)): the ground, the buildings, their volumes and
models attach to the participant in the `building` module; the shape
stays the same, on the participant.

## What it forbids

- A second shape of address or of position, in a connector, an importer or
  a module.
- A point stored without its precision and its source.
- A call to a geocoder from the database.
- Parsing a free-text address or validating it against a register in the
  core: both are a geocoder's service.

## What it replaced

The shapes of each geocoder adapter and importer, and the address rules of
decision 0009 written beside the geocoding library that held them. Until
0.3.0 the shape was stored on a site of the core (`create_site()`,
`locate_site()`); it is now the participant's.

## See also

- Inherits Ekwo OS 0024 (*A tax follows the territory of the parties*),
  translated by [0009](0009-addresses-and-geocoding.md): what applies to a
  place follows its region.
- [0011](0011-external-data.md) — sources and connectors.
- schema.org `PostalAddress`, Overture Maps addresses theme, RFC 7946
  (GeoJSON).
