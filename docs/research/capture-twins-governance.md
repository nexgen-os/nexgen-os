# Nexgen OS: lessons from reality capture, digital twins, urban platforms and open-source governance

*Research note, 12 October 2026. Activity figures (stars, last push, latest release) were read from the GitHub API on 12/10/2026. Governance and specification facts come from the projects' own sites, cited inline. Where a fact could not be verified, the text says so.*

Nexgen OS is a Postgres-first core describing places, buildings, spaces, surfaces, assets, parties, meters/time series and scenarios in 3D (PostGIS). Modules plug in as their own schemas, and country rules ship as data packs. It follows the Ekwo OS playbook: a deterministic core with no AI calls, AGPL core, and MIT format libraries.

The question for each project below is the same: what to borrow, and what to avoid.

---

## 0. Summary table

| Project | Licence | Stars | Latest release (date) | Last push | Relevance to Nexgen OS |
|---|---|---|---|---|---|
| OpenDroneMap ODM | AGPL-3.0 | 6 520 | v3.6.2 (2026-08-12) | 2026-09-16 | Drone imagery to DSM, orthophoto, mesh, point cloud: an input pipeline |
| WebODM | AGPL-3.0 | 4 213 | v3.3.0 (2026-09-05) | 2026-10-09 | AGPL product with a hosted paid tier (webodm.net) |
| NodeODM | AGPL-3.0 | 305 | v3.6.2 (2026-09-24) | 2026-09-24 | Small REST processing-node API |
| OpenSfM | BSD-2 | 3 807 | v0.5.1 (2020-08-11) | 2026-10-05 | SfM library; active code, no release since 2020 |
| COLMAP | BSD-3 ("new BSD") | 12 894 | 4.2.1 (2026-09-29) | 2026-10-12 | Reference SfM/MVS |
| Potree | BSD-2 | 5 636 | 1.8.2 (2023-12-12) | 2026-01-08 | Web point-cloud viewer; slowing down |
| PDAL | BSD | 1 422 | 2.10.2 (2026-06-12) | 2026-10-09 | "GDAL for point clouds", pipeline JSON, pgpointcloud |
| Entwine | LGPL-2 | 530 | 3.2.1 (2025-10-15) | 2026-06-02 | EPT octree indexing |
| COPC spec | MIT (site) | 141 | COPC 1.0 | 2026-08-18 | Cloud-optimised LAZ: one file, HTTP range reads |
| Open3D | MIT | 14 071 | v0.20.0 (2026-09-16) | 2026-09-30 | Geometry processing library |
| CloudCompare | GPL-2 (core lib LGPL) | 4 795 | v2.13.2 (2024-07-11) | 2026-10-12 | Desktop point-cloud tool, plugin system |
| CesiumJS | Apache-2.0 | 15 823 | 1.146 (2026-10-01) | 2026-10-11 | Open client, paid ion cloud |
| 3D Tiles spec | CC-BY (spec), OGC Community Standard | 2 619 | 1.1 (2023-06-05) | 2026-10-06 | Streaming format for 3D |
| pg2b3dm | MIT | 495 | v2.28.0 (2026-10-01) | 2026-10-01 | PostGIS to 3D Tiles: direct ion alternative |
| deck.gl | MIT | 14 652 | (monthly) | 2026-10-11 | WebGL layers, OpenJS |
| kepler.gl | MIT | 12 042 | v3.3.0-alpha.16 (2026-10-09) | 2026-10-12 | No-code geo-analytics UI |
| iTowns | CeCILL-B / MIT dual | 1 274 | n/a | 2026-10-08 | IGN France 3D web viewer |
| 3DCityDB | Apache-2.0 | 481 | v5.1.4 (2026-08-25) | 2026-10-09 | CityGML 3.0 in PostgreSQL/PostGIS: closest prior art |
| CityJSON spec | CC0-1.0 | 126 | 2.0.2 (2026-03-27) | 2026-05-12 | JSON CityGML encoding, OGC Community Standard |
| IfcOpenShell / Bonsai | LGPL-3.0 | 2 850 | daily alpha (2026-10-12) | 2026-10-12 | IFC read/write, IDS checking |
| buildingSMART IDS | (buildingSMART) | 324 | v1.0.0 (2024-06-03) | 2026-09-25 | Machine-readable information requirements |
| Speckle server | Apache-2.0 | 848 | 2.31.14 (2026-06-15) | 2026-10-07 | Object-versioned AEC data |
| FROST-Server | LGPL-3.0 | 227 | v2.8.1 (2026-09-06) | 2026-10-09 | OGC SensorThings implementation |
| OGC SensorThings | OGC | 169 | 1.1 published; 2.0 being finalised | 2026-10-12 | Sensor/observation model |
| Orion (NGSIv2) | AGPL-3.0 | 223 | 4.7.0 (2026-06-24) | 2026-10-06 | FIWARE context broker |
| Orion-LD (NGSI-LD) | AGPL-3.0 | 69 | 1.12.0 (2026-01-28) | 2026-09-25 | ETSI NGSI-LD broker |
| Smart Data Models | CC-BY-4.0 models | 148 (106 repos in org) | continuous | 2026-10-09 | Contribution process for data models |
| Eclipse Ditto | EPL-2.0 | 936 | 3.9.8 (2026-10-08) | 2026-10-08 | Digital twin "Thing" with features |
| Eclipse BaSyx (AAS) | MIT | 85 (Java) / 105 (Python) | 2.0.0-M15 / 2.2.0 | 2026-10-12 | Asset Administration Shell |
| Eclipse Hono | EPL-2.0 | 500 | 2.7.0 (2026-02-16) | 2026-10-12 | Device connectivity |
| OpenRemote | AGPL-3.0 | 1 920 | 1.32.0 (2026-10-12) | 2026-10-12 | Open IoT/energy asset platform: closest neighbour on the energy side |
| Decidim | AGPL-3.0 | 1 829 | v0.32.1 (2026-07-30) | 2026-10-12 | Participation platform, association plus social contract |
| CONSUL Democracy | AGPL-3.0 | 1 551 | 2.6.1 (2026-10-08) | 2026-10-08 | Participation platform, foundation |
| A/B Street | Apache-2.0 | 8 186 | v0.3.49 (2024-01-09) | 2025-09-10 | Traffic and street-design game; effectively dormant |
| Streetmix | BSD-3 | 748 | none since 2014 | 2026-10-11 | Street cross-section design |
| UrbanSim | BSD-3 | 552 | v3.3 (2026-09-16) | 2026-10-12 | Land-use simulation, open core plus hosted product |
| Open Location Code | Apache-2.0 | 4 361 | 1.0.4 (2019-07-29) | 2026-03-30 | Plus Codes, a free what3words alternative |
| H3 / S2 | Apache-2.0 | 6 586 / 2 730 | v4.5.0 (2026-05-21) / v0.14.0 (2026-04-23) | 2026-10 | Hierarchical cell IDs |
| Mapcode | Apache-2.0 | 12 | v2.4.19 (2026-05-27) | 2026-08-17 | Foundation-held short codes |
| Overture schema | CC-BY-4.0 (schema), MIT (tools) | 219 / 1 170 | schema v2.0.0 (2026-09-02) | 2026-10-11 | Buildings theme, GERS stable IDs |
| PostGIS | GPL-2.0 | 2 243 | 3.6.x (tags on git.osgeo.org) | 2026-10-12 | Our base layer; PSC governance |
| Home Assistant | Apache-2.0 | 91 412 | monthly | 2026-10-12 | Foundation plus commercial-partner model |
| Odoo | LGPL-3 CE / proprietary EE | 54 989 | 19.x | 2026-10-12 | Open-core split |

