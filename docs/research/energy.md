# Nexgen OS: open-source inspiration from energy management, modelling and smart-building data

Research date: 2026-10-12. Activity figures (stars, last push, latest release) were read from the GitHub API on that date (`gh api repos/...`). The remaining facts come from the official pages cited. "n/v" means not verified. Note: NREL repositories now live under the `NatLabRockies` GitHub organisation, after NREL was renamed the National Laboratory of the Rockies. LF Energy pages already use the new name.

## 0. How to read this

Nexgen OS sits between three worlds:

1. **Edge / device control** (OpenEMS, Home Assistant, evcc, openHAB, EVerest, OCPP CSMS). These systems talk to inverters, batteries and chargers in real time. **Nexgen OS should plug into them, not compete.**
2. **Modelling / simulation** (pvlib, PVGIS, SAM, PyPSA, oemof, EnergyPlus). These are deterministic calculators that take a model and return results. **Nexgen OS should be the system of record that feeds them and stores their scenario outputs.**
3. **Semantics / exchange standards** (Brick, Haystack, SAREF, CIM, OEO, SunSpec, OpenADR, Green Button/ESPI, URPX). They supply vocabularies and wire formats. **Nexgen OS should map onto them through MIT "format" libraries, one format per library, never one country per library.**

The gap none of them fills is the one Nexgen OS is aiming at: **a Postgres-first, 3D-aware, multi-tenant record of places, assets, meters and parties, with jurisdiction rules (sharing keys, tariffs) as tested data packs**. Energy-community tooling in open source is especially thin (see section 7).

---

## 1. Edge EMS and home/building automation

### OpenEMS (FENECON / OpenEMS Association e.V.)
- **URL:** https://github.com/OpenEMS/openems · https://openems.io
- **Licence:** Split licence. **Edge and Backend are EPL-2.0** and the **UI is AGPL-3.0**, as stated in the README. The GitHub API reports AGPL-3.0 for the repository as a whole.
- **Activity:** 1,587 stars; release **2026.10.0** (2026-10-01); monthly calendar-versioned releases; pushed today.
- **Data model:** Everything is an OSGi **Component**: Meter, ESS, EVCS, PV inverter, Controller and so on. Each component exposes typed **Channels** (`ChannelId` with a Unit, an OpenemsType and an access mode). A channel address is `componentId/channelId`, e.g. `_sum/GridActivePower` or `meter0/ActivePower`. "Nature" interfaces (`SymmetricMeter`, `ManagedSymmetricEss`, `Evcs`) define the contract that each vendor driver implements. A `_sum` component aggregates the site.
- **Extension:** OSGi bundles. New hardware is a new bundle that implements a Nature. Controllers run in a scheduler cycle, typically 1 s.
- **Governance and business:** The OpenEMS Association e.V. has members including FENECON, Fraunhofer and utilities. FENECON sells hardware and FEMS apps built on top. Membership pays for governance.
- **Borrow:**
  - The **Nature pattern**: a small set of abstract device contracts (meter, storage, charge point, PV generator, heat pump) with vendor drivers outside the core. In Nexgen OS terms, `core.asset` carries a `nature` enum and a strict channel list per nature.
  - **Signed channel conventions**: `GridActivePower` is positive for import and negative for export. Write one sign convention per quantity into the core and test it.
  - The `_sum` virtual component maps directly to a site-level aggregate view.
  - Licence split: permissive at the edge (EPL), copyleft at the UI. It mirrors the Nexgen OS plan of an AGPL core with MIT format libraries.
- **Avoid:** Re-implementing Modbus drivers or 1-second control loops. Treat OpenEMS Backend as a **data source and setpoint sink**, reached through a connector module that pulls channel history over its JSON-RPC/REST API.

### Home Assistant (energy integration and data model)
- **URL:** https://github.com/home-assistant/core
- **Licence:** Apache-2.0.
- **Activity:** 91,412 stars; release **2026.10.1** (2026-10-10). The Open Home Foundation (non-profit) has held it since 2024; Nabu Casa funds development through Home Assistant Cloud subscriptions and hardware.
- **Data model:**
  - Registry chain: **Area → Device → Entity** (plus Floors and Labels).
  - Every entity has a `device_class` (energy, power, gas, water, monetary…), a `native_unit_of_measurement` and a **`state_class`**: `measurement`, `measurement_angle`, `total` or `total_increasing`. `last_reset` semantics define meter resets.
  - The recorder keeps raw `states`, rolls them into **`statistics_short_term` (5 min)** and **`statistics` (hourly)**, with the columns `metadata_id, start_ts, mean, mean_weight, min, max, last_reset_ts, state, sum`. A **`statistics_meta`** table holds `statistic_id, source, unit_of_measurement, unit_class, has_mean, has_sum, mean_type` (checked in `recorder/db_schema.py`).
  - The Energy dashboard is a configuration that points at grid import/export, solar, battery, gas, water and individual-device statistics.
- **Extension:** Integrations, which are Python packages with config flows, plus HACS for community integrations. Third parties can push external statistics with `recorder.import_statistics` (source ≠ `recorder`).
- **Borrow (high value):**
  - **The `state_class` triple (measurement / total / total_increasing) with explicit reset semantics.** It is the cleanest open model for telling instantaneous power apart from cumulative energy, and it handles meter rollover and replacement. Put `state_class` and `unit_class` on every `core.series`.
  - **A two-tier rollup** stored next to the raw data: short-term (5 min or 15 min, matching the EU settlement period) and hourly. Store `mean/min/max` for measurements and `state + sum` for totals.
  - **The external statistics source**: let an outside system (HA, OpenEMS, a DSO portal) push already-aggregated series, tagged with their `source`.
  - Area/Device/Entity maps to Space/Asset/Point in the Nexgen OS 3D model.
- **Avoid:** Becoming a home-automation hub. The intended direction is a **Nexgen OS ↔ HA bridge** in two parts: an HA custom integration that publishes Nexgen tariffs and community allocations as sensors, and an importer that reads HA long-term statistics. The 91k-star user base is a distribution channel, not a competitor.

