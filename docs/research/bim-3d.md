# Nexgen OS — inspiration from open-source BIM, 3D city models and geospatial digital twins

Research date: 2026-10-12. GitHub figures (stars, licence, last push, latest release) were read
through the GitHub API on that date; nothing below is estimated. "Last push" is the most recent
commit on any branch. Where a project is a specification rather than code, the governing body
and publication status are given instead.

Nexgen OS context assumed: Postgres-first (PostGIS 3D) core describing places, buildings,
storeys, spaces, surfaces, physical assets, parties, meters/time series and scenarios; AGPL core,
MIT format libraries; modules in their own Postgres schema; country packs as data with a test;
formats organised by format, not by country (the Ekwo OS playbook).

---

## 1. Activity snapshot (verified 2026-10-12)

| Project | Repo | Licence | Stars | Last push | Latest release |
|---|---|---|---|---|---|
| IfcOpenShell (+ Bonsai) | IfcOpenShell/IfcOpenShell | LGPL-3.0 (Bonsai add-on GPL-3.0) | 2 850 | 2026-10-12 | ifcopenshell-v0.9.0 (2026-10-01); Bonsai 0.9.1 alpha builds daily |
| That Open — web-ifc | ThatOpen/engine_web-ifc | MPL-2.0 | 1 060 | 2026-10-12 | 0.78 (2026-09-21) |
| That Open — components | ThatOpen/engine_components | MIT | 711 | 2026-10-11 | v3.4.9 (2026-10-06) |
| That Open — fragments | ThatOpen/engine_fragment | MIT | 213 | 2026-10-11 | v3.4.8 (2026-10-06) |
| xeokit SDK | xeokit/xeokit-sdk | AGPL-3.0 + commercial | 945 | 2026-10-05 | v2.6.114 (2026-09-02) |
| Speckle server | specklesystems/speckle-server | Apache-2.0, except `workspaces/` and `gatekeeper/` under Speckle EE licence | 848 | 2026-10-07 | 2.31.14 (2026-06-15) |
| Speckle connectors | specklesystems/speckle-sharp-connectors | Apache-2.0 | 66 | 2026-10-12 | 2026.9.3 (2026-10-12) |
| IFC 4.3 development | buildingSMART/IFC4.x-development | CC BY-ND 4.0 (spec) | 241 | 2026-10-12 | IFC 4.3.2.0 = ISO 16739-1:2024 |
| IFC 5 (IFCX) | buildingSMART/IFC5-development | none declared (viewer MIT) | 233 | 2026-09-08 | alpha examples |
| IDS | buildingSMART/IDS | NOASSERTION | 324 | 2026-09-25 | v1.0.0 (2024-06-03) |
| bSDD | buildingSMART/bSDD | MIT (docs/model) | 196 | 2026-10-07 | hosted service + API v1 |
| buildingSMART Validate | buildingSMART/validate + ifc-gherkin-rules | MIT | 68 / 24 | 2026-10-05 / 2026-09-30 | v1.0.5 (2026-09-30) |
| CityJSON | cityjson/specs | CC0-1.0 | 126 | 2026-05-12 | 2.0.2 (2026-03-27) |
| cjio | cityjson/cjio | MIT | 151 | 2025-05-09 | v0.10.1 (2025-05-09) |
| CityGML 3.0 conceptual model | opengeospatial/CityGML-3.0CM | MIT (repo) | 94 | 2025-10-28 | 3.0.0 final (OGC standard 2021) |
| 3DCityDB | 3dcitydb/3dcitydb | Apache-2.0 | 481 | 2026-10-09 | v5.1.4 (2026-08-25) |
| citydb-tool | 3dcitydb/citydb-tool | Apache-2.0 | 22 | 2026-10-12 | v1.4.0 (2026-09-02) |
| OSM Buildings (JS viewer) | OSMBuildings/OSMBuildings | BSD-style | 1 008 | 2021-04-29 | v4.0.1 (2018-08-10) — dormant |
| OSM Simple 3D Buildings | wiki.openstreetmap.org | ODbL data / wiki CC BY-SA | — | — | tagging scheme (Garching workshop) |
| CesiumJS | CesiumGS/cesium | Apache-2.0 | 15 823 | 2026-10-11 | 1.146 (2026-10-01) |
| 3D Tiles spec | CesiumGS/3d-tiles | no SPDX file (OGC Community Standard) | 2 619 | 2026-10-06 | 1.1 (2023); 2.0 in development |
| cesium-native | CesiumGS/cesium-native | Apache-2.0 | 632 | 2026-10-12 | — |
| 3d-tiles-tools | CesiumGS/3d-tiles-tools | Apache-2.0 | 539 | 2026-07-24 | — |
| iTwin.js | iTwin/itwinjs-core | MIT | 734 | 2026-10-12 | 5.14.2 (2026-10-06) |
| Open Data Cube | opendatacube/datacube-core | Apache-2.0 | 590 | 2026-10-10 | 1.9.22 (2026-09-01) |
| QGIS | qgis/QGIS | GPL-2.0 | 14 533 | 2026-10-12 | 3.44.15 (2026-09-25) |
| Ladybug | ladybug-tools/ladybug | AGPL-3.0 | 228 | 2026-09-22 | v0.44.62 (2026-09-22) |
| Honeybee-energy | ladybug-tools/honeybee-energy | AGPL-3.0 | 36 | 2026-10-05 | v1.126.1 (2026-10-05) |
| Honeybee-schema | ladybug-tools/honeybee-schema | NOASSERTION | 14 | 2026-09-25 | v2.3.0 (2026-09-25) |
| Dragonfly (urban) | ladybug-tools/dragonfly-core | AGPL-3.0 | 19 | 2026-10-05 | v1.77.22 (2026-10-05) |
| OpenStudio | NatLabRockies/OpenStudio (ex NREL) | BSD-3-style with name clause | 649 | 2026-10-12 | v3.11.0 (2026-01-15) |
| openstudio-standards | NatLabRockies/openstudio-standards | BSD-3-style | 105 | 2026-10-12 | v0.8.6 (2026-03-24) |
| EnergyPlus | NatLabRockies/EnergyPlus | BSD-3-style with name clause | 1 589 | 2026-10-12 | v26.2.0 (2026-09-30) |
| URBANopt CLI | urbanopt/urbanopt-cli | BSD-3-style | 12 | 2026-10-01 | v1.3.0 (2026-06-29) |
| BuildingSync schema | BuildingSync/schema | BSD-3-style | 27 | 2026-07-10 | v2.7.0 (2025-09-11) |
| Brick Schema | BrickSchema/Brick | BSD-3-Clause | 406 | 2026-10-07 | v1.4.4 stable (2025-05-02); v1.5.0-rc2 (2026-10-07) |
| py-brickschema | BrickSchema/py-brickschema | BSD-3-style | 71 | 2026-09-25 | v0.8.0 (2026-09-25) |
| BuildingMOTIF | NatLabRockies/BuildingMOTIF | BSD-3-Clause | 72 | 2026-09-02 | v0.4.0 (2025-09-20) |
| Project Haystack defs | Project-Haystack/haystack-defs | AFL-3.0 | 87 | 2025-07-07 | v4.0.0 (2025-07-07); Haystack 5 + Xeto announced May 2025 |
| SAREF4BLDG | saref.etsi.org / labs.etsi.org | ETSI (BSD-3 for ontology files) | — | — | v2.1.1 (2025-04-24), ETSI TS 103 410-3 |
| ASHRAE 223P | open223.info | ASHRAE (draft) | — | — | second publication public review (April 2026), not yet published |
| Overture Maps schema | OvertureMaps/schema | CC-BY-4.0 (schema), data ODbL/CDLA | 219 | 2026-10-11 | overture-schema v2.0.0 (2026-09-02) |
| 3DBAG roofer | 3DBAG/roofer | GPL-3.0 | 205 | 2026-07-30 | v1.0.0 (2026-04-20) |
| 3DBAG pipeline | 3DBAG/3dbag-pipeline | Apache-2.0 | 13 | 2026-09-24 | 2025.09.03 |
| 3dfier | tudelft3d/3dfier | GPL-3.0 | 636 | 2026-09-08 | v1.5.0 (2026-09-08) |
| BIMserver | opensourceBIM/BIMserver | AGPL-3.0 | 1 761 | 2026-03-13 | v1.5.188 (2025-07-31) — slowing |
| Hypar Elements | hypar-io/Elements | MIT | 420 | 2026-10-10 | 2.4.0-alpha.8 (2025-06-09) |
| Open CASCADE | Open-Cascade-SAS/OCCT | LGPL-2.1 + exception | 2 989 | 2026-10-12 | V8.0.1 (2026-07-30) |
| PMTiles | protomaps/PMTiles | BSD-3 (code), CC0 (spec) | 3 080 | 2026-09-16 | — |
| MapLibre GL JS | maplibre/maplibre-gl-js | BSD-3 | 11 852 | 2026-10-11 | v6.14.0 (2026-10-11) |
| deck.gl | visgl/deck.gl | MIT | 14 652 | 2026-10-11 | v9.4.0 (2026-09-05) |
| PostGIS | postgis/postgis | GPL-2.0 | 2 243 | 2026-10-12 | (tags, no GitHub releases) |