---

## 1. Drones, photogrammetry and reality capture

### OpenDroneMap (ODM, WebODM, NodeODM)
- **URLs**: https://github.com/OpenDroneMap/ODM, https://github.com/WebODM/WebODM, https://github.com/OpenDroneMap/NodeODM
- **Licence / activity**: all three AGPL-3.0. ODM v3.6.2 (2026-08-12), WebODM v3.3.0 (2026-09-05), NodeODM v3.6.2 (2026-09-24).
- **Data model**: a *task* (an image set plus options) produces *assets*: an orthophoto (COG), DSM/DTM, a LAZ/EPT point cloud, a textured mesh and a report. WebODM adds Project, then Task, then Assets, with permissions.
- **Extension**: NodeODM exposes a small REST API (`/task/new`, `/task/{uuid}/info`, `/download/{asset}`), so any engine that implements it plugs into WebODM ("ClusterODM" load-balances nodes). WebODM has a Python/JS plugin system.
- **Business model**: AGPL code. Revenue comes from WebODM installers and a hosted processing service (webodm.net), plus support and donations. The lead maintainers run the commercial side themselves; there is no foundation.
- **Borrow**: (1) the **processing-node contract**: a capture module in Nexgen OS should define a tiny, engine-agnostic job API so ODM, COLMAP or a commercial engine (Pix4D, RealityCapture) can be swapped. (2) **Standard outputs only**: COG, COPC/LAZ, glTF/3D Tiles. The core stores references plus a footprint and quality metadata, never proprietary blobs. (3) AGPL plus paid installers/hosting works for a niche tool.
- **Avoid**: storing heavy rasters and point clouds in Postgres rows. ODM keeps them as files and only metadata in the database; Nexgen OS should do the same (object storage plus a registry table).

### OpenSfM and COLMAP
- **URLs**: https://github.com/mapillary/OpenSfM (BSD-2, last *release* v0.5.1 in 2020, code still pushed 2026-10-05); https://github.com/colmap/colmap (BSD-3, 4.2.1 on 2026-09-29, 12.9 k stars).
- **Data model**: cameras (intrinsics), images (poses), 3D points with tracks, the classic reconstruction graph. COLMAP stores it in an SQLite database plus binary model files.
- **Extension**: libraries with Python bindings (pycolmap); feature extractors and matchers are pluggable.
- **Governance**: COLMAP is maintainer-led (ETH/academic origin) and permissively licensed, which is why every commercial and research stack embeds it. OpenSfM was a Meta/Mapillary project; since Meta's interest faded, the code lives on without releases.
- **Borrow**: permissive licensing for *libraries* maximises embedding, which confirms the Ekwo "formats and libraries in MIT" rule. COLMAP's reconstruction schema (camera, image pose, point) is a good template if Nexgen OS ever stores capture campaigns: `capture_campaigns`, `capture_images` (pose, intrinsics, time), linked to `places`.
- **Avoid**: OpenSfM's trajectory, a corporate-sponsored repo with no foundation and no release discipline once the sponsor leaves. Releases must be decoupled from any one company.

### Potree
- **URL**: https://github.com/potree/potree. BSD-2, 1.8.2 (2023-12-12), last push 2026-01-08. Development has largely moved to Potree 2 / research prototypes.
- **Data model**: an octree of point chunks (its own format, plus EPT/COPC readers).
- **Borrow**: nothing at the model level. Use it, or newer COPC viewers, as a client only.
- **Avoid**: depending on a single-maintainer viewer for the core UI. Keep the viewer replaceable behind standard formats (COPC, 3D Tiles).