### evcc
- **URL:** https://github.com/evcc-io/evcc
- **Licence:** MIT for the code; some vendor templates and the sponsor-token mechanism are under separate terms.
- **Activity:** 7,352 stars; **0.317.1** (2026-10-11); releases several times a week.
- **Data model:** YAML **templates** for meters, chargers and vehicles. A **site** has grid, pv and battery meters and one or more **loadpoints**; each loadpoint has a charger and optionally a vehicle. Charging modes are off / now / minpv / pv. **Tariffs** (grid, feed-in, CO₂, dynamic such as Tibber, ENTSO-E or Octopus) are first-class providers.
- **Extension:** Device **templates as data**: hundreds of YAML device definitions, unit-tested and documented automatically.
- **Business:** A **sponsor token** is required for some chargers, which funds the maintainers through GitHub Sponsors.
- **Borrow:**
  - **"Device = data template with a test"** is the same idea as "country = data pack with a test". Apply it to meters, inverters and chargers in Nexgen OS (`asset_template` rows plus a fixture test).
  - **The tariff provider abstraction** (fixed / time-of-use / dynamic API / CO₂), as a module rather than a core concern.
  - The sponsor-token model is a light way to monetise without closing the code.
- **Avoid:** Implementing PV-surplus charging control. evcc does it for everyone, so expose Nexgen tariffs and community signals for evcc to consume.

### openHAB
- **URL:** https://github.com/openhab/openhab-core
- **Licence:** EPL-2.0.
- **Activity:** core has 1,155 stars and the distro 1,390; milestone **5.3.0.M3** (2026-10-11). Governed by the openHAB Foundation e.V. (non-profit).
- **Data model:** **Thing** (physical device) → **Channel** (capability) → linked to an **Item** (typed state: Number:Power, Number:Energy…). Units come from **JSR 385 (javax.measure / Indriya)**: `QuantityType` carries value plus unit end to end. Semantic model tags: Location / Equipment / Point / Property.
- **Extension:** OSGi add-on bindings, with a marketplace.
- **Borrow:**
  - **Typed quantities in the type system** (`Number:Energy`), which makes the dimension part of the column contract. In Postgres terms, a `quantity_kind` FK on every series, validated against the unit (see QUDT in section 4).
  - **The Location/Equipment/Point/Property tag quartet**, which is essentially Brick-lite and a good minimum viable semantic layer.
- **Avoid:** A Thing/Item duplication. One asset → points relation is enough.

### OpenEnergyMonitor / emoncms
- **URL:** https://github.com/emoncms/emoncms · https://openenergymonitor.org
- **Licence:** AGPL-3.0.
- **Activity:** 1,323 stars; **12.1.7** (2026-10-09). Small UK company: hardware sales (emonPi, emonTx) plus hosted emoncms.org.
- **Data model:** **Inputs** (raw posted values per node) → **process list** (scale, log to feed, power→kWh, accumulate) → **Feeds**. Feed engines **PHPFina** (fixed interval) and **PHPTimeSeries** (variable interval) are flat binary files.
- **Extension:** Modules (apps, graph, sync, device templates).
- **Borrow:**
  - **An explicit, declarative ingestion pipeline**: raw input → ordered processors → stored series. In Nexgen OS this becomes `ingest_rule` rows (scale, offset, unit convert, power-to-energy integration, sign flip), so raw meter feeds stay reproducible.
  - The **fixed-interval vs variable-interval series** distinction (`series.interval` nullable).
  - The model of a small company living from hardware plus hosting around AGPL software. It shows AGPL core + hosted SaaS is viable.
- **Avoid:** Custom binary storage. Postgres plus TimescaleDB, or native partitioning, is enough.

### EMHASS (2025-26 notable)
- **URL:** https://github.com/davidusb-geek/emhass
- **Licence:** MIT.
- **Activity:** 700 stars; **v0.18.5** (2026-10-09).
- **What:** A linear-programming optimiser (PuLP) for PV, battery and deferrable loads, running as a Home Assistant add-on. It consumes forecasts and tariffs and emits schedules.
- **Borrow:** A clean **optimisation-as-a-function** interface: inputs (forecast series, prices, constraints), outputs (schedule series). Nexgen OS "scenario" modules should have the same shape and be deterministic given their inputs.

### FlexMeasures (LF Energy)
- **URL:** https://github.com/FlexMeasures/flexmeasures
- **Licence:** Apache-2.0.
- **Activity:** 212 stars; **v1.0.1** (2026-09-09). Seita BV provides commercial services.
- **Data model:** `GenericAsset` (typed, hierarchical, with JSON attributes and lat/lon) → **Sensor** (unit, event_resolution, timezone, knowledge horizon) → **TimedBelief** (`event_start, belief_time, source, cumulative_probability, event_value`), using the timely-beliefs library. Postgres-based.
- **Borrow (high value):**
  - **The belief model for time series**: every value records *when it was known* (`belief_time`) and *who produced it* (`source`: measured, forecast model X, scenario Y). This one table covers measurements, forecasts, scenarios and corrections without separate tables. Adopt `(series_id, event_start, belief_time, source_id, value)` as the Nexgen OS core time-series key, or at least `source_id` and `recorded_at`.
  - **`event_resolution` on the sensor** (PT15M, PT1H) and the explicit timezone.
  - "flex-model / flex-context" JSON for scheduling constraints.
- **Avoid:** Its Flask monolith. Borrow the schema, not the app.

### OpenRemote, VOLTTRON (adjacent)
- **OpenRemote**: https://github.com/openremote/openremote. 1,920 stars, AGPL-3.0, active. A generic IoT platform with an **Asset/Attribute** model and an energy-optimisation "EMS" asset type; OpenRemote B.V. sells support. **Borrow:** attribute metadata ("meta items") such as `storeDataPoints` or `ruleState`, as JSON on points.
- **VOLTTRON** (PNNL): https://github.com/VOLTTRON/volttron. 503 stars, BSD-style. The Eclipse VOLTTRON successor `eclipse-volttron/volttron-core` is Apache-2.0 and was active on 2026-10-06. It is a building-agent platform; skip it except for its Brick/Haystack-tagged driver configurations.