---

## 2. Project by project

### 2.1 IfcOpenShell — https://ifcopenshell.org · https://github.com/IfcOpenShell/IfcOpenShell
- **Licence**: LGPL-3.0 (library); Bonsai Blender add-on GPL-3.0. Very active (daily alpha builds, v0.9.0 on 2026-10-01).
- **Data model**: a schema-driven runtime: the IFC EXPRESS schemas (2x3, 4, 4.3) are compiled into
  late-bound entity classes; files are graphs of entity instances with STEP ids (`#123`) plus
  22-char IFC GlobalIds. Geometry is computed on demand by an OCCT/CGAL kernel ("iterator").
- **Extension mechanism**: `ifcopenshell.api` — ~400 small, named, transactional operations
  (`root.create_entity`, `pset.edit_pset`, `geometry.assign_representation`…) grouped by domain
  module; `ifcopenshell.util` helpers; IfcTester (IDS), IfcDiff, IfcPatch recipes (pluggable
  transformations), IfcCSV, IfcClash, IfcCOBie.
- **Governance**: benevolent-dictator-ish (Dion Moult, Thomas Krijnen) + OSArch community, funded by
  donations (OpenCollective) and grants. No company owns it.
- **Borrow**: the `api.<domain>.<verb>` layer — every mutation is a named, documented, testable
  function with an undo story; this is exactly Ekwo's "deterministic core" pattern and maps to
  Postgres RPCs (`nexgen.space_create`, `nexgen.pset_edit`). Borrow IfcPatch "recipes" as a model
  for pluggable bulk transformations. Use IfcOpenShell itself (LGPL, safe to call from AGPL) as the
  IFC import/export brick.
- **Avoid**: becoming an IFC authoring tool; keep IFC as an exchange format (a format library), not
  as the storage model. STEP ids are file-local — never persist them as identifiers.

### 2.2 Bonsai (ex BlenderBIM) — https://bonsaibim.org
- Lives inside the IfcOpenShell repo. Native-IFC authoring: the IFC graph *is* the document; Blender
  is the view. Rename from BlenderBIM to Bonsai (2024) after Blender Foundation trademark request.
