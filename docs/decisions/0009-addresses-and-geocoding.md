# 0009 — Addresses, positions and geocoding

**Decided 13/10/2026.**

## Context

A site is found by its address in one country and by its coordinates in
another, and a form takes either and shows both. The product this core comes
from recognises an address as it is typed, through a commercial geocoder, in
the countries it was configured for, and turns it into a point and back. An
open core has to do this in every country, on open data by default, with a
commercial geocoder as a choice of the installation and never a requirement.

## Decision

1. **One shape of address: the fields every country has.** `street` (with
   its number, as the country writes it), `address_extra` (building, floor,
   unit, box), `postal_code`, `city`, `region` (ISO 3166-2), `country` (ISO
   3166-1). It is the postal address of schema.org and of Overture's address
   theme, and nothing more. How a country orders them on an envelope, which
   ones it requires, what its postal code looks like: the country pack's.
2. **A position says how precise it is and who placed it.**
   `location_precision` — `rooftop`, `parcel`, `street`, `postal_code`,
   `city`, `region` — and `location_source_code`: a geocoder, a GPS device, a
   person on a map, all of them sources. A point without them is a point
   nobody vouches for, and a page can say so.
3. **Geocoders are sources, read by one library.** `formats/geocoding` (MIT)
   has one interface — `search(text)` gives places, `reverse(lon, lat)`
   gives the address at a point — and one adapter per geocoder. Nominatim and
   Photon (OpenStreetMap, ODbL, worldwide) ship with the core; a country's
   address register comes with its pack; commercial geocoders are adapters an
   installation configures with its own key, under that geocoder's terms on
   what may be stored. Every place a geocoder returns carries its source, its
   precision and the identifier the geocoder knows it by, so the site keeps
   all three.
4. **Nothing in the database calls a geocoder.** The library runs in the
   application, a command line or an edge function; the core stores what came
   back and from whom.

## Consequences

- `sites` gains `address_extra`, `location_precision` and
  `location_source_code`; `sources` gains `nominatim` and `photon`.
- A form built on the library works in every country from the first day, on
  OpenStreetMap; a pack improves the country it knows.
- Out of scope, on purpose: parsing a free-text address into fields and
  validating an address against a register. Both are services a geocoder
  provides, not the core's.

## The regional level (added 13/10/2026)

A country is not always the level at which things are decided: Belgium keeps
one address register, one grid operator and one set of rules per region;
France has local distribution operators on some four hundred municipalities
beside the national one; the Netherlands decides most things per
municipality. Three levels, all data:

- **region** — `sites.region`, ISO 3166-2 (`BE-VLG`, `FR-75`, `NL-NH`);
  a pack row that applies to part of a country says so in `regions`
  (`sources.regions`, and the same column on the rows of the `grid`,
  `energy` and `compliance` modules);
- **municipality** — `sites.municipality_code`, in the country's own code
  (INSEE, NIS, CBS), an `id_schemes` row of the pack; a grid operator, a
  planning rule or a dataset decided per municipality lists its codes;
- **area** — when neither code says it (an operator's concession drawn on a
  map), a geometry on the row, and `ST_Contains` on the site's point.

The geocoders fill the first two: a register answers with the region and
the municipality code, and the chain of geocoders (`geocoderFor`) asks the
registers keyed by region in turn (`BE-BRU`, `BE-VLG`, `BE-WAL`) when a
country keeps one per region. Resolution order for an operator or a rule:
what the object says itself (the meter's operator), then area, then
municipality, then region, then country.