---

## 2. EV charging stacks

### OCPP CSMS: SteVe, CitrineOS, mobilityhouse/ocpp; EVerest on the charger side
| Project | URL | Licence | Stars / latest | Notes |
|---|---|---|---|---|
| SteVe | github.com/steve-community/steve | GPL-3.0 | 1,136 / steve-3.14.1 (2026-08-12) | Java CSMS for OCPP 1.2–1.6, MySQL schema (`charge_box`, `connector`, `transaction`, `ocpp_tag`). |
| CitrineOS (LF Energy) | github.com/citrineos/citrineos-core | Apache-2.0 | 298 / v2.0.1 (2026-10-06) | TypeScript, OCPP 2.0.1 / 2.1, modular (one module per OCPP functional block), Postgres via Sequelize/Hasura. Backed by S44 Energy. |
| mobilityhouse/ocpp | github.com/mobilityhouse/ocpp | MIT | 1,048 / 2.1.0 (2025-07-16) | Python message library for OCPP 1.6 / 2.0.1, no storage. |
| EVerest (LF Energy) | github.com/EVerest/EVerest | Apache-2.0 | 278 / 2026.02.1 (2026-07-16) | Charger firmware stack (ISO 15118, OCPP client). |

- **Borrow:**
  - CitrineOS **one module per functional block, each with its own data**, is the same architecture as the Ekwo "one schema per module".
  - The **OCPP vocabulary** for charge points: `ChargingStation → EVSE → Connector`, with `Transaction`, `MeterValues` (measurand + unit + phase + context) and `ChargingProfile`. The Nexgen OS EV module should use the OCPP 2.0.1 names exactly.
  - The OCPP `SampledValue` shape (`measurand`, `phase`, `location`, `context`, `unitOfMeasure{unit, multiplier}`) is a good canonical "reading" shape.
- **Avoid:** Writing a CSMS. Connect to CitrineOS (Apache, Postgres) or SteVe, and import sessions and meter values.

---

## 3. Modelling and simulation engines

### pvlib-python
- **URL:** https://github.com/pvlib/pvlib-python
- **Licence:** BSD-3-Clause.
- **Activity:** 1,691 stars; **v0.16.1** (2026-09-26). NumFOCUS-affiliated, with academic and lab maintainers.
- **Data model:** `Location` (lat, lon, tz, altitude) → `PVSystem` with `Array`s (each with `mount` = FixedMount / SingleAxisTrackerMount, `module_parameters`, `temperature_model_parameters`, strings) → `ModelChain` (transposition, AOI, spectral, DC model, inverter model, losses). Weather goes in as a pandas DataFrame (`ghi, dni, dhi, temp_air, wind_speed`).
- **Borrow:**
  - **Array-level geometry** (`surface_tilt`, `surface_azimuth` with the convention 180 = south, `albedo`) attached to a *surface* entity. The Nexgen OS 3D surface table should store pvlib-ready attributes directly so a scenario module can call pvlib without translation.
  - **ModelChain as a recorded recipe**: store the chosen sub-models (e.g. `transposition_model='perez'`, `temperature_model='sapm'`) in the scenario row for reproducibility.
  - Weather column names (`ghi, dni, dhi, temp_air, wind_speed`) as the canonical irradiance series names.
- **Avoid:** Reimplementing irradiance physics in SQL. Call pvlib (Python) or a port from a module worker.

### PVGIS (EU JRC)
- **URL:** https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis · API `https://re.jrc.ec.europa.eu/api/v5_3/<tool>`
- **Licence:** Free public service, EU data policy. The licence text was not reproduced on the API page; it says to check the "Data policy" page.
- **Activity:** **PVGIS 5.3** and 5.2 are live; 5.1 was removed (the unversioned entry point served 5.2 from 25 Sept 2024). Tools: `PVcalc, SHScalc, MRcalc, DRcalc, seriescalc, tmy, printhorizon`. Rate limit 30 calls/s/IP; GET only; no browser CORS/AJAX.
- **Borrow:**
  - Use **`seriescalc` hourly series and `tmy`** as default open weather and production sources in country-agnostic packs.
  - **`printhorizon`** gives a horizon profile per location, which is relevant for 3D shading cross-checks.
  - Cache responses in the database keyed by (lat, lon, params, version). Respect the rate limit with a server-side queue, since browser calls are forbidden.
- **Avoid:** Hard-coding PVGIS as *the* source. It is one `weather_source`/`production_model` provider among others (pvlib + ERA5, Solcast…).

### SAM / SSC / PySAM (NREL → National Laboratory of the Rockies)
- **URL:** https://github.com/NatLabRockies/SAM · `/ssc` · `/pysam`
- **Licence:** BSD-3-Clause.
- **Activity:** SAM 490 stars, release **2026.7.3** (2026-07-07); ssc 96; PySAM 152 (pushed 2026-09-27).
- **Data model:** SSC "compute modules" (`pvsamv1`, `battery`, `utilityrate5`, `cashloan`, `grid`…) take a flat **variable table** of named, typed, unit-annotated inputs (SSC_INPUT/OUTPUT/INOUT with `units` and `meta`) and are chained by sharing that table.
- **Borrow (high value):**
  - **Self-describing module I/O**: each module publishes a manifest of input and output variables with type, unit and constraints. Nexgen OS modules should declare their contract the same way, e.g. `module.manifest` rows, so the core can validate inputs and generate the UI and API.
  - **`utilityrate5` / URDB tariff structure**: energy charge matrices by period × tier, TOU schedules as 12×24 weekday and weekend matrices, demand charges, fixed charges. It is a proven tariff data shape for a "grid tariffs as data" pack.
  - The financial modules (`cashloan`, `singleowner`) are references for scenario economics.
- **Avoid:** SAM's GUI/desktop paradigm.