- **Borrow**: the "native format, no proprietary intermediate" stance and the
  storeys/spatial-tree UI; its demonstration that an open tool can reach professional parity when
  the core API is good.
- **Avoid**: a name that leans on someone else's trademark (rename cost them visibility).

### 2.3 That Open Company — web-ifc, @thatopen/components, Fragments
- https://thatopen.com · https://github.com/ThatOpen
- **Licences**: web-ifc MPL-2.0 (file-level copyleft), components/fragments/ui MIT. Company-backed
  (That Open Company, Spain), monetised via That Open Platform and paid courses/marketplace.
- **Data model**: web-ifc parses IFC in WASM (C++); Fragments 2 is a FlatBuffers binary that
  stores instanced geometry + item ids + attributes/relations for fast streaming of very large
  models. Components is an ECS-like registry: `components.get(Classifier)`, `get(IfcLoader)`…
- **Extension mechanism**: every feature is a "component" registered by UUID in a singleton
  registry; third parties publish components on npm.
- **Borrow**: (1) the **format-specific engine under a weak licence (MPL) + toolkit under MIT +
  platform paid** split — same as Ekwo's MIT format libraries; (2) a compact streaming binary
  derived from the source model (Fragments) rather than serving IFC; (3) component registry by
  stable id.
- **Avoid**: their churn (v1→v2→v3 APIs in ~3 years broke tutorials); freeze public interfaces.

### 2.4 xeokit SDK — https://xeokit.io · https://github.com/xeokit/xeokit-sdk
- **Licence**: AGPL-3.0 with paid commercial licence (Creoox AG). 945 stars, steady releases.
- **Data model**: SceneModel of entities (meshes, instancing, double-precision RTC coordinates for
  geo-scale) + a separate `MetaModel` (metaObjects with id, type, parent, propertySets) loaded from
  JSON; XKT compressed format produced by `xeokit-convert`.
- **Borrow**: the **separation of geometry (SceneModel) from semantics (MetaModel) linked by the
  same object id** — Nexgen should store semantics in Postgres and only ship ids + geometry to the
  viewer. Also proof that AGPL + commercial dual licence sustains a BIM viewer business.
- **Avoid**: dual licensing requires a CLA / copyright assignment; that deters contributors. If
  Nexgen keeps AGPL, prefer DCO and accept that dual licensing is off the table, or decide early.

### 2.5 Speckle — https://speckle.systems · https://github.com/specklesystems
- **Licence**: Apache-2.0, with `workspaces/` and `gatekeeper/` modules under the Speckle
  Enterprise Edition licence (open core in one repo). Connectors Apache-2.0.
- **Data model**: everything is a `Base` object (dynamic properties + `speckle_type`), content
  addressed: the object id is the **hash of its serialised content**; large children are
  "detached" and referenced by hash; a model version (commit) points to a root object; projects ›
  models › versions. Connectors (Revit, Rhino, Archicad, QGIS, Power BI…) convert to/from Base.
- **Extension mechanism**: Objects kit (typed classes), connectors, automate functions
  (containerised functions triggered on new versions — "Speckle Automate").
- **Governance**: company-led (AEC Systems Ltd, VC-funded); community forum.
- **Borrow**: (1) **content-hash ids for immutable geometry/payload blobs** (dedupe, cache,
  integrity) — combine with stable UUIDs for the living objects; (2) **version = immutable snapshot
  pointing to a root**, good fit for Nexgen "scenarios"; (3) Automate = "functions triggered on
  new version" ≈ Nexgen module hooks/compliance checks; (4) the EE-directory licence trick is a
  clean way to keep a paid edition inside one repo if ever needed.
- **Avoid**: a fully schemaless `Base` — data quality depends on each connector; Nexgen should keep
  typed core tables and confine free-form data to property sets.

### 2.6 IFC 4.3 / IFC 5 (buildingSMART) — https://technical.buildingsmart.org
- **Status**: IFC 4.3.2.0 is ISO 16739-1:2024; spec source on GitHub under CC BY-ND 4.0, built
  automatically. IFC5 ("IFCX") is in alpha: JSON, schemas written in TypeSpec, published at
  ifcx.dev, and **layered composition** inspired by OpenUSD (several files contribute attributes
  to the same object path; later layers override).
- **Data model**: spatial structure `IfcProject › IfcSite › IfcFacility (IfcBuilding, IfcBridge,
  IfcRoad…) › IfcFacilityPart/IfcBuildingStorey › IfcSpace`, elements contained via
  `IfcRelContainedInSpatialStructure`, aggregation via `IfcRelAggregates`, objectified
  relationships; 22-char base64 GlobalId (compressed UUID); property sets (`Pset_WallCommon`) and
  quantity sets (`Qto_*`) attached by `IfcRelDefinesByProperties`; types (`IfcWallType`) share
  psets by `IfcRelDefinesByType`; classification references (Uniclass, OmniClass, bSDD URIs).
- **Borrow**: (1) the spatial hierarchy names (site/facility/storey/space) as Nexgen's core
  vocabulary, so IFC round-trip is lossless; (2) **Pset/Qto mechanism**: standard sets defined
  in data (`Pset_*` = core, country/module prefixes for others), type-level psets inherited by
  occurrences; (3) **UUID stored canonically + IFC GlobalId derived** for export; (4) IFC5's
  layered "opinions" model for scenarios: a scenario = an overlay layer of attribute overrides
  on the base twin; (5) IFC 4.3 widened to infrastructure (IfcFacility) — Nexgen should name its
  core entity "facility/asset site" generically, not only "building".
- **Avoid**: CC BY-ND (no derivatives) for Nexgen's own spec — it blocks community forks and
  translations; objectified-relationship explosion (every link is an entity) is heavy in SQL — use
  plain FK + a typed `relation` table only where many-to-many is real.