### PDAL, Entwine (EPT) and COPC
- **URLs**: https://github.com/PDAL/PDAL (BSD, 2.10.2 on 2026-06-12), https://github.com/connormanning/entwine (LGPL-2, 3.2.1 on 2025-10-15), https://copc.io (COPC 1.0 spec, MIT site repo).
- **Data model**: PDAL works with *point views* (columnar dimensions such as X, Y, Z, Intensity, Classification…) flowing through a *pipeline* of readers, filters and writers declared in JSON. EPT is a directory octree; COPC is a single LAZ 1.4 file whose chunks are octree-ordered, readable via HTTP range requests. PDAL also writes to PostgreSQL `pgpointcloud` patches.
- **Extension**: drivers as plugins (readers, writers, filters), and declarative pipeline JSON.
- **Governance/business**: Hobu Inc. (Howard Butler) maintains it and sells consulting. COPC was written by Hobu and Rapidlasso and adopted by USGS, QGIS and PDAL. A single, simple, free spec displaced heavier formats in about two years.
- **Borrow**: (1) **COPC as the canonical point-cloud storage format**, with the core holding only a `point_clouds` registry row (URI, CRS, bbox3d, point count, classification schema, capture date, source). (2) The **declarative pipeline-as-data** idea, for processing recipes that are stored, versioned and replayable. This fits the deterministic-core rule. (3) The COPC story itself: a small spec with a permissive licence and reference readers in several languages wins adoption. That is exactly the plan for the Nexgen MIT format libraries.
- **Avoid**: pgpointcloud for large captures. It works, but object storage plus COPC scales better and keeps Postgres lean.

### Open3D and CloudCompare
- **Open3D**: https://github.com/isl-org/Open3D. MIT, v0.20.0 (2026-09-16), 14 k stars. Point cloud, mesh, voxel and RGB-D processing (registration, segmentation, plane detection). Use it as a library for derived products such as roof plane extraction or façade segmentation.
- **CloudCompare**: https://github.com/CloudCompare/CloudCompare. GPL-2 application with an LGPL core library (CCCoreLib); last release v2.13.2 (2024-07-11), code active daily. Its plugin architecture ("qPlugins", including standard, IO and GL plugins) is what keeps it alive with a small core team.
- **Borrow**: CloudCompare's split between an LGPL algorithm library and a GPL application. It is the same pattern as Ekwo (permissive library, copyleft product). Use Open3D (MIT) for surface extraction in a **non-core module**, so algorithms that are heuristic or ML-flavoured stay out of the deterministic core.
- **Avoid**: CloudCompare-style release droughts. Users judge health by releases, not commits.