### PyPSA (+ PyPSA-Eur)
- **URL:** https://github.com/PyPSA/PyPSA
- **Licence:** MIT.
- **Activity:** 2,188 stars; **v1.4.0** (2026-10-09). PyPSA-Eur has 623 stars. Maintained by TU Berlin with Open Energy Transition (a non-profit that does funded consulting).
- **Data model:** A Network of **component tables** (`buses, carriers, generators, loads, links, lines, transformers, storage_units, stores, global_constraints`). Each is a static DataFrame (`p_nom`, `marginal_cost`, `efficiency`, `carrier`…) plus **time-varying `_t` tables** (`generators_t.p_max_pu`, `loads_t.p_set`) indexed by `snapshots` with `snapshot_weightings`. Multi-period investment and **scenarios / stochastic** were added in 1.x.
- **Extension:** Custom constraints via linopy; workflow via Snakemake (PyPSA-Eur).
- **Borrow (high value):**
  - **Static attributes table + `_t` time-varying table per component, sharing one `snapshots` index.** This maps one-to-one to Postgres: `asset` (static) plus `asset_series` (time-varying) keyed by a scenario-scoped `snapshot` set.
  - **Bus / Link / Store / Carrier as a generic energy-flow graph.** "Link" (multi-port conversion with `efficiency`) covers heat pumps, chargers and electrolysers without a new class per technology. A Nexgen OS "energy topology" can be a PyPSA-compatible graph so any site exports to PyPSA for optimisation.
  - **Carrier** as first-class (electricity, heat, gas, H₂) with `co2_emissions`.
  - Attribute metadata (units, defaults, status) published as CSV in the package, which is units-as-data.
- **Avoid:** Running national-scale optimisation inside the database.

### oemof (oemof-solph, TESPy)
- **URL:** https://github.com/oemof/oemof-solph · https://github.com/oemof/tespy
- **Licence:** MIT (GitHub does not auto-detect it for solph).
- **Activity:** solph 422 stars, **v0.6.5** (2026-09-07); TESPy 426 stars.
- **Data model:** Bipartite graph of **Buses** and **Components** (Source, Sink, Converter, GenericStorage) connected by **Flows**. Flows carry `nominal_capacity`, `variable_costs`, `fix`/`max` profiles and an `Investment` object.
- **Borrow:** The **Flow on the edge** (costs and limits live on the connection, not on the node) is a tidy way to model a community where the same PV feeds members under different conditions. The volunteer/academic governance (oemof e.V.-style community and user meetings) is a model for a research-friendly contributor base.

### EnergyPlus / OpenStudio (energy angle only)
- **URL:** https://github.com/NatLabRockies/EnergyPlus · `/OpenStudio`
- **Licence:** BSD-3-style (lab-specific, shown as NOASSERTION on GitHub).
- **Activity:** EnergyPlus 1,589 stars, **v26.2.0** (2026-09-30); OpenStudio 649 stars, **v3.11.0** (2026-01-15). The OpenStudio Application is now community-maintained (openstudiocoalition, 184 stars).
- **Data model:** Building → ThermalZone → Space → **Surface** (vertices, construction, outside boundary condition) → SubSurface; Schedules; HVAC loops. OpenStudio adds **Measures** (Ruby/Python scripts that transform a model) and Workflows (OSW JSON).
- **Borrow:**
  - **Surface with explicit vertex polygon plus outside boundary condition** (Outdoors / Ground / Adjacent surface), which aligns well with the PostGIS 3D surface table. Store `boundary_condition` and `orientation` so a thermal module can export to EnergyPlus IDF/epJSON.
  - **Measures = deterministic, parameterised model transformations.** The analogue for Nexgen OS "scenarios" is an ordered list of measures applied to a baseline (add PV array, add battery, change tariff), each reproducible.
  - **epJSON schema**: a machine-readable JSON Schema for the whole input model.
- **Avoid:** Owning thermal simulation. Export to it.

### Open Energy Platform (OEP) and Open Energy Ontology (OEO)
- **URL:** https://github.com/OpenEnergyPlatform/ontology · `/oeplatform` · `/oedatamodel`
- **Licence:** Ontology CC0-1.0; platform AGPL-3.0; oedatamodel CC0-1.0.
- **Activity:** OEO **v2.14.0** (2026-10-08, 171 stars); OEP **v1.10.1** (2026-10-01). Run by German research institutes (OvGU Magdeburg, RLI, DLR…) with public funding.
- **Data model:** OEO is an OWL ontology of energy-system concepts (`energy carrier`, `power plant`, `scenario`, `scenario projection`, `quantity value`). **oedatamodel** is a normalised scenario format with *concrete* tables: `oed_scenario`, `oed_data` (id, region, year, value, unit, aggregation, type, technology, input/output energy vector…) and `oed_timeseries` (timeindex_start/stop/resolution + value array). OEP stores tables with **OEMetadata** (frictionless data-package JSON: licence, sources, spatial and temporal extent, field units).
- **Borrow:**
  - **OEMetadata on every published dataset/pack**: licence, sources, spatial and temporal resolution, units per column. Country packs should carry it.
  - **The time-series row shape `timeindex_start, timeindex_stop, timeindex_resolution, series[]`**: a compact array-per-row storage that is efficient for scenario outputs (long series written once, read whole). It complements a per-point table for measured data.
  - **OEO IRIs as optional `concept_iri` on carriers/technologies**, making Nexgen data linkable for EU research projects (good for Horizon Europe calls).
- **Avoid:** Making the OWL ontology a runtime dependency.

---

## 4. Semantic / tagging standards for buildings and devices