### 2.7 IDS — Information Delivery Specification — https://github.com/buildingSMART/IDS
- v1.0.0 (June 2024), buildingSMART standard. XML file stating **facets** (Entity, Attribute,
  Property, Classification, Material, PartOf) as *applicability* + *requirements*, with
  cardinality; machine-checkable (IfcTester, others).
- **Borrow**: model Nexgen **country packs and compliance modules as IDS-like declarative
  requirement sets** (applicability → requirement → cardinality), stored as data and evaluated
  by one engine; ship IDS import/export as a format library. This is the exact analogue of Ekwo
  "country = data pack with a test".
- **Avoid**: XML-only authoring; keep a JSON/SQL representation as source and emit IDS.

### 2.8 bSDD — buildingSMART Data Dictionary — https://github.com/buildingSMART/bSDD
- Hosted canonical database of **dictionaries** (owner organisation + dictionary + version) →
  **classes** → **properties** with allowed values, units, translations, relations between
  dictionaries; every item has a resolvable URI
  (`https://identifier.buildingsmart.org/uri/<org>/<dict>/<version>/class/<code>`). Import model
  is JSON or Excel.
- **Borrow**: (1) **namespaced, versioned URI scheme** for every class/property Nexgen or a pack
  defines (`<publisher>/<dictionary>/<version>/<code>`); (2) properties defined once, referenced by
  many classes; translations as data; (3) allow linking Nexgen classes to bSDD URIs
  (`classification_uri` column).
- **Avoid**: depending on the hosted service at runtime — mirror the needed dictionaries into the
  pack.

### 2.9 buildingSMART Validate + ifc-gherkin-rules (MIT, 2026 active)
- The official IFC validation service: schema check + **normative rules written in Gherkin**
  (`Given an IfcBuildingStorey… Then…`) with ids (e.g. `ALB001`), each rule with passing/failing
  fixture files.
- **Borrow**: the **rule id + human-readable rule + fixture files that must pass/fail** pattern for
  Nexgen's pack tests (Ekwo "pack with a test" made public and auditable).

### 2.10 CityJSON — https://www.cityjson.org · https://github.com/cityjson/specs
- **Licence**: CC0 (spec). v2.0 (OGC Community Standard), last 2.0.2 March 2026; TU Delft-led.
- **Data model**: a JSON encoding of the CityGML data model: `CityObjects` (dictionary keyed by
  id, with `type`, `attributes`, `geometry[]`, `parents/children`), a **shared, quantised
  `vertices` array** (integer coords + `transform` scale/translate), geometry per `lod`
  (`"1.2"`, `"2.2"`), semantics per surface (`RoofSurface`, `WallSurface`, `GroundSurface`…),
  `CityJSONFeature` + JSONL for streaming.
- **Extension mechanism**: **Extensions** = a JSON-Schema file declaring new `+`-prefixed city
  object types (`+NoiseBuilding`), new root properties and new attributes; referenced by URL in
  the file.
- **Borrow**: (1) **surface semantics typed per face** (roof/wall/ground/closure) — Nexgen's
  "surfaces" table should carry a semantic type and an orientation/tilt computed once (the PV and
  thermal modules need exactly this); (2) the **`+` prefix convention** for extension types,
  analogous to module schemas; (3) JSONL feature streaming for export; (4) CC0 for the spec.
- **Avoid**: storing quantised vertex arrays in the DB — that is an encoding concern; keep PostGIS
  `POLYHEDRALSURFACE Z` / `MULTIPOLYGON Z` in storage, quantise in the format library.

### 2.11 CityGML 3.0 (OGC) — https://github.com/opengeospatial/CityGML-3.0CM
- OGC standard (conceptual model 2021, GML encoding later); UML-defined, modules (Building,
  Construction, Transportation, Vegetation, Versioning, Dynamizer, PointCloud…).
- Key 3.0 changes: **LoD4 removed — interiors (rooms, storeys, installations) can be modelled at
  any LoD 0-3**; `Storey` and `BuildingUnit` added; **Dynamizer** links attributes to external
  time series (sensor APIs, SensorThings) instead of embedding them; **Versioning** module
  (`validFrom/validTo`, version transitions); spaces vs space boundaries (thematic surfaces) as a
  clean dual model.
- **Extension mechanism**: ADE (Application Domain Extension), e.g. the Energy ADE (thermal zones,
  constructions, materials, usage zones, energy demand) — directly relevant to Nexgen's energy
  module.
- **Borrow**: (1) **space / space-boundary duality** — spaces (building, storey, room) are
  volumes, surfaces are their boundaries, the same surface shared by two spaces (needed for
  thermal adjacency); (2) **Dynamizer**: an attribute can point to a time series instead of a
  value → Nexgen `meter`/`timeseries` reference column on any property; (3) bitemporal
  `valid_from/valid_to` + `creation_date/termination_date`; (4) read the **Energy ADE** before
  designing the energy module tables.
- **Avoid**: GML as a working format; UML/XSD-first workflow is slow for contributors.