### 3D Tiles and Cesium ion alternatives
- **3D Tiles**: https://github.com/CesiumGS/3d-tiles. Spec 1.1 (2023), adopted as an OGC Community Standard. CesiumJS (Apache-2.0, 1.146 on 2026-10-01) is open, while the tiling *pipeline* is commercial in Cesium ion (now owned by Bentley Systems, a fact worth re-checking before any public claim).
- **Open alternatives for the tiling step**: **pg2b3dm** (Geodan, MIT, v2.28.0 on 2026-10-01) generates 3D Tiles directly from PostGIS tables. **py3dtiles** (Oslandia, Apache-2.0, on GitLab) handles point clouds and IFC. **3d-tiles-tools** (CesiumGS, Apache-2.0) covers conversion and validation. **3DCityDB v5** exports CityGML/CityJSON and visualisation formats from PostgreSQL. **iTowns** (IGN) and **Giro3D** (Oslandia, GitLab) are open viewers, and **deck.gl** (MIT, OpenJS) has a Tile3DLayer.
- **Borrow**: the "Postgres is the source, 3D Tiles is a cache" pattern of pg2b3dm. Nexgen OS buildings and surfaces in PostGIS can be served as 3D Tiles on demand without ion. Ship a `nexgen-3dtiles` exporter in MIT.
- **Avoid**: making the hosted tiler the only practical path (the ion model). Nexgen (WeSmart's product) can host tiling, but the open path must remain complete.

### 3DCityDB, CityJSON and the 3DBAG (closest prior art for the core)
- **3DCityDB**: https://github.com/3dcitydb/3dcitydb. Apache-2.0, v5.1.4 (2026-08-25). Version 5 maps CityGML 3.0 onto a *generic* PostgreSQL/PostGIS schema (`feature` plus `property` tables with a metadata-driven type system) instead of one table per class, and supports versioning and Application Domain Extensions (ADEs) as metadata. Governance: TU Munich, VCS and Virtual City Systems, with commercial support from the latter.
- **CityJSON**: https://github.com/cityjson/specs. CC0-1.0, 2.0.2 (2026-03-27), an OGC Community Standard. Its *Extensions* mechanism is a JSON-schema file declaring new city objects (`+NoiseBarrier`) and new attributes, validated by `cjval`.
- **3DBAG** (TU Delft / 3DGI, https://3dbag.nl, pipeline Apache-2.0): every Dutch building in LoD 1.2/1.3/2.2, keyed on the national BAG building ID, with yearly releases.
- **Borrow**: (1) CityGML 3.0's **space/surface split** (`Space` vs `Boundary surface`, `Building`, `BuildingPart`, `Storey`, `BuildingRoom`, `ThematicSurface` such as `RoofSurface`), as the conceptual backbone for `places`, `buildings`, `spaces` and `surfaces`. (2) **CityJSON's `+`-prefixed extension schemas** as the model for country packs and modules adding attributes. (3) 3DBAG's discipline of **keying on the authoritative national ID** (BAG, CaBu/CRAB in Belgium, RNB in France) and keeping it alongside our own UUID.
- **Avoid**: 3DCityDB's fully generic EAV-style storage for the *operational* core. It is flexible but hard to query and to protect with RLS. Keep typed tables for hot entities and use an extension JSONB column validated by a pack schema for the rest.

### BIM side: IfcOpenShell, buildingSMART IDS, Speckle
- **IfcOpenShell / Bonsai**: https://github.com/IfcOpenShell/IfcOpenShell. LGPL-3.0, daily releases. Reads and writes IFC2x3/4/4.3 and includes `ifctester` for **IDS** (Information Delivery Specification, buildingSMART v1.0, 2024-06), the XML standard for "this model must contain property X on class Y".
- **Speckle**: https://github.com/specklesystems/speckle-server. Apache-2.0 server. Object-level, content-addressed (hash-ID) and versioned "commits" of AEC data. Business: hosted Speckle plus enterprise features.
- **Borrow**: IDS is *requirements as data*, the exact shape needed for permitting and compliance packs: facets (entity, attribute, property, classification, material, partOf) with cardinality. Nexgen OS compliance rules can reuse the IDS facet vocabulary for "what data must exist" checks before any calculation. Speckle's **content-addressed immutable objects plus commits** are a good model for scenario snapshots.
- **Avoid**: importing IFC's full schema into the core. Map IFC entities onto core entities via an MIT `nexgen-ifc` library.

---

## 2. Sensors, observations and digital twins

### OGC SensorThings API and FROST-Server
- **URLs**: https://github.com/opengeospatial/sensorthings (spec repo, active 2026-10-12), https://github.com/FraunhoferIOSB/FROST-Server (LGPL-3.0, v2.8.1 on 2026-09-06).
- **Data model** (STA 1.1 Sensing): `Thing`, then `Location` / `HistoricalLocation`, `Datastream` (a Thing x Sensor x ObservedProperty with a `unitOfMeasurement`), `Sensor`, `ObservedProperty`, `Observation` (`phenomenonTime`, `resultTime`, `result`, `resultQuality`, `validTime`), and `FeatureOfInterest`. It is based on OGC/ISO Observations, Measurements and Samples (ISO 19156:2023). STA 2.0 aligns with OData 4.01 and OMS and adds standardised extension points; OGC ran a public comment on it, and a FOSS4G 2026 talk describes it as still to be published in 2026.
- **Extension**: FROST's **data model is itself configurable** ("model loader" JSON definitions, plugins for the STAplus and Tasking extensions), so new entity types can be added without code.
- **Governance**: Fraunhofer IOSB, institute-led, LGPL. OGC SWG for the spec.
- **Borrow**: adopt the OMS/STA vocabulary *directly* for meters and time series. `meters` maps to `Thing` plus `Sensor`, a `datastreams` table carries unit and observed property, `observations` carries `phenomenon_time` (a range, essential for interval energy data) and `result_time` separately, and `feature_of_interest` points to a place, space or asset. Keep `resultQuality` and a `validTime`, so estimated, corrected or validated reads (standard practice for grid operators) are first-class. Expose an **STA-compatible read API** from Postgres as a module; it costs little and buys interoperability with the EU INSPIRE "good practice" (STA is an INSPIRE good practice).
- **Avoid**: OData's query complexity in the core API. Offer STA as an adapter, not the canonical interface.

### FIWARE: NGSI-LD, Orion / Orion-LD and Smart Data Models
- **URLs**: https://github.com/telefonicaid/fiware-orion (AGPL-3.0, 4.7.0 on 2026-06-24), https://github.com/FIWARE/context.Orion-LD (AGPL-3.0, 1.12.0 on 2026-01-28), https://github.com/smart-data-models (106 public repos), ETSI GS CIM 009 **V1.9.1 (2025-07)** for NGSI-LD.
- **Data model**: NGSI-LD *Entity* (URI id, `type`), then *Property* / *Relationship* / *GeoProperty*, each with `observedAt`, `unitCode`, `datasetId` (multi-instance attributes), plus *scope* (hierarchical tags) and a temporal API. JSON-LD `@context` maps short names to IRIs.
- **Extension**: domain models from the Smart Data Models catalogue: subject repos (`dataModel.Building`, `dataModel.Energy`, `dataModel.WaterNetworkManagement`…), each with `schema.json`, examples, `ADOPTERS` and `CONTRIBUTORS.yaml`.
- **Governance**: FIWARE Foundation e.V. (non-profit, founded 2016) has a Board, a Technical Steering Committee and Mission Support Committees; its Platinum members are Atos, Engineering, NEC, Red Hat, Telefónica and Trigyn, and it reports 49 iHubs. The Smart Data Models program (FIWARE, TM Forum, IUDX, OASC) publishes:
  - a **contribution agreement** (contributors grant rights so models are released under CC-BY-4.0, with attribution in `CONTRIBUTORS.yaml`);
  - a **versioning rule**: SemVer, *"once a versioned data model has been released, the contents of that version MUST NOT be modified"*; a patch can be approved by the subject admin; a minor version (adding any optional property) by the subject admin, notified to the domain admin; a major version (breaking) by the management;
  - the **Agile Standardization Manifesto**: do not reinvent the wheel, normalise real cases only, be open, don't be overly specific (few mandatory attributes), **flat not deep**, sustainability.
- **Borrow**: this is the best template for **Nexgen OS country packs and module schemas**: one repo or folder per subject, JSON Schema as the source of truth, generated docs and examples, `ADOPTERS` / `CONTRIBUTORS` files, a signed contribution agreement, SemVer with *immutable released versions*, and tiered approval (subject → domain → steering). Also borrow NGSI-LD's **`observedAt` and `datasetId` on properties**: every attribute value can carry provenance and a time, which suits multi-source building data. Publish a JSON-LD `@context` for core entities so Nexgen OS data can be emitted as NGSI-LD and Smart Data Models (`Building`, `EnergyCIMDataModel`…) through an adapter.
- **Avoid**: (1) the broker-centric architecture. Orion is a separate store with its own query language, and Postgres-first is simpler and stronger. (2) The FIWARE "catalogue of many generic enablers" sprawl: too many components with uneven maintenance (Orion-LD has 69 stars despite being the reference broker). (3) Ultra-flat models that duplicate data. Nexgen OS keeps relational integrity and *emits* flat views.

### Eclipse Ditto, BaSyx (Asset Administration Shell) and Hono
- **URLs**: https://github.com/eclipse-ditto/ditto (EPL-2.0, 3.9.8 on 2026-10-08), https://github.com/eclipse-basyx/basyx-java-server-sdk (MIT, 2.0.0-milestone-15 on 2026-07-30), https://github.com/eclipse-hono/hono (EPL-2.0, 2.7.0 on 2026-02-16).
- **Ditto data model**: a `Thing` (namespaced ID `org.example:my-thing`, `policyId`, `definition`, `attributes`) with `features`, each holding `properties` and `desiredProperties` (desired vs reported state), and a `definition` referencing a **W3C WoT Thing Model** URL. A *revision* number and *modified* timestamp sit on every Thing; history comes from the event-sourced journal.
- **AAS (BaSyx)**: an *Asset Administration Shell* references *Submodels* (Nameplate, TechnicalData, TimeSeries, CarbonFootprint…), whose templates are standardised by IDTA. Every element carries a `semanticId` (an IRI or ECLASS IRDI).
- **Governance**: Eclipse Foundation projects use the **Eclipse Contributor Agreement** (a lightweight CLA plus DCO-style sign-off), a formal release review, and an IP due-diligence process; the Eclipse IoT / Digital Twin working groups provide industrial members. IDTA (Industrial Digital Twin Association) governs AAS submodel templates.
- **Borrow**: (1) **desired vs reported** state on controllable assets: essential for EMS setpoints (battery, charger, heat pump), stored as two JSON documents with timestamps. (2) **`semanticId` on every typed property**, pointing to an external dictionary (ECLASS, IFC, Smart Data Models, Brick). This is how a country pack attribute declares what it means. (3) Per-entity **revision counters** plus an append-only event table for versioned entities. (4) AAS submodel templates such as *Nameplate*, *TechnicalData* and *CarbonFootprint* for physical assets (PV inverter, battery), so we do not invent our own.
- **Avoid**: Ditto's MongoDB plus Akka cluster stack and policies-as-documents. Postgres RLS does this more simply. Also avoid AAS's verbosity in the core API; support it through an import/export library.

### Digital-twin ecosystems (Linux Foundation, Eclipse)
- **Linux Foundation**: Overture Maps (see section 4) is the LF data project of note. LF Energy hosts energy projects (OpenEEmeter, SEAPATH, PowSyBl, CoMPAS) with a **TAC plus project-lifecycle stages** (sandbox → incubation → graduated). There is no single "LF digital twin" platform; the Digital Twin Consortium is an OMG program, not code. *Not verified in this pass: current LF Energy project list; re-check before citing.*
- **Eclipse**: Ditto, BaSyx, Hono and the Eclipse IoT / Digital Twin working groups. A working group is a funded member body sitting *above* projects, which is a useful pattern for a later "Nexgen OS Working Group" of utilities and municipalities.
- **OpenRemote**: https://github.com/openremote/openremote. AGPL-3.0, 1.32.0 (2026-10-12), 1.9 k stars. An open IoT/energy-management platform (assets with typed attributes in PostgreSQL, rules, an EMS optimisation module), run by OpenRemote Inc. with paid support and hosting. **This is the nearest open-source neighbour to Nexgen OS's energy modules** and is worth a dedicated comparison: its asset model is a tree of typed `Asset` objects with `AttributeMap`s and meta-items, all in Postgres JSONB.
- **Borrow**: the lifecycle stages (sandbox / incubating / graduated) for third-party Nexgen modules and packs. Learn from OpenRemote's positioning (AGPL plus paid hosting, EU utilities).
- **Avoid**: placing Nexgen OS inside a large umbrella foundation too early. Overhead is high and control of the roadmap is diluted; Overture shows the LF route makes sense once several large members co-fund.

---

## 3. Urban planning and public participation

### Decidim
- **URL**: https://github.com/decidim/decidim. AGPL-3.0, v0.32.1 (2026-07-30), active daily.
- **Data model**: an Organization holds *participatory spaces* (processes, assemblies, conferences), and each space holds *components* (proposals, meetings, budgets, surveys, accountability) with steps and phases.
- **Extension**: Ruby gems as **modules**; the core defines spaces and components through a manifest-based registry. Third-party modules (`decidim-module-*`) are catalogued.
- **Governance**: Born at Barcelona City Council and now owned by the **Decidim Free Software Association** (non-profit, General Assembly plus Coordination Committee). Every member signs a **Social Contract** (openness, transparency, traceability, integrity, democratic quality guarantees, privacy and security). The community itself (**Metadecidim**) runs on Decidim, so the roadmap is decided via proposals on the platform. A 2021 agreement with the Generalitat de Catalunya and Barcelona funds sustainability.
- **Borrow**: (1) a **Social Contract** for Nexgen OS: a short, public set of commitments (data stays in the user's Postgres, no AI in the core, open formats, no country-locked features) that any hosting partner must sign. (2) **Dogfooding governance**: run the Nexgen OS roadmap and pack-acceptance votes through the participation module itself. (3) The **space/component manifest**: a module declares the entity types it adds and the UI components it renders, so participation (comments, votes, consultations on a site plan) attaches to any core entity (place, building, scenario).
- **Avoid**: dependency on a single public funder, and slow major-version cycles (still 0.x after nine years), which frightened integrators.

### CONSUL Democracy
- **URL**: https://github.com/consuldemocracy/consuldemocracy. AGPL-3.0, 2.6.1 (2026-10-08). Proposals, debates, participatory budgets, polls, legislation. Born at Madrid City Council; now the **CONSUL Democracy Foundation** offers SaaS and installs for municipalities.
- **Borrow**: the *participatory budget* model (investment projects with geolocation, phases and ballots) as a ready-made pattern for public-participation modules attached to `places`.
- **Avoid**: forking the platform per city. Use configuration over forks, which the pack model already enforces.

### kepler.gl, deck.gl, A/B Street, Streetmix, UrbanSim
- **kepler.gl** (MIT, v3.3.0-alpha.16 on 2026-10-09, 12 k stars, Uber origin, now hosted with deck.gl under the OpenJS Foundation / vis.gl). It is a no-code, map-config-as-JSON analytics UI. **Borrow** the idea that a *map view is a serialisable JSON config* (layers, filters, styles), stored as data so scenarios can be shared and replayed.
- **A/B Street** (Apache-2.0, 8.2 k stars, last release v0.3.49 in 2024-01, last push 2025-09). A brilliant OSM-based street-redesign simulator, now mostly dormant; parts continue as `osm2streets` and the UK *Active Travel England* tools. **Lesson**: one-person projects need institutional adopters early. A useful piece is `osm2streets`, which derives lane-level geometry from OSM.
- **Streetmix** (BSD-3, active code, no tagged release since 2014): a street cross-section editor that is good as an embeddable participation widget.
- **UrbanSim** (BSD-3, v3.3 on 2026-09-16): an open simulation library with a commercial hosted product (UrbanSim Inc.). This is the **open model plus paid cloud** pattern again.
- **"Urbanism Next"** is a University of Oregon research centre, not software. The nearest open tool families are the above plus **Cesium/iTowns-based municipal twins** (Helsinki 3D, Rotterdam 3D, Zürich).

### Permitting and compliance as data
- **ACCORD** (Horizon Europe, 2022-2025, VTT-led; https://accordproject.eu): the framework comprises a *rule formalisation tool*, a *ruleset database*, an API, building-permitting and compliance-checking services, combining BIM and GIS through a semantic (knowledge-graph) framework; pilots in Estonia, Finland, Germany, Spain and the UK; deliverable D5.1 (Aug. 2025). Its sibling project **CHEK** worked on the GIS-BIM permitting side. *Detailed formalisation outputs were not retrieved in this pass.*
- **Dutch DSO / Omgevingswet**: the national Digital System for the Environment and Planning Act uses **STOP** (official publication of plans, with legally annotated `Activiteit` and `Locatie` objects) and **STTR/IMTR** (Standard and information model for *applicable rules*: decision trees that the Omgevingsloket turns into questions for citizens). STTR 3.0 is supported since 1 July 2025 (alongside 2.0 and 1.5), and Rijkswaterstaat maintains the standard. The legal plan is the source; applicable rules are a separately versioned, machine-executable layer linked to the same activity and location objects.
- **BLDS** (Building & Land Development Specification, 2015, Accela/Zillow/Civic Insight, permitdata.org): a flat open-data schema for issued permits (permit number, type, status, dates, address, valuation), adopted by about a dozen US counties and cities. Simple and still used for publishing; it does not cover rules.
- **buildingSMART IDS** (see section 1): requirements on model content.
- **Borrow**: (1) **Separate the legal text, the located objects and the executable rule.** DSO's split of STOP (law plus geo-annotations), the activity/location objects, and STTR (versioned decision trees) maps exactly onto *country pack = data*: `pack_legal_sources`, `pack_activities`, `pack_rule_trees` with validity periods. (2) **Rules as decision trees or tables evaluated deterministically**, with every answer traceable to an article. This fits the no-AI core. (3) An IDS-style facet vocabulary for "data required before a check can run". (4) A BLDS-like **flat export** for publishing permit and project statuses.
- **Avoid**: ACCORD-style heavy ontology and knowledge-graph pipelines inside the core. They are hard to maintain and research projects end. Keep formalisation tooling outside; the core only executes versioned rule data.

### Location codes: what3words alternatives
- **Open Location Code / Plus Codes**: https://github.com/google/open-location-code. Apache-2.0, 4.4 k stars. The algorithm is stable (last release tag 1.0.4 from 2019, repo still maintained in 2026). It is free, offline and derivable from coordinates, with no licence fees, unlike what3words (proprietary, patented word list).
- **Mapcode**: https://github.com/mapcode-foundation, Apache-2.0, held by the non-profit Mapcode Foundation (NL). Short, territory-relative codes.
- **H3** (Uber, Apache-2.0, v4.5.0 on 2026-05-21) and **S2** (Google, Apache-2.0, v0.14.0 on 2026-04-23): hierarchical cells for aggregation, not addresses. PostGIS has `h3-pg`.
- **Borrow**: store a **Plus Code as a derived, generated column** on places (human-shareable, no vendor), and use H3 cells for aggregation, privacy-preserving publication and joins with grid data.
- **Avoid**: what3words or any proprietary geocode in core data (licence and lock-in), and using a location code as an *identity* (see the GERS lesson below on the difference between location and identity).

---

## 4. Stable global identifiers: Overture Maps and GERS

- **URLs**: https://github.com/OvertureMaps/schema (CC-BY-4.0 schema, `overture-schema-v2.0.0` on 2026-09-02), https://github.com/OvertureMaps/data (MIT tooling), https://docs.overturemaps.org/gers/
- **Organisation**: Overture Maps Foundation, a Linux Foundation project founded in December 2022 by Amazon Web Services, Meta, Microsoft and TomTom. Monthly releases in GeoParquet.
- **Buildings theme**: `building` and `building_part` (a part links to its parent via `building_id`), with height, number of floors, roof shape and class. The data is **ODbL** (as are base, divisions and transportation); places and addresses carry per-source licences (CDLA-Permissive-2.0, Apache-2.0, CC0, CC-BY-4.0…). Sources include OSM, Esri Community Maps, Microsoft and Google Open Buildings.
- **GERS (Global Entity Reference System)**:
  - The **ID is a random 128-bit UUID** that encodes nothing (no location, no theme). Before the `2025-06-25.0` release, IDs encoded an H3 cell plus a theme byte; Overture *dropped* this, breaking older IDs. That is a lesson in itself.
  - **The registry defines what counts as a GERS ID**: a UUID present in the data is not enough. The registry rows carry `first_seen`, `last_seen` and `last_changed` (guaranteed `first_seen <= last_changed <= last_seen`, never null) plus the feature `version`; a null `path` means "known ID, absent from this release". Base, `building_part` and addresses are currently outside the stability commitment.
  - **Persistence is decided by a per-theme matcher**: buildings by geometry only (IoU > 0.5, so a house-sized footprint moved about 10 m gets a new ID); places by name and geography (a rename can break the ID); road segments by shape, length, class and sources, with attribute-only changes (speed limit…) keeping the ID.
  - **Splits**: at most one piece keeps the ID. **Merges and splits are reported as `removed` + `added` in the changelog with no lineage link**; users must re-match.
  - **Bridge files** map source-dataset IDs (e.g. OSM way IDs, Microsoft footprint IDs) to GERS IDs; a **data changelog** reports per-feature changes between releases.
- **Borrow** (this is the most important section for the Nexgen OS core):
  1. **Opaque UUIDs** for every core entity. Never encode location, type or country in the ID, since Overture paid for doing so.
  2. A **public stability commitment per entity type**, written down: which types have stable IDs and what changes keep or break an identity.
  3. An **`entity_registry`** with `first_seen`, `last_changed`, `last_seen`/`retired_at` and `version`, plus an **append-only changelog** (`added`, `changed`, `removed`).
  4. **Bridge tables (`external_ids`)**: (entity_id, scheme, external_id, valid_from, valid_to), with `scheme` such as `gers`, `osm:way`, `bag`, `crab`, `rnb`, `ean`, `eic`, `cadastral_parcel`. Every Nexgen building should carry its Overture GERS ID and national ID where known; this is what makes the dataset joinable worldwide.
  5. **Do better than Overture on lineage**: record splits and merges explicitly (`entity_lineage(parent_id, child_id, kind, at)`). Overture's lack of lineage is its most-cited weakness, and in buildings, permits and meters (a meter replaced, a building split into units) lineage is legally relevant.
- **Avoid**: identity decided only by geometry for entities that have a legal life (a renovated building keeps its identity even if the footprint changes). In Nexgen OS, identity is *assigned*, not *matched*; matching is only for importing third-party data.

---

## 5. Exemplary governance models

### 5.1 Overture Maps Foundation (Linux Foundation, data consortium)
- **Structure**: an LF "directed fund" with paying members (founders AWS, Meta, Microsoft, TomTom, then Esri and many others) and a Steering Committee plus Technical Steering Committee. Working groups per theme. Schema under CC-BY-4.0, tooling MIT, data ODbL or per-source.
- **Business model**: no hosted product from the foundation. Members monetise in their own products, and the foundation produces the shared reference layer. An ecosystem of "GERS onboarding services" (third-party matchers) is explicitly encouraged.
- **Lesson**: a shared *reference identity layer* is fundable by competitors because none can own it. Nexgen OS's stable building, place and meter IDs could become this for the energy-and-buildings sector, but only once there are several paying members. Until then, a lighter structure fits.

### 5.2 FIWARE Smart Data Models (contribution process)
- **Structure**: FIWARE Foundation e.V. (non-profit; Board, TSC, Mission Support Committees; Platinum members) plus a multi-organisation Smart Data Models program. Models under CC-BY-4.0; contributors sign a contribution agreement and are credited in `CONTRIBUTORS.yaml`; `ADOPTERS` lists deployments.
- **Process**: propose → draft (0.x) → 1.0.0 → immutable SemVer releases; patch and minor approved by subject/domain admins, major by management. Automation-heavy ("velocity in days or weeks"), with a manifesto that insists on *real cases only*, few mandatory attributes, and flat models.
- **Lesson**: this is the exact operating model for **Nexgen OS country packs and module schemas**. Copy it almost verbatim, with JSON Schema and SQL migrations as the artefacts, CI validation, and an `ADOPTERS` file per pack.

### 5.3 Home Assistant and the Open Home Foundation (foundation plus commercial partner)
- **Structure**: since April 2024, Home Assistant, ESPHome, Zigpy and over 250 projects, standards, drivers and libraries are **owned by the Open Home Foundation**, a Swiss non-profit (Stiftung, CHE-416.988.952; president Paulus Schoutsen). Contributors who transfer a project cannot reclaim it, which protects against buy-outs and abandonment. **Nabu Casa** (for-profit, 2018) is the commercial partner: it sells Home Assistant Cloud subscriptions and hardware and funds the foundation; per press reports, the foundation has employed developers directly since 2025 (over 50 full-time staff by its own statements). The three principles are privacy (local control), choice (open standards, local APIs) and sustainability. The code is Apache-2.0.
- **Lesson**: the cleanest model for "**open core owned by a neutral body, hosted product run by a company**". For Nexgen OS: a foundation (or association) owns the AGPL core, the MIT format libraries and the packs; WeSmart / Nexgen (WeSmart's product) is *a* commercial partner (hosting, support, premium modules). The irrevocable transfer clause is what makes municipalities and utilities trust it. Principles map naturally: data in your Postgres (privacy), open formats and country packs (choice), energy and renovation (sustainability).

### 5.4 PostGIS PSC and OSGeo incubation (meritocratic, no company in charge)
- **PostGIS**: a PSC (recent manuals list Paul Ramsey as chair, Regina Obe, Darafei Praliaskouski, Raúl Marín Rodríguez and Sandro Santilli) decides direction, releases, commit access and new members. Per RFC-1, a proposal sits on the dev list for at least two business days and passes with **+2 (including the author) and no −1 veto**; vetoes can be overridden by a majority of all eligible voters; new PSC members need a majority of existing ones. GPL-2.0. Funding comes from companies that employ the developers (Crunchy Data, Paragon…) and sponsors, without a foundation-run product.
- **OSGeo incubation**: a mentor; a review of code, process, communication and transparency; a **code provenance audit**; an OSI licence; a healthy multi-organisation community with an open path into leadership; version control, an issue tracker, documentation and a release process. Graduates get the "OSGeo Project" badge.
- **Lesson**: adopt **a PSC with RFC-1-style lazy-consensus voting from day one**, even with only two WeSmart members on it, and publish the path for outside contributors to join it. Use the OSGeo graduation checklist as the internal quality bar, and apply for OSGeo *community project* status when a second organisation contributes; it is credible in the PostGIS world Nexgen OS lives in.

### 5.5 Odoo (open-core split), as a counter-example to learn from
- **Structure**: Odoo Community under **LGPL-3** and Odoo Enterprise under a **proprietary licence** (Odoo Enterprise Edition License v1.0, a subscription per user). In 2015 (v9) Odoo moved from AGPL to LGPL so proprietary paid modules could depend on the core. The **Odoo Community Association (OCA)**, founded in 2013, kept its modules under **AGPL-3** and negotiated dependency rules with Odoo SA (proprietary modules may not depend on AGPL modules; LGPL and Enterprise modules can depend on each other). The OCA has no access to Enterprise code.
- **Lesson**: the commercial engine is real (partners, an app store), but the licence switch and the closed Enterprise fork **split the community** and created permanent friction. For Nexgen OS: keep the **core AGPL from the start and never relicense it**; put commercial value in *hosting, support, certified packs and premium modules in separate schemas*, not in a closed fork of core features. If a contributor agreement is used, make it a DCO or an inbound=outbound licence (as Ekwo does), not a CLA that lets the company relicense. The CLA is exactly what made Odoo's switch possible and what the community distrusts.

---

## 6. Synthesis: what Nexgen OS should adopt

| # | Decision | Source |
|---|---|---|
| 1 | Opaque UUID IDs, a registry (`first_seen`/`last_changed`/`last_seen`/`version`), an append-only changelog, and a written stability policy per entity type | Overture GERS |
| 2 | `external_ids` bridge table (GERS, OSM, BAG/CRAB/RNB, EAN/EIC, cadastral parcel) with validity periods, plus an explicit **lineage** table for splits and merges (Overture's gap) | Overture GERS, 3DBAG |
| 3 | Meter and time-series model = OMS/SensorThings: datastream (unit, observed property), observation with `phenomenon_time` range, `result_time`, `result_quality`, feature of interest → place/space/asset; STA read adapter as a module | OGC STA / FROST |
| 4 | Each property may carry `observed_at`, `source` and `semantic_id` (IRI to ECLASS/IFC/SDM/Brick); controllable assets get `desired` vs `reported` state; per-entity revision counter | NGSI-LD, AAS, Eclipse Ditto |
| 5 | Country packs and module schemas run like Smart Data Models: JSON Schema source, immutable SemVer releases, tiered approval, contribution agreement, `ADOPTERS`/`CONTRIBUTORS`, a "real cases only, few mandatory fields, flat" manifesto | FIWARE SDM |
| 6 | Spatial backbone from CityGML 3.0 (space vs boundary surface, Building/Part/Storey/Room, thematic surfaces); extensions via CityJSON-style `+`-prefixed schemas; typed tables plus a validated JSONB `ext` column instead of full EAV | CityGML/CityJSON, 3DCityDB |
| 7 | Permitting = legal source, located activity/location objects and versioned executable rule trees, kept separate; IDS-style "required data" facets; BLDS-like flat publication export | Dutch DSO (STOP/STTR), buildingSMART IDS, BLDS |
| 8 | Heavy capture data outside Postgres: COPC for point clouds, COG for rasters, glTF/3D Tiles for meshes; core keeps registry rows; engine-agnostic processing-node API | PDAL/COPC, ODM/NodeODM |
| 9 | 3D delivery: PostGIS → 3D Tiles generated on demand (MIT exporter), no dependency on a proprietary tiler | pg2b3dm, py3dtiles, 3D Tiles |
| 10 | Governance: a foundation owns core plus formats plus packs (irrevocable transfer); WeSmart is the commercial partner (hosting, support, premium modules); a PSC with +2/no-veto voting; OSGeo checklist as the quality bar; a Social Contract; no relicensing CLA | Open Home Foundation, PostGIS, OSGeo, Decidim, Odoo (counter-example) |

### Things to avoid (consolidated)
- Encoding meaning in IDs (Overture had to break them), and identity by geometry matching for legally tracked entities.
- Broker-centric or second-store architectures (Orion, Ditto/MongoDB): Postgres stays the single source.
- Fully generic EAV storage for hot entities (3DCityDB) and knowledge-graph rule engines in the core (ACCORD).
- Hosted-only critical paths (Cesium ion), closed enterprise forks and relicensing CLAs (Odoo).
- Sponsor-dependent projects without a neutral owner or release discipline (OpenSfM, A/B Street, Potree).
- Component sprawl with uneven maintenance (FIWARE catalogue): fewer, well-kept modules.

### Points not verified in this pass (check before quoting publicly)
- The current owner of Cesium ion (Bentley acquisition) and its current pricing.
- The current LF Energy project list, and whether any LF or Eclipse "digital twin" umbrella has launched in 2026.
- ACCORD D5.1 detailed results and the exact licence of its rule-formalisation tools.
- STA 2.0 final adoption date.
- The current PostGIS PSC roster (taken from recent manuals) and the latest PostGIS release number (tags live on git.osgeo.org, not GitHub).

### Main sources
- GitHub API (repo metadata and releases), read 12/10/2026.
- Overture GERS: https://docs.overturemaps.org/gers/, /gers/registry/, /gers/stability/, /attribution/
- Smart Data Models: `contribution-agreement.md`, `versioning.md`, `MANIFESTO.md` in https://github.com/smart-data-models/data-models
- FIWARE Foundation: https://www.fiware.org/foundation/
- NGSI-LD: https://cim.etsi.org/NGSI-LD/official/front-page.html (GS CIM 009 V1.9.1, 2025-07)
- OGC STA 2.0 comment: https://www.ogc.org/requests/ogc-seeks-public-comment-on-proposed-ogc-sensorthings-api-version-2-0/ ; FOSS4G 2026 talk: https://talks.osgeo.org/foss4g-2026/talk/QSFUVY/
- Open Home Foundation: https://www.openhomefoundation.org/about/, https://www.openhomefoundation.org/blog/announcing-the-open-home-foundation/
- PostGIS RFC-1: https://www.postgis.net/development/rfcs/rfc01/ ; OSGeo incubation: https://www.osgeo.org/about/committees/incubation/
- Odoo licences: https://www.odoo.com/documentation/master/legal/licenses.html ; OCA/Odoo licence meeting: https://odoo-community.org/blog/news-1/post/oca-odoo-meeting-on-licenses-21
- Decidim: https://www.decidim.org/about/, https://meta.decidim.org/assemblies/our-governance/f/1756
- ACCORD: https://cris.vtt.fi/en/projects/automated-compliance-checks-for-construction-renovation-or-demoli/
- DSO STTR/IMTR: https://iplo.nl/digitaal-stelsel/aansluiten/standaarden/sttr-imtr/
- BLDS: https://www.govtech.com/data/9-Localities-Commit-to-Open-Data-Standard-for-Construction-Building-Permits.html