### Brick Schema
- **URL:** https://github.com/BrickSchema/Brick · https://brickschema.org
- **Licence:** BSD-3-Clause; py-brickschema 71 stars.
- **Activity:** 406 stars; latest release **v1.4.4** (2025-05-02); repo pushed 2026-10-07. Consortium with UC Berkeley, CMU, Johnson Controls, Mapped and others; ASHRAE 223P is converging with it.
- **Data model:** RDF classes for **Location** (Building, Floor, Room, Zone), **Equipment** (incl. Electrical_Meter, PV_Panel, Battery, Inverter, EVSE), **Point** (Sensor, Setpoint, Command, Status, with Quantity and Unit via QUDT) and relationships `hasPart, isPartOf, feeds, isFedBy, hasPoint, isPointOf, hasLocation, meters, isMeteredBy`. Since 1.3: **`hasSubMeter`, entity properties, value shapes**.
- **Borrow (high value):**
  - **The relationship vocabulary as a constrained `relation` enum in Postgres**: `feeds` (energy or medium flow), `hasPart` (containment), `hasPoint`, `meters` / `isMeteredBy`, `hasSubMeter`. This alone gives Nexgen OS a graph of meters ↔ assets ↔ spaces that maps to Brick TTL export one-to-one.
  - **QUDT for units and quantity kinds** (`qudt:Unit`, `qudt:QuantityKind`). Seed a `unit` table and a `quantity_kind` table from QUDT (qudt-public-repo, 167 stars, active 2026-10-06) instead of free-text units.
  - A Brick TTL exporter as one of the MIT format libraries.
- **Avoid:** A triple store in the core. Relational + export is enough.

### Project Haystack (Haystack 4 → Haystack 5 / Xeto)
- **URL:** https://project-haystack.org · https://github.com/Project-Haystack/xeto
- **Licence:** AFL-3.0 (defs and xeto).
- **Activity:** haystack-defs last pushed 2025-07-07 (frozen at 4.x). **Xeto** repo: 45 stars, pushed 2026-10-11. Haystack 5 with the **Xeto schema language and RDF integration** was unveiled at Haystack Connect (May 2025); Haystack Labs sessions in June 2026 still describe ongoing Haystack 5 work. Governed by Project Haystack Corp., a member-funded non-profit (SkyFoundry, Siemens, J2 and others).
- **Data model:** Entities are dicts of **marker tags** (`site`, `equip`, `point`, `elec`, `meter`, `ac`, `power`, `energy`, `sensor`, `his`) plus refs (`siteRef`, `equipRef`, `spaceRef`). `kind` and `unit` live on points. `his` points have time series. Xeto adds typed **specs** (like TypeScript types) with inheritance, validated against instances.
- **Borrow:**
  - **Tag-based classification with typed specs on top (Xeto).** Pattern: free-form `tags text[]` for discovery, plus a strict `spec` (type) for validation. This is a useful hybrid for "country/module packs add new asset types without migrations".
  - **The `siteRef / equipRef / spaceRef` triad** on every point, the minimum for any meter reading to be locatable.
  - **Unit database**: Haystack's unit list (with canonical names like `kW`, `kWh`, `m³`) is a pragmatic alternative to the full QUDT.
- **Avoid:** Supporting both Haystack and Brick natively in the core. Pick one internal model (relational, Brick-like relations) and ship **both as export formats**.

### SAREF / SAREF4ENER (ETSI)
- **URL:** https://saref.etsi.org · https://saref.etsi.org/saref4ener
- **Licence:** ETSI forge, BSD-3-Clause ontology files (n/v for every extension).
- **Activity:** SAREF4ENER **V2.1.1 (ETSI TS 103 410-1, 2024-10)**, aligned with SAREF core 4.1.1. CEN/CENELEC endorsement via CLC TC 205 WG19 was in progress. No 2025 release found.
- **Data model:** Device → Function → Command / State; Property; Measurement (value, unit, timestamp). SAREF4ENER adds a **PowerProfile with flexibility** (alternatives, sequences, slots with min/max power and duration), derived from EEBus SPINE / Energy@Home.
- **Borrow:** The **flexibility description shape** ("power sequence → slots with min/max power and duration, start window"), the right reusable model for "flexibility" offered by a battery, heat pump or charger in the flexibility module. It also matches what EU-funded interoperability projects expect.
- **Avoid:** Using SAREF as the internal schema. It is verbose.

### SunSpec Information Models
- **URL:** https://github.com/sunspec/models
- **Licence:** Apache-2.0.
- **Activity:** 131 stars; release **v2026-04-20**. SunSpec Alliance is a member-funded industry body that runs certification.
- **Data model:** Numbered JSON **models** (1 Common, 101–103 inverter, 701–714 DER AC/DC measurements and controls, 802 battery, 203 meter) with points that carry `type`, `units`, a **scale-factor point (`sf`)**, `access` and `mandatory`. Models 7xx implement IEEE 1547-2018 functions.
- **Borrow:**
  - **Point definitions = JSON data with unit + scale factor + access + mandatory.** It is a template for device-nature channel lists. Mapping each Nexgen nature to SunSpec model points gives Modbus interoperability for free (via OpenEMS/evcc).
  - **Integer + scale factor** reminds the importer to apply scaling at ingestion and store SI-normalised doubles.
- **Avoid:** Modbus register handling in Nexgen OS.

---

## 5. Grid, market and data-exchange standards

### IEC CIM / CGMES (CIMpy, CIMgen, PowSyBl)
| Project | URL | Licence | Activity |
|---|---|---|---|
| PowSyBl (LF Energy, RTE-led) | github.com/powsybl/powsybl-core | MPL-2.0 | 190 stars, **v7.3.1** (2026-10-01) |
| CIMpy (SOGNO, RWTH Aachen) | github.com/sogno-platform/cimpy | Apache-2.0 | 79 stars, last push 2025-03-09 (slowing) |
| CIMgen | github.com/sogno-platform/cimgen | Apache-2.0 | 25 stars, pushed 2026-08-31 |
| Power Grid Model (LF Energy, Alliander) | github.com/PowerGridModel/power-grid-model | MPL-2.0 | 249 stars, **v1.13.193** (2026-10-07) |