### 2.12 3DCityDB v5 — https://github.com/3dcitydb/3dcitydb (Apache-2.0)
- TUM-led, v5.1.4 (Aug 2026). **v5 replaced ~60 class-specific tables with a generic
  feature/property model** — the most directly relevant Postgres design in this survey. Core
  tables (read from `postgresql/sql-scripts/schema/schema.sql`):
  - `feature(id bigint, objectclass_id, objectid text, identifier, identifier_codespace,
    envelope geometry(GEOMETRYZ), creation_date, termination_date, valid_from, valid_to,
    last_modification_date, updating_person, reason_for_update, lineage)`
  - `property(id, feature_id, parent_id, datatype_id, namespace_id, name, val_int, val_double,
    val_string, val_timestamp, val_uri, val_codespace, val_uom, val_array jsonb, val_lod,
    val_geometry_id, val_implicitgeom_id, val_appearance_id, val_address_id, val_feature_id,
    val_relation_type, val_content, val_content_mime_type)`
  - `geometry_data(id, geometry geometry(GEOMETRYZ), implicit_geometry, geometry_properties jsonb,
    feature_id)` — `geometry_properties` holds per-surface semantics/ids as JSON
  - metadata: `objectclass(id, superclass_id, classname, is_abstract, is_toplevel, ade_id,
    namespace_id, schema jsonb)`, `datatype(... schema jsonb)`, `namespace`, `ade`,
    `codelist` / `codelist_entry`, `database_srs`
  - appearance: `appearance`, `surface_data`, `tex_image`, mapping tables.
- **Extension mechanism**: ADEs register new object classes/datatypes as **rows** in
  `objectclass`/`datatype` with a JSON schema mapping — no DDL per extension.
- **Borrow**: (1) **metadata-driven class registry** (`objectclass` with superclass + JSON schema)
  so country packs and modules add types as data; (2) **LoD stored on the property that holds the
  geometry** (`val_lod`), so one feature carries several LoDs; (3) bitemporal + lineage columns on
  every feature; (4) `identifier + identifier_codespace` pair for external ids (cadastre, BAG,
  EAN…); (5) codelists as tables.
- **Avoid**: going fully EAV for the core — the generic `property` table makes simple queries
  (floor area of all storeys) need joins and is hard for Supabase/PostgREST consumers. Nexgen
  should keep **typed core tables** (building, storey, space, surface, asset, meter) and use the
  generic property/pset table only for the long tail.

