# Nexgen OS

An open foundation for describing the built world — districts, parcels,
buildings, storeys, rooms, roofs, walls, equipment, sensors, organisations —
in 3D and over time, so that architecture, energy, operations and
compliance tools share one model.

Why it exists and what it promises: [MANIFESTO.md](MANIFESTO.md).

> Status: **0.0 — the core schema**. No module, no pack, no format library is
> published yet. The core is tested; nothing here is stable until 0.1.

## The model in one screen

Everything is an **entity**. What it is comes from a vocabulary; what is
known about it is attached to it.

| Table | Holds | Standard it follows |
|---|---|---|
| `entities` | everything that can be described, in one containment tree, with a main 3D shape, orientation, tags, lifecycle status | Brick entity, IFC spatial decomposition, NGSI-LD entity |
| `entity_values` | typed values with validity periods and provenance (floor area, year built, peak power, U-value…) | IFC property sets, bSDD properties |
| `relationships` | typed links: feeds, monitors, meters, mounted on, serves, shades, owns, occupies, member of | Brick relationships, IFC relationships |
| `representations` | shapes and files: outlines, LoD blocks, roof models, meshes, BIM models, point clouds, orthophotos, images, videos, 3D tiles | CityGML / CityJSON levels of detail |
| `external_ids` | identifiers known elsewhere, with validity | IFC GlobalId, OSM, Overture GERS, GS1, national registers |
| `entity_lineage` | splits, merges, replacements | Overture GERS changelog |
| `datastreams` / `observations` | measured, simulated, forecast series and setpoints | OGC SensorThings, Brick points |
| `scenarios` | design variants: what exists (null) and what is proposed | IFC5 layers, OpenStudio measures |
| `runs` | results of module computations, immutable and reproducible | — |
| `classes`, `relation_types`, `property_defs`, `quantities`, `tags`, `id_schemes` | the vocabularies, as data | Brick, IFC, CityGML, bSDD, QUDT, Haystack |

Details, diagram and rules: [docs/model.md](docs/model.md).

## Principles

1. **One description, attached to.** No table per kind of thing: a new kind is
   a vocabulary row, published by a module or a pack.
2. **3D WGS 84 everywhere.** Any CRS is accepted on the way in; geometry is
   stored in EPSG:4326 with heights in metres, and measured in the UTM zone it
   falls in, anywhere on earth.
3. **One way to read.** `entity_properties()` for values, `series()` for time
   series, `entity_subtree()` for containment, `lod1_block()` for a derived
   3D block.
4. **Deterministic core.** Nothing in the core calls a model. Modules hand
   results back through `record_run()`: same inputs, same engine, same run.
5. **Modules in their own schema, countries as data, formats by format.**

## Run the tests

```bash
npm install
npm test        # PGlite + PostGIS in WebAssembly, no server needed
npm run typecheck
```

The tests describe four cases end to end: a house (tree, roof, PV,
values over time, drone capture, scenario), a hall with three tenants
(connection points, meter swap, occupancy, community, sensors, setpoints,
cumulative registers), a district from open data (projected CRS, OSM
identifiers, spatial queries, shading, parcel split) and security (row level
security, viewers, run immutability, vocabulary hygiene).

## Layout

```
supabase/migrations/   the core schema
supabase/seed/         the core vocabularies
modules/               one Postgres schema per module (none yet)
packs/                 one folder per country (none yet)
formats/               one MIT library per format (none yet)
docs/                  model, decisions, research
tests/                 the core's tests
```

## Licence

The core is AGPL-3.0 ([LICENSE](LICENSE)). Format libraries will be MIT.