- **Data model:** CIM is a UML model (IEC 61970/61968/62325): `Substation → VoltageLevel → Bay`, `ConductingEquipment` with `Terminals` connected at `ConnectivityNode`s, plus `EnergyConsumer`, `GeneratingUnit`, `UsagePoint` and `Meter` (61968-9). CGMES is the ENTSO-E RDF/XML profile set (EQ, TP, SSH, SV). PowSyBl's IIDM is a simpler Java network model with CGMES import/export.
- **Borrow:**
  - **`UsagePoint` (where energy is delivered/measured, has an EAN/PRM/MPAN identifier) distinct from `Meter` (the physical device).** Nexgen OS must keep this separation: a delivery point outlives meter swaps, and **energy-sharing allocation is computed per usage point, not per meter**.
  - **Terminal / ConnectivityNode** shows how to connect assets to an electrical topology without hard-coding a tree. Use it for the community's low-voltage feeder view.
  - **CIMgen-style code generation** from the UML is a good idea for MIT format libraries: generate the format binding, keep the core hand-designed.
  - Power Grid Model as an optional LV-grid hosting-capacity calculator for communities.
- **Avoid:** Adopting CIM as the core model. It is massive and transmission-oriented. Export the relevant subset (UsagePoint, Meter, EnergyConsumer, PhotoVoltaicUnit, BatteryUnit).

### OpenADR (OpenLEADR, LF Energy)
- **URL:** https://github.com/OpenLEADR/openleadr-python · https://github.com/OpenLEADR/openleadr-rs
- **Licence:** Python Apache-2.0; Rust dual Apache-2.0 / MIT.
- **Activity:** Python (OpenADR 2.0b) 159 stars, **v0.5.36** (2026-09-03). **Rust (OpenADR 3.0 VTN + VEN)** 104 stars, **v0.2.7** (2026-10-06). LF Energy lists openLEADR as covering 2.0b and 3.1.
- **Data model (3.x):** REST/JSON. **Program → Event → intervals[] of payloads** (`PRICE`, `IMPORT_CAPACITY_LIMIT`, `GHG`…) addressed to **VEN → Resource**; Reports back. Interval periods use ISO 8601 `start` + `duration`.
- **Borrow:**
  - **"Price / limit signal = intervals of typed payloads over ISO 8601 periods"**, a generic shape for tariffs, dynamic prices and community signals. One `signal` table with `payload_type` and `interval_period` serves OpenADR, ENTSO-E day-ahead and community-internal price signals alike.
  - The Rust dual MIT/Apache licence fits the "MIT format library" idea.
- **Avoid:** A full VTN inside Nexgen OS. Run openleadr-rs next to it if needed.

### Green Button / ESPI (NAESB REQ.21)
- **URL:** https://www.greenbuttonalliance.org · https://github.com/GreenButtonAlliance
- **Licence:** Apache-2.0 (reference code).
- **Activity:** **The Java reference implementations (OpenESPI-DataCustodian/ThirdParty/Common) were archived on 2025-07-01.** The API documentation repo was updated 2026-03-27. The alliance now champions **URPX** (rate plans) alongside usage data.
- **Data model:** Atom feeds: `UsagePoint → MeterReading → ReadingType` (uom code, powerOfTenMultiplier, accumulationBehaviour, flowDirection, intervalLength, commodity) → `IntervalBlock → IntervalReading(start, duration, value, quality)`. Also `UsageSummary` (bill) and `LocalTimeParameters`.
- **Borrow (high value):**
  - **`ReadingType` as a separate, reusable descriptor**: unit, multiplier, **accumulation behaviour** (deltaData / summation / instantaneous), **flow direction** (forward = import, reverse = export, net), interval length, commodity. With HA's `state_class` it gives the full metadata for a meter series. Nexgen OS `series` should carry `commodity, flow_direction, accumulation, interval, uom, multiplier`.
  - **Per-reading quality code** (validated, estimated, substituted). DSO data needs it for collective self-consumption settlement.
- **Avoid:** Building on the archived Java stack. Implement a small ESPI XML importer/exporter as an MIT format library.

### URPX: Utility Rate Plan Exchange (LF Energy, new 2025-26)
- **URL:** https://lfenergy.org/projects/utility-rate-plan-exchange-urpx/ · https://www.greenbuttonalliance.org/urpx
- **Licence:** Open standard (RDF/OWL/SHACL); exact licence n/v.
- **Activity:** New LF Energy project (logo dated 2026). Initiated by Flux Tailor with the National Laboratory of the Rockies (ex-NREL); semantic model plus API spec. No release found yet.
- **Borrow:** **Directly relevant to "grid tariffs as data".** Follow it from day one. Design the Nexgen OS tariff pack schema so it can serialise to URPX (and to the URDB/SAM `utilityrate5` shape). That would make Nexgen OS among the first non-US adopters, and URPX is likely to become the reference format.

### Shapeshifter / USEF (LF Energy)
- **URL:** https://github.com/shapeshifter/shapeshifter-library-java
- **Licence:** Apache-2.0.
- **Activity:** 13 stars, pushed 2026-09-28.
- **Borrow:** The **UFTP message set** (FlexRequest, FlexOffer, FlexOrder, D-Prognosis, congestion points identified by EAN) is the reference vocabulary for DSO flexibility in NL/EU. The flexibility module should use these names.

### Energy Web (EW Origin, Green Proofs, EWX)
- **URL:** https://github.com/energywebfoundation/origin · https://energyweb.org
- **Licence:** MIT (Origin).
- **Activity:** Origin's last release dates from **2022** (ui-packages@0.4.1), although the repo was pushed 2026-10-11. The foundation has pivoted to **Energy Web X** (a Polkadot parachain) and **Green Proofs** (registries for low-carbon products, e.g. "Green Proofs for Bitcoin", launched Nov 2024). Non-profit, token-funded (EWT).
- **Borrow:** Origin's **certificate model** (device registration → issuance from metered production → transfer → claim/retire, with volume and time interval). It is the right shape if Nexgen OS ever issues GO/REGO-like proofs for community-shared energy, implemented in plain Postgres with an append-only ledger (same as the Ekwo posted-entry doctrine).
- **Avoid:** Blockchain dependencies. The momentum is gone and buyers are wary.