### 2.13 OSM Simple 3D Buildings + OSM Buildings
- **S3DB** (https://wiki.openstreetmap.org/wiki/Simple_3D_Buildings): outline (`building=*`)
  carries address/name; `building:part=*` areas carry volumes; tags `height`, `min_height`,
  `building:levels`, `building:min_level`, `roof:shape` (flat, skillion, gabled, hipped,
  pyramidal, gambrel, mansard, dome, onion, round, saltbox…), `roof:height`, `roof:angle`,
  `roof:direction`, `roof:orientation`, materials and colours. Renderers use parts and ignore the
  outline when parts exist.
- **OSM Buildings** JS viewer: BSD, dormant since 2021 (last release 2018).
- **Borrow**: (1) the **parametric "LoD1.5/2-lite" description** (footprint + heights + roof
  shape enum + roof direction) as Nexgen's lowest-cost building representation — enough for PV
  sizing and roof segments, generated from data rather than meshes; (2) the outline-vs-parts
  rule; (3) `roof:shape` enum as a codelist.
- **Avoid**: OSM Buildings' tile service model (dead product) and ODbL contamination: if Nexgen
  stores OSM-derived geometry, keep source + licence per row (`source`, `licence` columns).

### 2.14 CesiumJS + 3D Tiles — https://github.com/CesiumGS/cesium (Apache-2.0)
- CesiumJS 15.8 k stars, monthly releases (1.146 on 2026-10-01). 3D Tiles 1.1 is an OGC Community
  Standard; 2.0 in development. Cesium was acquired by Bentley Systems (2024) — stays Apache.
- **Data model**: a tileset is a spatial tree (bounding volumes, geometric error = screen-space
  error LoD, `REPLACE`/`ADD` refinement), content = glTF; 1.1 adds **metadata schema** (classes +
  properties, `EXT_structural_metadata`, `EXT_mesh_features` feature ids) and implicit tiling.
- **Extension mechanism**: glTF/3D Tiles extensions with registry and `EXT_`/vendor prefixes.
- **Borrow**: (1) **3D Tiles + glTF as the outbound 3D format** (a format library producing
  tilesets from PostGIS, e.g. via pg2b3dm or py3dtiles); (2) feature ids in the mesh that
  resolve back to Nexgen UUIDs; (3) the open-spec + vendor-extension prefix registry model;
  (4) geometric-error LoD for streaming, distinct from the semantic LoD.
- **Avoid**: binding the core to Cesium ion (proprietary hosting) — use CesiumJS or deck.gl /
  MapLibre against self-hosted tiles.

### 2.15 iTwin.js (Bentley) — https://github.com/iTwin/itwinjs-core (MIT)
- 734 stars, releases every few weeks (5.14.2, 2026-10-06). Company-controlled (Bentley).
- **Data model**: an iModel is a SQLite database with the **BIS** (Base Infrastructure Schemas)
  layered schemas written in ECSchema: `Element` (with federation GUID + code), `Model` (a
  breakdown that contains elements), `ElementAspect` (multi-aspects for repeated attached data),
  `ElementRefersToElements` relationships; **Code = (CodeSpec, scope, value)** gives
  human-meaningful unique identifiers; changes are **changesets** (like Git commits) on a
  timeline; connectors ("iTwin Connectors") sync source formats with provenance
  (`ExternalSourceAspect`).
- **Extension mechanism**: domain schemas layered Core → Common → Discipline-Physical → Domain →
  Application, with rules on what may reference what.
- **Borrow**: (1) **layered schema rules** (core may never depend on a module; modules depend on
  core; app schemas never shared) — mirrors Ekwo modules-in-own-schema; (2) **Code = codespace +
  scope + value** for human ids (e.g. "Storey 02 in Building A"), next to the UUID; (3)
  **ExternalSourceAspect**: one row per (element, source system, source id, checksum, version) to
  make every import idempotent and traceable; (4) federationGuid = stable cross-system UUID;
  (5) Element vs Aspect split (aspects = optional typed attachments, here = module tables keyed on
  the core id).
- **Avoid**: the open-library / closed-cloud dependency (iModelHub, iTwin Platform) — Nexgen's
  persistence must be self-hostable Postgres end to end.

### 2.16 Open Data Cube & QGIS (context)
- **Open Data Cube** (Apache-2.0, 1.9.22): raster time-series cube with *products* (metadata
  type, measurements), *datasets* indexed in Postgres (PostGIS-backed index, `odc` schema), load
  via xarray. Relevant only if Nexgen ingests solar irradiance, LiDAR rasters or EO imagery:
  borrow the "**index metadata in Postgres, keep pixels in cloud-optimised files (COG/Zarr)**"
  rule.
- **QGIS** (GPL-2.0, 3.44 LTR): the natural desktop client for a PostGIS model — the best
  contribution channel for GIS users. Borrow: ship a **QGIS project / plugin** against the Nexgen
  schema early; QGIS's plugin repository (anyone publishes, reviewed light) is a good model for
  community modules. Speckle and 3DCityDB both ship QGIS connectors.

### 2.17 Ladybug Tools / Honeybee / Dragonfly — https://github.com/ladybug-tools
- **Licence**: AGPL-3.0 (core libs), schema repo separately licensed; commercial cloud
  (Pollination) by the same founders. Very active (releases weekly).
- **Data model**: Honeybee `Model › Room › Face (type: Wall/Floor/RoofCeiling/AirBoundary,
  boundary_condition: Outdoors/Ground/Surface(adjacent face id)) › Aperture/Door`, with
  `properties.energy` and `properties.radiance` extension namespaces on each object;
  Dragonfly = urban scale: `Building › Story › Room2D` (floor plate polygon + floor-to-ceiling
  height) extruded to Honeybee rooms. **Honeybee JSON schema** (OpenAPI) is the contract between
  Python, .NET and the cloud.
- **Extension mechanism**: Python plugin packages that attach a namespace under `properties`
  (`honeybee-energy`, `honeybee-radiance`); each extension serialises its own sub-dict.
- **Borrow**: (1) **`properties.<module>` namespacing per object** = Nexgen modules attaching
  their own table keyed on the core id, and their own JSON section on export; (2) the
  **Dragonfly Room2D** (footprint + height per storey) as Nexgen's default storey/space geometry —
  cheap and sufficient for energy; (3) face `boundary_condition = Surface(adjacent id)` for
  adjacency; (4) AGPL core + commercial cloud works for them — a direct precedent for Nexgen;
  (5) export Nexgen → Honeybee JSON → OpenStudio/EnergyPlus as a format library.
- **Avoid**: Grasshopper/Rhino-first UX lock-in for authoring.

### 2.18 OpenStudio / EnergyPlus / URBANopt / BuildingSync (NREL, now NatLabRockies org)
- EnergyPlus 26.2.0 (2026-09-30) and OpenStudio 3.11 (2026-01-15), BSD-3-style licences with a
  name-use clause; DOE-funded, lab-led governance with industry partners. The GitHub org moved
  from `NREL` to `NatLabRockies` (redirect works).
- **Data model**: OpenStudio Model (C++ SDK over IDF objects): Building › BuildingStory › Space
  (with SpaceType) › Surface › SubSurface; ThermalZone groups spaces; Construction/Material;
  Schedules; HVAC loops. **Measures** = Ruby/Python scripts with declared arguments that
  transform a model (thousands on the Building Component Library); **OSW workflow** chains
  measures. openstudio-standards encodes ASHRAE 90.1 / NECB / DEER templates **as JSON data
  tables** consumed by generic code.
- URBANopt: district scale, GeoJSON FeatureCollection of buildings/sites → many OpenStudio models.
  BuildingSync: XML schema for audit data (ASHRAE 211), with **use cases** validated by
  Schematron.
- **Borrow**: (1) **"Measure" concept** = a parametrised, reversible transformation of the twin
  (add insulation, add PV, replace boiler) — the natural shape of Nexgen **scenarios**: a
  scenario = base twin + ordered list of measures with arguments; (2) **openstudio-standards'
  "codes as JSON tables + generic engine"** = rules-as-data country packs; (3) URBANopt's
  GeoJSON-feature input as a light district-scale exchange; (4) BuildingSync "use cases" =
  validation profiles per programme (like IDS).
- **Avoid**: running EnergyPlus inside the core; keep simulation as an external module/worker.

### 2.19 Brick Schema — https://brickschema.org (BSD-3)
- v1.4.4 stable; v1.5.0-rc2 out 2026-10-07. Academic/industry consortium (UC Berkeley, CMU, now a
  Brick Consortium), RDF/OWL + SHACL.
- **Data model**: classes for Equipment, Point (Sensor, Setpoint, Command, Status…), Location
  (Site, Building, Floor, Room, Zone), relationships `hasPart`, `isPartOf`, `feeds`, `hasPoint`,
  `isPointOf`, `hasLocation`; **entity properties** and **tags** compatible with Haystack;
  units via QUDT; external references (`ref:hasExternalReference` → BACnet, time-series id).
- **Extension mechanism**: RDF extension ontologies; **BuildingMOTIF** (NREL) adds templates +
  SHACL shape libraries to generate and validate models.
- **Borrow**: (1) **Point ↔ Equipment ↔ Location triad** and the `feeds` relation (energy flow
  topology) for Nexgen's asset/meter model; (2) `hasExternalReference` = the link from a point to
  its time-series store — same as CityGML Dynamizer; (3) **export Brick TTL as a format library**,
  not as storage; (4) BuildingMOTIF's template + SHACL validation = how a pack checks a model.
- **Avoid**: making RDF the source of truth in a Postgres-first core.

### 2.20 Project Haystack — https://project-haystack.org (AFL-3.0 defs)
- Haystack 4 defs (v4.0.0, 2025-07); **Haystack 5 with the Xeto schema language** announced at
  Haystack Connect (May 2025): typed specs, inheritance/composition, validation, RDF export.
  Non-profit association; members are BMS vendors (J2 Innovations, SkyFoundry, Siemens…).
- **Data model**: entities = dicts of **tags** (`site`, `equip`, `point`, `sensor`, `temp`,
  `air`…) with `siteRef` / `equipRef` refs; "protos" were the de-facto templates; Xeto makes them
  formal types.
- **Borrow**: (1) a **tag dictionary** on points/assets for search and BMS interoperability
  (Postgres `text[]` with GIN index); (2) the move from free tags to typed specs (Xeto) is a
  warning: start typed; (3) association governance with working groups is effective for vendor
  buy-in.
- **Avoid**: tag-only modelling (ambiguity drove Haystack 5).

### 2.21 SAREF4BLDG — https://saref.etsi.org/saref4bldg (ETSI TS 103 410-3)
- v2.1.1 (2025-04-24), ETSI SmartM2M; derived from IFC but limited to devices/appliances in
  buildings, aligned with the SAREF core (Device, Function, Command, Measurement, Property).
  EU-relevant (Smart Readiness Indicator, data spaces).
- **Borrow**: device ↔ function ↔ measurement vocabulary for the EMS/meter side and an export
  mapping for EU data-space connectors; ETSI's forge (labs.etsi.org) with permanent versioned IRIs.
- **Avoid**: duplicating its depth in core; map to it.

### 2.22 ASHRAE 223P — https://open223.info
- Semantic model for building systems (RDF + SHACL) — connection points, connectables, media,
  domain spaces; second publication public review April 2026, NIST says publication in FY26, not
  published yet. Brick 1.4+ aligns with it.
- **Borrow**: the **connection-point topology** (equipment have typed in/out connection points
  carrying a medium: electricity, water, air) for Nexgen asset flows (PV → inverter → meter →
  grid). Watch the final publication.

---

## 3. Important additions (2025-2026)

- **Overture Maps Foundation — buildings theme + GERS** (schema v2.0.0, 2026-09-02; CC-BY-4.0
  schema; Linux Foundation project backed by Amazon, Meta, Microsoft, TomTom, Esri).
  Buildings + building parts with heights, levels, roof shape (S3DB-compatible), sources per
  property. **GERS (Global Entity Reference System)**: stable entity ids that persist across
  releases, with changelogs and a bridge to source ids.
  → Borrow GERS as the model for Nexgen's **public identifiers of buildings/places** (stable
  UUID, never reused, change log, `sources[]` with per-property provenance), and store the
  Overture GERS id as an external identifier on Nexgen buildings for free cross-referencing.