### LF Energy: other relevant projects
- **OpenSTEF** (github.com/OpenSTEF/openstef, MPL-2.0, 172 stars, **v4.4.8** today, Alliander): an ML short-term forecasting pipeline. It could be a forecasting module provider.
- **SEAPATH** (github.com/seapath/ansible, Apache-2.0, v2.0.2 2026-09-08): a substation virtualisation hypervisor. **Not relevant** to Nexgen OS beyond awareness.
- **Hyphae** (listed on lfenergy.org as a "microgrid-based approach to grid resilience and flexibility"). No public GitHub repository found under an obvious name; it is still early.
- **OpenDSM, formerly OpenEEmeter** (github.com/opendsm/opendsm, Apache-2.0, 242 stars, pushed 2026-10-10): standard **baseline / savings measurement (CalTRACK)** methods. **Borrow:** a measurement and verification module for "before/after" savings claims in renovation or EMS scenarios.
- **CityLearn** (MIT, 649 stars): an RL benchmark for district demand response. It is a reference dataset format for multi-building districts.
- **Grid2Op** (MPL-2.0, 477 stars) and **Power Grid Model** (above): grid-side computation.
- **Semantic Energy Framework (SEF), ORES, Battery Data Alliance, CDS (Carbon Data Specification: Customer Data / Power Systems Data / Registration), Smart HEMS Benchmark, CUPID (IEEE 2030.5)** are 2025-26 entries on the LF Energy project page. Watch **CDS Customer Data** (successor framing for customer energy data access), **Battery Data Alliance** (battery data format) and **Smart HEMS Benchmark**, all of which border on Nexgen OS.
- **Governance lesson:** LF Energy offers neutral hosting (Sandbox → Incubating → Graduated), a TAC and a CLA-free DCO process. It is a credible home for Nexgen OS *format libraries* once there is traction (CitrineOS, FlexMeasures and OpenSTEF all followed this path with a company behind them).

---

## 6. Other 2025-26 newcomers and notable mentions

- **EMHASS** (above): HA-centric optimisation, growing fast.
- **REHO**, EPFL IPESE (github.com/IPESE/REHO, Apache-2.0, 16 stars, pushed 2026-10-06): a decision-support MILP tool for **renewable energy communities** (district energy hubs, building clusters). **Borrow:** its parameterised building-cluster inputs.
- **INESC TEC rec-operation / rec-sizing** (github.com/INESCTEC, 6 stars, pushed 2026-09-24): Python library plus REST API to **compute local energy market prices and sizing for a REC**. Licence "other" (custom); check before reuse.
- **pyRES** (BSD-3, pushed 2026-05-12): time-dependent analysis of energy communities.
- **Conluz**, Luco Energía (github.com/lucoenergia/conluz, AGPL-3.0, pushed today, 2 stars): an API-driven Spanish energy-community management app (members, supply points, consumption and production from Datadis, Huawei inverters). It has a web UI and Datadis/Huawei mocks. **Small but exactly in scope.**
- **QUDT** (github.com/qudt/qudt-public-repo, 167 stars, active): the canonical units and quantity-kinds source to seed the unit tables.
- **pint** (hgrecco/pint, 2,813 stars, BSD-style): a Python units library. Use it in Python workers, mirroring the database `unit` table.

---

## 7. Energy communities / collective self-consumption: open-source landscape

This is the thinnest area, and therefore the clearest opportunity.

| Project | What | Licence | Activity | Allocation keys? |
|---|---|---|---|---|
| **Som Comunitats / Coopdevs `odoo-ce`** (git.coopdevs.org/coopdevs/comunitats-energetiques/odoo-ce) | Odoo 16 modules: `energy_communities`, `energy_communities_cooperator`, `energy_communities_service_invoicing`, `energy_project`, **`energy_selfconsumption`** | AGPL-3 | `odoo-addon-energy-selfconsumption` **16.0.0.6.3 on PyPI (2026-09-21)**; GitLab last activity 2026-04-25 | **Yes (Spain):** self-consumption project → **distribution table of coefficients per supply point (CUPS)**; invoicing modes "power acquired / energy delivered / energy delivered with variable hourly coefficient"; export of the coefficient file in the semicolon-separated format the DSO expects. |
| **Conluz** (Luco Energía) | Community member / supply-point / production management API | AGPL-3.0 | pushed 2026-10-12 | Partial (Spanish context, Datadis) |
| **INESC TEC rec-operation** | LEM pricing for a REC | custom | 2026-09 | Market-based sharing, not regulatory keys |
| **REHO**, **RECOpt**, **pyRES**, UNSW energy-sharing | Research sizing/simulation | Apache / MIT / BSD | mixed | Simulation only |
| **Grid Singularity gsy-e** (github.com/gridsingularity/gsy-e) | Energy exchange simulator | GPL-3.0 | 91 stars; last release 2022, pushed 2026-10-07 | P2P market, not regulatory |
| **Enogrid, COSMO, OYO Communities, EnergyID** | Commercial (FR: Enedis-approved key upload; BE/NL: EnergyID community dashboards) | proprietary | n/a | Yes, but closed |

**Findings:**
- No open-source tool was found that implements **French (Enedis "clés de répartition": static, dynamic by default, dynamic custom), Belgian (Brugel / CWaPE / VREG sharing keys, the Flemish "energiedelen"), Italian (CER incentive per GSE) and Spanish (coefficient files, RD 244/2019 + hourly variable coefficients) rules as interchangeable data packs**. The Coopdevs module hard-codes the Spanish case into Odoo models. A 2026 Horizon Europe call (HORIZON-CL5-2026-02-D3-20) explicitly asks for open-source energy-community management tools, so this is a fundable gap.
- **Borrow from Coopdevs:** (a) coefficients attached to a *supply point* inside a *project*, versioned over time; (b) invoicing mode as an enum on the project; (c) the DSO file export as a separate step. That last one is "format by format": the Spanish coefficient file, the Enedis key CSV and the Belgian upload are each a format library.
- **Avoid:** Coupling community logic to an ERP (Odoo). Keep Nexgen OS as the deterministic allocation engine and let Ekwo/Odoo invoice from its output.

---

## 8. Synthesis: what Nexgen OS should borrow (concrete design decisions)

| # | Decision | Source(s) |
|---|---|---|
| 1 | **Series metadata = HA `state_class` + ESPI `ReadingType`**: `quantity_kind, unit, multiplier, accumulation (instantaneous/delta/cumulative), reset semantics, flow_direction (import/export/net), commodity, interval/resolution, timezone`. | Home Assistant, Green Button/ESPI, FlexMeasures |
| 2 | **One time-series table keyed by `(series_id, event_start, source_id, belief_time)`** so measured, forecast, scenario and corrected values coexist; plus **5-min/15-min and hourly rollups** with mean/min/max or state/sum. | FlexMeasures, Home Assistant recorder |
| 3 | **Units and quantity kinds from QUDT** as seeded reference tables; validate unit ∈ quantity kind; store SI-normalised doubles; apply scale factors at ingestion. | Brick/QUDT, openHAB (JSR 385), SunSpec |
| 4 | **UsagePoint ≠ Meter ≠ Asset**: allocation and tariffs attach to the usage point (EAN/PRM/CUPS), meters are swappable devices, assets are physical equipment. | IEC CIM 61968-9, ESPI |
| 5 | **Device "natures" with fixed channel contracts and signed conventions** (meter, storage, PV generator, charge point, heat pump), vendor templates as data with tests. | OpenEMS, evcc, SunSpec |
| 6 | **Relations as a constrained enum** (`feeds, hasPart, hasPoint, meters, hasSubMeter, hasLocation`) on a generic relation table; export Brick TTL and Haystack/Xeto as MIT format libraries. | Brick, Haystack |
| 7 | **Static attributes + time-varying `_t` table per component on a scenario-scoped snapshot index; Bus/Link/Store/Carrier graph exportable to PyPSA/oemof.** | PyPSA, oemof |
| 8 | **Self-describing module manifests** (typed, unit-annotated inputs and outputs) so the core validates and generates the API/UI; scenarios are ordered, deterministic "measures" over a baseline. | SAM/SSC, OpenStudio Measures |
| 9 | **Signals and tariffs as interval payloads over ISO 8601 periods**; tariff packs serialisable to URPX and the URDB/`utilityrate5` shape. | OpenADR 3, URPX, SAM |
| 10 | **Pack metadata = OEMetadata (frictionless) JSON** with licence, sources, spatial and temporal coverage, and units per field. | Open Energy Platform |
| 11 | **Flexibility = SAREF4ENER power-profile/slot shape; DSO flex messages = USEF/UFTP names.** | SAREF4ENER, Shapeshifter |
| 12 | **EV module uses OCPP 2.0.1 vocabulary verbatim** (ChargingStation/EVSE/Connector/Transaction/SampledValue) and imports from CitrineOS/SteVe. | CitrineOS, SteVe, OCPP |
| 13 | **Licensing/governance:** AGPL core with permissive edges (OpenEMS: EPL edge + AGPL UI; openleadr-rs: MIT/Apache); a neutral association or foundation once there is traction (OpenEMS e.V., Open Home Foundation, LF Energy Sandbox); revenue from hosting and hardware/services (emoncms, Nabu Casa) or a light sponsor token (evcc). | OpenEMS, HA, emoncms, evcc, LF Energy |

### What to avoid
- **Competing with HA, OpenEMS, evcc, CitrineOS or EVerest on device control.** Ship *connectors* (pull history, push tariffs/allocations/setpoints) and an HA custom integration; their users become distribution.
- **Re-implementing physics engines** (pvlib, EnergyPlus, PyPSA). Store their inputs and outputs and record the recipe.
- **Ontology-first cores** (RDF triple stores, full CIM/SAREF). Use relational tables with export formats.
- **Blockchain-based certificates** (Energy Web's pivot shows the cost). Use an append-only Postgres ledger.
- **Building on archived reference stacks** (OpenESPI Java, archived 2025-07-01) or slowing projects (CIMpy, last push 2025-03).
- **Hard-wiring one country's allocation rules into models** (the Coopdevs/Odoo Spanish case). Rules belong in packs, file formats in format libraries.

---

## Sources
- GitHub API, repository and release metadata for every repository cited, read 2026-10-12.
- [LF Energy projects](https://lfenergy.org/our-projects/)
- [PVGIS API (non-interactive service)](https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/getting-started-pvgis/api-non-interactive-service_en)
- [Home Assistant sensor entity developer docs](https://developers.home-assistant.io/docs/core/entity/sensor/); `homeassistant/components/recorder/db_schema.py`
- [Haystack 5 / Xeto announcement](https://marketing.project-haystack.org/blog/author/629-projecthaystack); [Haystack 5 webinar](https://marketing.project-haystack.org/blog/webinar-an-introduction-to-haystack5-what-is-it-and-why-does-it-matter)
- [SAREF4ENER](https://saref.etsi.org/saref4ener); [ETSI TS 103 410-1 V2.1.1](https://etsi.org/deliver/etsi_TS/103400_103499/10341001/02.01.01_60/ts_10341001v020101p.pdf)
- [URPX at LF Energy](https://lfenergy.org/projects/utility-rate-plan-exchange-urpx/); [URPX and the GBA](https://www.greenbuttonalliance.org/urpx)
- [Coopdevs energy_selfconsumption model](https://git.coopdevs.org/coopdevs/comunitats-energetiques/odoo-ce/-/raw/da57d9bfc8a29a7501b65cbe505b5857db8efd8b/energy_selfconsumption/models/selfconsumption.py); [Coopdevs on PyPI](https://pypi.org/user/coopdevs); [Som Comunitats presentation 2024](https://www.cilma.cat/wp-content/uploads/2024/03/2024_03_07_Plataforma_SOM_COMUNITATS_Guillem_Alborch.pdf)
- [Horizon Europe call HORIZON-CL5-2026-02-D3-20](https://cordis.europa.eu/programme/id/HORIZON_HORIZON-CL5-2026-02-D3-20/de); [EnergyID energy communities](https://www.energyid.eu/en/solutions/energy-communities/); [GitHub topic energy-communities](https://github.com/topics/energy-communities)
- [Energy Web / Green Proofs for Bitcoin (Enlit)](https://www.enlit.world/library/green-bitcoin-solution-launched-by-energy-web)