- **3DBAG / roofer** (TU Delft + 3DGI; roofer v1.0.0 April 2026, GPL-3.0; pipeline Apache-2.0):
  automatic LoD1.2, LoD1.3 and LoD2.2 reconstruction of every Dutch building from AHN LiDAR +
  BAG footprints, published as CityJSON/3D Tiles/GPKG.
  → Borrow the **refined LoD scheme (Biljecki: LoD x.y)** — LoD1.2 (flat block), LoD1.3 (block
  with height jumps), LoD2.2 (roof shapes with superstructures) — as a precise `lod` codelist;
  and roofer as an external module to generate roof surfaces where no BIM exists.
- **IFC5 / IFCX** (above): JSON + USD-like layering — directly informs scenarios-as-overlays.
- **buildingSMART Validate + Gherkin rules** (MIT, v1.0.5 2026-09-30): rules-as-tests.
- **Brick 1.5 (rc, Oct 2026), Haystack 5 Xeto, ASHRAE 223P**: semantic models are converging;
  pick one internal model and map to all three via exports.
- **Hypar Elements** (MIT, C#): code-first building elements + "functions" generating models —
  a good example of a typed, MIT element library.
- **PMTiles** (spec CC0): single-file cloud-native tile archives, self-hosted on any object store —
  ideal for Nexgen 2D layers; pairs with MapLibre/deck.gl.
- **OpenUSD / AOUSD** (Pixar, Apple, NVIDIA, Autodesk alliance; Modified Apache 2.0): not
  inspected in depth; its layer composition is what IFC5 borrows.

Projects slowing down, worth noting as cautionary: **OSM Buildings** viewer (no release since
2018), **BIMserver** (AGPL, last release mid-2025) — both server-centric BIM platforms without a
sustainable business or institution behind them.

---

## 4. Synthesis — what Nexgen OS should borrow

### 4.1 Core table shape (Postgres, `nexgen` core schema)
Typed core tables for the stable spine, a generic table for the long tail:

```
facility        (id uuid, kind: site|building|bridge|..., code, identifier jsonb[], parent_id, geom geometry(MULTIPOLYGONZ), ...)
storey          (id, facility_id, code, elevation, height, ordinal)
space           (id, storey_id|facility_id, kind, footprint geometry(POLYGONZ), height)       -- Dragonfly Room2D shape
surface         (id, semantic: roof|wall|ground|floor|ceiling|closure|window|door,
                 geom geometry(POLYGONZ), tilt, azimuth, area, space_id, adjacent_space_id) -- CityGML space/boundary duality
asset           (id, class_uri, location_id, parent_asset_id)                               -- Brick equipment
point/meter     (id, asset_id, quantity, unit, timeseries_ref)                              -- Brick point + CityGML Dynamizer
representation  (id, object_id, lod text, kind, geom, source_id)                            -- several LoDs per object (3DCityDB val_lod)
pset_value      (object_id, pset_uri, property_uri, value jsonb, unit, valid_from, valid_to, source_id)
external_ref    (object_id, codespace, value, source_version, checksum)                     -- iTwin ExternalSourceAspect + CityGML identifier_codespace
class / property_def / codelist (uri, publisher, dictionary, version, ...)                  -- bSDD dictionary + 3DCityDB objectclass
```

Modules (energy, thermal, EMS, compliance…) own their schema and attach rows keyed on core ids
(Honeybee `properties.<module>`, iTwin aspects). Core never references a module (iTwin layering).

### 4.2 Identifiers
- Internal: UUID (v7) per object, never reused (GERS, iTwin federationGuid).
- Human code: `codespace + scope + value` (iTwin Code), e.g. storey "02" in building "A".
- External: `(codespace, value)` pairs for cadastre, BAG, BE CRAB/BOSA address id, EAN meter id,
  Overture GERS, IFC GlobalId (derived from the UUID on export).
- Dictionary items: namespaced versioned URIs `<publisher>/<dictionary>/<version>/<code>` (bSDD).
- Immutable blobs (meshes, imported files): content hash (Speckle).

### 4.3 Level of detail
- Semantic LoD as a codelist on each representation: CityGML 0-3 refined to Biljecki x.y
  (LoD1.2, 1.3, 2.2), interiors allowed at any LoD (CityGML 3.0).
- Parametric "S3DB" description (footprint + heights + roof shape) as a first-class LoD so most
  buildings get a 3D shape from data alone.
- Streaming LoD (geometric error) is a format-library concern (3D Tiles), not core.
- Information need (EN 17412-1 / IDS) expressed as requirement sets, not as a geometry LoD.

### 4.4 Property sets and rules as data
- Pset/Qto mechanism from IFC with bSDD-style dictionaries; type-level values inherited by
  occurrences.
- Country packs = dictionaries + IDS-like requirement sets + standards tables (openstudio-standards
  pattern) + fixtures that must pass/fail (buildingSMART Gherkin rules). Each rule has an id.

### 4.5 Scenarios
- Scenario = base twin version + ordered **measures** (OpenStudio) applied as an **override layer**
  (IFC5/USD composition), materialised on demand; versions are immutable snapshots (Speckle).

### 4.6 Formats (organised by format, MIT libraries)
IFC (via IfcOpenShell, LGPL), CityJSON / CityGML, 3D Tiles + glTF, GeoJSON / URBANopt features,
Honeybee JSON → OpenStudio/EnergyPlus, Brick / 223P / Haystack / SAREF exports, IDS, BuildingSync,
PMTiles. One library per format, each with round-trip fixtures.

### 4.7 Licence and governance
- AGPL core + MIT formats is validated by precedent: Ladybug Tools (AGPL + Pollination cloud),
  xeokit (AGPL + commercial), That Open (MIT toolkit + MPL engine + paid platform).
- Specs and dictionaries: CC0 or CC BY 4.0 (CityJSON CC0, Overture CC-BY), **not CC BY-ND**
  (buildingSMART) which forbids forks and translations.
- Contribution: DCO, not CLA (keeps contributors) — unless dual licensing is wanted, in which case
  decide before the first external PR (xeokit model).
- Packs and dictionaries contributed like QGIS plugins / bSDD dictionaries: anyone publishes under
  their namespace; "official" status via review + passing tests.
- Pin a neutral home later (OGC community standard like CityJSON/3D Tiles, or a foundation like
  Overture/LF) once external adopters exist.

### 4.8 Things to avoid
1. Full EAV core (3DCityDB v5 trade-off) — hurts PostgREST/Supabase consumers.
2. Schemaless objects (Speckle Base) and tag-only semantics (Haystack 4).
3. Persisting file-local ids (IFC STEP `#id`) or vendor-cloud ids as primary keys.
4. RDF or IFC as storage; they are exchange formats.
5. Vendor-hosted runtime dependencies (Cesium ion, iTwin Platform, bSDD API at runtime).
6. Frequent breaking API rewrites (That Open v1→v3).
7. Spec licences forbidding derivatives (CC BY-ND).
8. A product name built on another project's trademark (BlenderBIM → Bonsai).

---

## 5. Sources
- GitHub API (`gh api repos/<owner>/<repo>`, `/releases/latest`, `/license`, `/readme`) for all
  repositories in section 1, read 2026-10-12.
- 3DCityDB v5 schema: https://github.com/3dcitydb/3dcitydb/blob/master/postgresql/sql-scripts/schema/schema.sql
- OSM Simple 3D Buildings: https://wiki.openstreetmap.org/wiki/Simple_3D_Buildings
- IFC5 development: https://github.com/buildingSMART/IFC5-development
- IFC 4.3: https://github.com/buildingSMART/IFC4.x-development , https://www.iso.org/standard/84123.html
- bSDD: https://github.com/buildingSMART/bSDD
- SAREF4BLDG v2.1.1: https://saref.etsi.org/saref4bldg
- ASHRAE 223P status: https://www.energy.gov/cmei/buildings/ashrae-standard-223p , https://www.nist.gov/node/1648991
- Haystack 5 / Xeto: https://marketing.project-haystack.org/project-haystack-media/press-releases/project-haystack-unveils-haystack-5-with-xeto-schema-language-and-rdf-integration-at-haystack-connect-2025
- Data-model descriptions of IfcOpenShell, That Open, xeokit, Speckle, CityJSON, CityGML 3.0,
  3D Tiles, iTwin.js BIS, Honeybee/Dragonfly, OpenStudio, Brick and GERS come from the projects'
  documentation as known at the research date; the GitHub figures above are the only items
  re-measured today.
