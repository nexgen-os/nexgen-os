# Audit of the core schema — Nexgen OS against Ekwo OS

Date: 2026-10-19. Scope: the 40 tables and 38 functions of schema `nexgen`
(`supabase/migrations/2026101220*.sql`, `20261013000000_schema_version_0_1_0.sql`,
at commit 38f4c32), read against the core of Ekwo OS. Static reading only;
every figure below comes from a command over the files named next to it.

Headline: the core of Nexgen OS is a sound **attachment engine** (one object
registry, attributes with periods, identifiers, links, documents, series,
immutable runs) carrying too many **objects that are not its own** (projects,
participants, meters, grid operators, legal texts, rules) and too few
**gestures** (one business function, `record_run()`). The proposal: a core
of three notions — the 3D skeleton (sites, buildings, spaces, surfaces), the
devices mounted on it, and the series they produce — with sensors folded into
devices and series, floors and spaces in the core as one `spaces` table, the
grid and the community in modules, the law out of the core, and about twenty
functions named after what a person does.

---

## 1. Ekwo OS's core in one page

**The shape.** The README prints the whole schema in a 20-line tree
(`~/ekwo-ref/ekwo-os/README.md`, "The schema in twenty lines"): an instance,
companies, and under each company the accounting objects. Behind it:

| Measure | Ekwo OS core | Nexgen OS core | Source |
|---|---|---|---|
| migration files | 195 | 12 | `ls supabase/migrations \| wc -l` in each |
| tables | 70 | 40 (39 + 1 default partition) | `docs/schema.md` headings (Ekwo, generated from the migrations); `create table` in the migrations (Nexgen) |
| columns | 952 | 391 | count of column rows per table, same files |
| columns per table, mean / median | 13.6 / 11 | 10.0 / 9 | idem |
| functions | 294 documented (292 names, 2 overloads) | 38 (+ 3 procedures) | `docs/schema.md` "Functions" table; `create function` in the migrations |
| functions per table | 4.2 | 0.95 | ratio |
| trigger functions | 55 | 16 | `returns trigger` |
| boolean guards and helpers | 29 | 6 | `returns boolean` (+ `organisation_role`) |
| business gestures (verbs: post, cancel, reverse, merge, import, close, reopen, settle, reconcile, invite, share, enable…) | 64 | 1 (`record_run`) | name match over the function lists |
| named refusals | — | 30 distinct | `raise exception '<name>` in the Nexgen migrations |
| written decisions | 76 | 17 | `docs/decisions/` |

Ekwo's tables are **not** narrower than Nexgen's (13.6 columns on average
against 10.0). What makes the schema feel compact is elsewhere: few *kinds*
of object, each one factored, and four functions per table doing the work.

**How "few concrete objects, compact tables, many business functions" shows.**

| Pattern | In Ekwo OS | What it buys |
|---|---|---|
| one table per notion, a discriminator for its roles | `contacts` with `contact_type` (`customer`, `supplier`, `both`, `employee`, `other`; `supabase/migrations/20260911120200_contacts.sql`) — no suppliers or customers table | matching, attachments, statements, merging are written once |
| one table per document family | `documents.doc_type`: sale invoice, sale credit note, quote, purchase invoice, purchase credit note, purchase order (`20260911120500_documents.sql`); decision 0008 | Peppol, matching and files written once |
| two layers, joined by a real key | `documents` (what was issued) and `entries` (what the ledger holds), `documents.entry_id`; decision 0008 | each layer answers to its own standard |
| a gesture is a function | `post_document()` builds the entry from the lines in eight checked steps; `post_payment()` books a payment; `reverse_entry()`, `cancel_document()` correct in one gesture (decision 0016); `merge_contacts()`, `settle_from_statement()`, `close_fiscal_year()` | the rule lives in one place; a client, the CLI, the MCP server and an agent all call the same thing |
| guards, by name | `documents_guard_posted()`, `entries_guard_posted()`, `accounts_guard_frozen()`: a posted row does not move; every boolean helper answers true or false, never NULL (decision 0005); locks raise (decision 0013) | `service_role` bypasses row level security, never a function that raises |
| the exception is a row, not a flag | `document_unpostings`, `contact_merges`: written by the one function allowed to, read by the guard in the same transaction | no session setting opens a back door |

**What Nexgen OS already shares.** Modules in their own schema (Ekwo 0051;
Nexgen `modules/*/migrations` create `architecture`, `solar`, `tasks`,
`weather`); countries as packs of data (Ekwo 0025; Nexgen `packs/fr`,
`packs/be`); format libraries under MIT (Ekwo 0048, 20 packages under
`packages/formats`; Nexgen `formats/`, MIT `LICENSE`); an installer with
`init` and `doctor` (`packages/cli`); a schema version function; named
refusals; an agent acting as the user (Ekwo 0053; Nexgen `AGENTS.md`).

**What it does not share yet.** Business gestures as functions (64 against
1); guards on rows that must not move (only `runs_immutable`); a generated
schema reference (Ekwo `scripts/generate-schema-doc.mjs`; Nexgen
`docs/model.md` is written by hand); capabilities per role (Ekwo
`role_capabilities`; Nexgen a three-value enum `member_role`); an audit
trail; one table per notion where Nexgen keeps two (`sensors` beside
`devices`, `grid_operators` beside `contacts`, `successors` beside `links`).

---

## 2. Table-by-table audit of schema `nexgen`

Columns: `node` over the `create table` bodies of the twelve migrations
(391 in total). "Examples": `grep -lE '(into|from|join|references|update)
<table>' examples/*.sql`. "Modules": the same pattern, or the quoted name,
over `modules/`. Plumbing columns repeated on most tables — `organisation_id`
(21 tables), `created_at` (20), `scenario_id` (15), `updated_at` (14),
`published_by` (13) — are not listed as non-essential: they are what the
registry, row level security and scenarios run on.

| # | Table | Role | Cols | Not essential (why) | Examples | Modules | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | `organisations` | the tenant | 5 | `ekwo_company_id` — a link to one product, the `ekwo` bridge module of 0010 | 01–07 | all four | **core** |
| 2 | `organisation_members` | who reads, who writes | 5 | — | — | — | **core** |
| 3 | `contacts` | a person or company dealt with | 9 | `email`, `phone` — personal data the table's own comment assigns to the accounting side; `ekwo_contact_id` — bridge | 02, 03, 06 | tasks | **core**, slimmed (decision 6 below) |
| 4 | `device_types` | what a device can be, a tree | 8 | `module_code` — 14 of the 16 seeded rows name a module that does not exist (`generators`, `storage`, `charging`, `heating`, `grid`, `monitoring`; `supabase/seed/0001_core_vocabularies.sql`) | — | — | **vocabulary** |
| 5 | `profiles` | the use of a building or a site | 7 | — (overlaps the seeded property `usage`) | — | — | **vocabulary** |
| 6 | `link_types` | how two objects may be linked | 9 | — | — | weather | **vocabulary** |
| 7 | `quantities` | a quantity, its one unit, its aggregation | 7 | — | — | solar | **vocabulary** |
| 8 | `property_defs` | what an attribute may hold | 13 | — (`ifc_pset`, `ifc_property`, `bsdd_uri` are the mappings of 0002) | 02 | weather | **vocabulary** |
| 9 | `tags` | Haystack markers | 5 | — (but a `tags` column sits on 8 tables) | — | — | **vocabulary** |
| 10 | `sources` | an external system and its licence | 15 | `secret_ref` — duplicates `connections.secret_ref`, and a row shared by every organisation should name no credential; `docs_url`, `regions` | 06 | solar, weather | **vocabulary** |
| 11 | `id_schemes` | identifier systems | 7 | — | — | — | **vocabulary** |
| 12 | `scenarios` | reality and its variants | 7 | — | 01, 07 | all four | **core** (`scenario_id` is on 15 tables) |
| 13 | `objects` | the registry attachments point to | 5 | `created_at` — the named table has it | — | all four | **core** (plumbing) |
| 14 | `object_kinds` | kind → table, parent columns | 4 | — | — | via `declare_object` | **core** (plumbing) |
| 15 | `projects` | a working perimeter | 13 | `status` — the five lifecycle values of one platform; `start_date`, `end_date` | 03, 05, 06 | tasks | **module `community`** |
| 16 | `sites` | a place, its address, its time zone | 19 | `address_extra`; `municipality_code` — an identifier under a pack scheme (the be pack already publishes `nis`); `location_source_code` — provenance, as `source_code` elsewhere; `profile` — duplicates property `usage` | 01–07 | solar, tasks, weather | **core** |
| 17 | `buildings` | footprint, elevation, height | 18 | `floors_above_ground`, `floors_below_ground` — derived once floors are in the core; `year_built` — an attribute with a period and a source; `metadata` | 01, 02, 04–07 | architecture | **core** |
| 18 | `surfaces` | roof face, facade, ground, carport | 16 | `material` — an attribute; `metadata` | 01, 04–07 | solar | **core** |
| 19 | `meters` | a connection point to a network | 15 | `name`; `identifier` + `scheme` repeat `external_ids` (`meters_check` and `external_ids_check` have the same body); `grid_operator_id` points to `contacts` while `grid_operators` describes the same operators | 01, 03, 04, 07 | — | **module `grid`** |
| 20 | `participants` | a site's role in a project | 16 | `is_group` — the constraint `is_group = (site_id is null)` makes it derivable | 03, 05, 06 | tasks | **module `community`** |
| 21 | `device_directory` | the products a device is an instance of | 15 | `unit_capacity_kwh`, `unit_surface_m2` — type-specific, the job of a module derivation as `solar.module_products` already does; `unit_price`, `currency` — commercial; `datasheet_url` — a document | 04 | solar | **core** |
| 22 | `devices` | a thing installed on a site | 22 | `manufacturer`, `model` — repeat the product; `meter_id` — the grid's, a link; `metadata`. Missing: `space_id`, `source_code` (IFC keeps it in `metadata.ifc.source_code`, `formats/ifc/README.md`) | 01–04, 07 | solar | **core** |
| 23 | `sensors` | a measurable point of any object | 12 | the table itself (section 5) | 01, 02, 07 | — | **merge into `devices` + `series`** |
| 24 | `attributes` | a typed value over a period | 11 | `source` — free text beside `source_code` | 01–07 | tasks | **core** |
| 25 | `external_ids` | identifiers elsewhere | 8 | — | 04, 05, 06 | — | **core** |
| 26 | `links` | a typed, dated link | 9 | — | 01, 02, 04, 05, 07 | weather | **core** |
| 27 | `successors` | split, merge, replace | 5 | — | 05 | — | **merge into `links`** (three link types) |
| 28 | `documents` | a file about an object | 13 | `source` text, `captured_at`, `metadata` | 01–06 | — | **core** |
| 29 | `series` | one quantity over time | 13 | `name`, `source` text; `sensor_id` (section 5) | 01, 02, 03, 07 | solar | **core** |
| 30 | `series_quality_codes` | four quality codes | 2 | — | — | — | **vocabulary** |
| 31 | `series_values` | the values | 4 | — | 01, 02, 03, 07 | — | **core** |
| 32 | `series_values_default` | default partition | — | — | — | — | **core** (plumbing) |
| 33 | `forecast_values` | every issue of a forecast | 4 | — | — | — | **core** |
| 34 | `modules` | module registry | 7 | — | 01, 03, 04, 07 | all four | **core** |
| 35 | `runs` | an immutable computation | 13 | `status`, `error`, `started_at` — `record_run()` writes `succeeded` rows only, and nothing in `modules/`, `formats/`, `connectors/`, `engines/`, `sdk/` or `tests/` writes `running` or `failed` | 04, 07 | solar | **core** |
| 36 | `connections` | an organisation's use of a source | 11 | `status`, `last_run_at`, `last_error` — a connector's operating state | — | weather | **core** (placement: hand-off) |
| 37 | `legal_sources` | legal texts | 10 | — | — | tasks | **out of the core** (hand-off packs) |
| 38 | `rules` | what a country's law sets | 15 | — | — | — (written by `packs/fr/seed/0003–0006`, read by `rules_on()` and a test) | **out of the core** (hand-off packs) |
| 39 | `grid_operators` | distribution and transmission operators | 11 | — | — | — (written by both packs) | **module `grid`** |
| 40 | `schema_migrations` | what the installer applied | 3 | — | — | — | **core** (plumbing) |

**Duplicated facts** found on the way, each a second source of truth:
`attributes` property `installed_power` and `devices.rated_power_kw`;
property `commissioning_date` and `devices.installation_date`; property
`usage` and `sites.profile` / `buildings.profile`; `meters.identifier` and
`external_ids`; `grid_operators` and `contacts` (via `meters.grid_operator_id`);
`sources.secret_ref` and `connections.secret_ref`; `devices.manufacturer` /
`model` and `device_directory`; `series.quantity_code` and
`sensors.quantity_code`, which nothing compares (in
`examples/01-house-pv-battery.sql` an `energy` series names a `power` sensor).

### Grouped result

| Group | Tables | Count |
|---|---|---|
| Core — the skeleton | `sites`, `buildings`, `surfaces`, + `spaces` (section 4) | 3 + 1 |
| Core — devices | `devices`, `device_directory` | 2 |
| Core — series | `series`, `series_values`, `series_values_default`, `forecast_values` | 4 |
| Core — attachments and computation | `objects`, `object_kinds`, `attributes`, `external_ids`, `links`, `documents`, `scenarios`, `runs`, `modules`, `connections` | 10 |
| Core — tenancy and installer | `organisations`, `organisation_members`, `contacts`, `schema_migrations` | 4 |
| Vocabularies | `device_types`, `quantities`, `property_defs`, `link_types`, `profiles`, `tags`, `id_schemes`, `sources`, `series_quality_codes` | 9 |
| Module `grid` | `meters`, `grid_operators` | 2 |
| Module `community` | `projects`, `participants` | 2 |
| Out of the core | `legal_sources`, `rules` | 2 |
| Merged away | `sensors` → `devices` + `series`; `successors` → `links` | 2 |

Schema `nexgen` goes from 40 tables to 33 (24 core + 9 vocabularies). The
candidates the brief named and kept in the core: `scenarios` and `runs`
(`scenario_id` on 15 tables; reproducible runs are principle 4 of the
README), `documents` (Ekwo keeps `attachments` in its core; 6 of 7 examples
use it).

Consequences of the moves: `country_of()` reads `projects.country` directly
(`20261012200200_core_places.sql`) and loses that branch — a project's
country becomes the `community` module's column; `modules/tasks` reads
`projects`, `participants` and `legal_sources`, so it depends on
`community` or takes its country from `country_of()` alone;
`participant_meters()` moves with the grid and community tables; examples
03, 05, 06 load the `community` module first.

---

## 3. Function-by-function audit

| Function | Kind | Gesture or role it serves |
|---|---|---|
| `set_updated_at` | trigger | keeps `updated_at` |
| `organisations_add_creator` | trigger | create an organisation: its creator becomes owner |
| `register_object` | trigger | every named row enters `objects`; `object_organisation_is_final` |
| `parent_check` | trigger | a parent is in the same organisation and scenario |
| `normalize_geometry` | trigger | any geometry in, WGS 84 3D out |
| `meters_check` | trigger | metering identifier matches its scheme |
| `participants_check` | trigger | groups, one participation at a time, contact in the organisation |
| `devices_check` | trigger | building, surface and meter of a device are on its site |
| `derived_device_check` | trigger | a module row derives a device of the right type |
| `attach` | trigger | an attachment takes its object's organisation and scenario |
| `attributes_check` | trigger | value fits its property; no overlapping period |
| `external_ids_check` | trigger | identifier matches its scheme (same body as `meters_check`) |
| `links_check` | trigger | link kinds and organisation |
| `successors_attach` | trigger | split or merge within one organisation |
| `series_store_check` | trigger | forecasts in `forecast_values`, the rest in `series_values` |
| `runs_immutable` | trigger | a finished run never changes |
| `organisation_role` | access | the caller's role |
| `can_read_organisation`, `can_write_organisation`, `is_organisation_owner` | access (boolean) | row level security |
| `device_type_is_a` | check (boolean) | type tree |
| `tags_known` | check (boolean) | tags exist |
| `metric_srid`, `to_core_geometry`, `footprint_volume` | helper | geometry |
| `series_time_zone` | helper | the site's time zone for `resample()` |
| `run_hash` | helper | identity of a run |
| `series_values_partition` | maintenance | weekly partition |
| `nexgen_schema_version` | helper | installer floor |
| `site_of`, `country_of` | reader | where an object is, whose rules apply |
| `attributes_of` | reader | the attributes at a moment, in a scenario |
| `resample` | reader | the one way to read a series |
| `area_m2`, `building_volume` | reader | plan area, LoD 1 block |
| `participant_meters` | reader | the meters behind a participant |
| `rules_on` | reader | a country's rules on a day |
| `record_run` | **gesture** | a module hands back a result |

Totals: 16 triggers, 6 access and check helpers, 7 helpers, 8 readers,
**1 gesture** = 38, plus the procedures `secure_table`, `declare_object`,
`derive_devices` that migrations call.

**How gestures happen today.** A gesture is a plain `insert` guarded by
triggers, or a client function outside the database: the Python SDK's
`attach()` (`sdk/python/nexgen_os/client.py`), the connectors'
`storeSeries()` find-or-create (`connectors/index.ts`), the orientation of a
roof face from its 3D polygon (`formats/geometry.ts`). A rule that lives in a
client is a rule another client — the CLI, an agent over REST — does not
follow: "history is kept by closing a period and opening the next"
(`attributes` comment) is enforced by nobody; nothing refuses removing the
last owner of an organisation (the only trigger on `organisation_members`
is `set_updated_at`).

**Gestures with no function yet**, and the proposed core list, in Ekwo's
style — one function per gesture, named by the verb, `security invoker` so
row level security still decides, refusals by name. Single-row inserts stay
allowed, guarded by the triggers above; a function is due wherever a
gesture writes several rows or carries a rule.

| Gesture | Function | Writes | Refusals (new in bold) |
|---|---|---|---|
| create an organisation | `create_organisation(name)` | organisation, owner | — |
| invite, change, remove a member | `add_member`, `set_member_role`, `remove_member` | membership | **`last_owner`** |
| create a site with its address | `create_site(org, name, country, time_zone, address jsonb, geometry, precision, source)` | site, identifiers given | **`time_zone_unknown`**, `invalid_geometry`, **`country_invalid`** |
| place a site from a geocoder | `locate_site(site, geometry, precision, source)` | geometry and provenance | `invalid_geometry` |
| describe a building | `add_building(site, name, footprint, elevation_m, height_m, source)` | building | `invalid_geometry` |
| describe a floor, a room, a zone | `add_space(building, kind, name, parent, level, geometry)` | space | **`space_outside_building`** |
| describe a roof face or a facade | `add_surface(host, kind, geometry, azimuth_deg, tilt_deg, source)` | surface, orientation derived from a 3D polygon when not given | **`orientation_unknown`** |
| install a device | `install_device(site, type, product, placement, rated_power_kw, installed_on, source)` | device | `device_*_site_mismatch`, **`device_type_unknown`** |
| move a device | `move_device(device, placement, at)` | new placement; the old one closed as a dated link | **`device_retired`** |
| replace a device (a meter swap, a new inverter) | `replace_device(device, product, at)` | new device, `replaces` link, old one retired | **`device_retired`** |
| retire a device | `retire_device(device, at)` | status, end date; its series take no value after `at` | **`device_retired`** |
| open a series | `open_series(object, quantity, kind, value_kind, step, device, external_ref, source)` | series, found or created (today `storeSeries()`) | **`quantity_unknown`** |
| store values | `store_values(series, at[], value[], quality[])` | values, upsert | `series_not_found`, `forecast_values_required` |
| store a forecast issue | `store_forecast(series, issued_at, at[], value[])` | forecast values | `not_a_forecast` |
| set an attribute | `set_attribute(object, property, value, from, source)` | closes the open period, opens the next | `invalid_value`, `property_not_applicable` |
| add an identifier | `add_identifier(object, scheme, value, from)` | identifier | `invalid_identifier` |
| link two objects, end a link | `link_objects(subject, type, object, from)`, `end_link(link, at)` | link | `link_subject_kind`, `link_object_kind` |
| attach a file | `attach_document(object, name, kind, uri, media_type, source)` | document | — |
| split, merge, replace an object | `split_object`, `merge_objects` | new objects and their `split_into` / `merged_into` links | **`object_in_other_organisation`** |
| create a variant | `create_scenario(org, name, parent)` | scenario | — |
| record a computation | `record_run(…)` (exists) | run | `run_is_final` |

Twenty-one functions in the core. The modules carry their own:
`declare_meter`, `close_meter` (grid; refusals `invalid_identifier`,
**`meter_already_open`**), `join_project`, `leave_project` (community;
`participant_site_already_in_project`).

---

## 4. The three key objects

The core reduced to its three notions — **the skeleton, the devices mounted
on it, the series they produce** — means these tables:

| Notion | Tables | Today |
|---|---|---|
| the skeleton | `sites`, `buildings`, `spaces`, `surfaces` | `spaces` is two tables of `modules/architecture` (`floors`, `spaces`) |
| the devices | `devices`, `device_directory`, vocabulary `device_types` | plus `sensors` |
| the series | `series`, `series_values`, `forecast_values`, vocabulary `quantities` | `series` attached to any object, with an optional `sensor_id` |

Everything else in the core serves them: the registry and its attachments,
scenarios and runs, the tenant.

**The gap today.** A device names `site_id`, `building_id`, `surface_id`,
`meter_id` (`20261012200400_core_devices.sql`): it can be on a roof face, it
cannot be in a room. A heat pump in a plant room, a thermostat in a
classroom, an inverter in a garage are placed by a `links` row or not at
all; the IFC reader keeps which space contains a piece of equipment in
`metadata.ifc` only (`formats/ifc/README.md`). Home Assistant's import needs
the `architecture` module to exist (`formats/homeassistant/README.md`, "Needs
the `architecture` module"); the IFC reader checks for it with
`to_regclass('architecture.floors')` (`formats/ifc/index.ts:134`).

### Floors and spaces

| Option | Tables | `site_of()` / `object_kinds` | Examples, formats |
|---|---|---|---|
| **A.** stay in `architecture` | core unchanged | unchanged (kinds `floor`, `space` published by `architecture`) | devices still cannot name a space; HA keeps requiring the module; IFC keeps its optional branch |
| **B.** move `floors` and `spaces` as they are | +2 core tables, module emptied | kinds published by `core` | 5 references in `examples/02-school-architecture.sql` lose the schema prefix; HA and IFC drop the module check |
| **C.** one core `spaces` table: `building_id`, `parent_id`, `kind` (`floor`, `room`, `zone`, `unit`), `name`, `level` (floors), `elevation_m`, `height_m`, `geometry`; the module derives extra detail with the same id, as `derive_devices` does | +1 core table | one kind `space`, parents `{parent_id, building_id}` — `site_of()` needs no change; `architecture.building_of()` becomes a recursive walk over `parent_id` | HA: floor → space `floor`, area → space `room` under it; IFC: `IfcBuildingStorey` → `floor`, `IfcSpace` → `room`; CityJSON writes no floor today and can map `BuildingStorey` / `BuildingRoom` later; example 02 rewrites its two inserts |

**Recommended: C.** It is the `contacts` move of Ekwo applied to space: one
table for what IFC calls the spatial structure, with a kind, instead of one
table per level. `buildings.floors_above_ground` and `floors_below_ground`
then derive from it, and a device gets `space_id`.

### The model in one screen

```
organisations ─┬─ organisation_members     who reads, who writes
               ├─ contacts                 people and companies, one table
               ├─ scenarios                reality, and its variants
               ├─ sites                    country, time zone, address, parcel
               │   ├─ buildings            footprint, elevation, height
               │   │   ├─ spaces           floors, rooms, zones, units — one tree
               │   │   └─ surfaces         roof faces, facades — azimuth, tilt
               │   ├─ surfaces             ground areas, carports
               │   └─ devices              on a surface or in a space; a product of device_directory
               │        └─ series ── series_values | forecast_values
               │                           what a device (or any object) measures, is asked, simulates, forecasts
               ├─ attributes · external_ids · links · documents    on any object, with a period and a source
               └─ runs                     a module's computation: inputs, engine version, results
objects ── object_kinds                    the registry every attachment points to
vocabularies   device_types · quantities · property_defs · link_types · profiles · tags · id_schemes · sources
modules        grid (meters) · community (projects, participants) · architecture · solar · weather · tasks · 3d
```

---

## 5. Sensors and devices

Today (`20261012200400_core_devices.sql`, `20261012200600_core_series.sql`):
a sensor is an object with `host_id` (any object), `quantity_code`, `kind`
(`sensor`, `setpoint`, `command`), `external_ref`, `metadata`; a series has
`object_id`, `quantity_code`, `kind`, and an optional `sensor_id`. The two
rows say the same three things — what, which quantity, read or asked —
twice. In the examples a sensor's host is a device (01, 07), a meter (01,
07), a building (07) or a space (02); `formats/homeassistant` maps a Home
Assistant device to `devices` (type `sensor_box`) and each entity to
`sensors`, hosted by its device, else its area, else the building, with
everything else in `sensors.metadata.ha` for a lossless round trip.

The standards read the same split two ways. Brick separates Equipment from
Point, and a Point carries a reference to its time series; Haystack has
`equip` and `point`, a historised point being a history; OGC SensorThings
has Thing (what is observed), Sensor (the instrument), Datastream (Thing ×
Sensor × ObservedProperty) and Observation. In all three, **the point and
the series are one thing**, and the instrument is equipment.

| | A. every sensor is a device | B. points as a child table of devices (`points`) | C. keep both, explicit link | **D. the instrument is a device, the point is the series** |
|---|---|---|---|---|
| shape | device type `sensor` (`setpoint`, `command` under it), `quantity_code` on devices, `parent_id` for the box it sits in | `points(device_id, quantity, kind, external_ref, metadata)`, series → `point_id` | `sensors.device_id` required, `host_id` for what is observed | `sensors` dropped; `series` gains `device_id` (what produces or receives the values), `external_ref`, `metadata`, kind `command`; `series.object_id` stays what is observed |
| what a series is attached to | the sensor device | the point (and through it the device) | object + sensor, as today | object (observed) + device (instrument), as SensorThings |
| connectors, `storeSeries()` | find the sensor device, then its series | find or create a point, then a series | unchanged | unchanged key, two optional fields; becomes `open_series()` in SQL |
| Home Assistant round trip | entity → device: 22-column rows for one reading each, `sensor_box` becomes the parent | device → device, entity → point; lossless | unchanged | device → device, entity → series with `metadata.ha`; an entity with no device keeps `device_id` null; lossless, `exportHomeAssistant()` reads series instead of sensors |
| Brick, Haystack, SensorThings | breaks Brick (a Point is not Equipment) | Brick and Haystack exact; SensorThings needs point ↔ datastream | as today | all three exact: Equipment / equip / Sensor = device; Point / point / Datastream = series |
| measured vs simulated of the same quantity | separate | point + several series | separate | separate series, the simulated one without device |
| tables | −1 (`sensors`), `devices` wider | ±0 (renamed) | ±0 | −1 |
| migration cost | high: every point becomes a device; examples 01, 02, 07; HA mapping rewritten | medium: rename, `host_id` loses "any object" (space and building hosts need a device) | low | medium: examples 01, 02, 07 (three `insert into sensors`, their series); HA import/export (`formats/homeassistant/index.ts` lines 195–239, 254–260); `tests/homeassistant.test.ts`; `docs/model.md`; object kind `sensor` removed |

**Recommended: D.** A sensor *is* a device — the probe, the meter, the
inverter that reports — and what it reports is a series. One table fewer,
one fact stated once (the quantity is the series'), the three standards
aligned without a translation table, and the Home Assistant round trip keeps
its guarantee. The series package (`audit-series`) inherits the new columns.

---

## 6. Other findings

| Finding | Where | Fix |
|---|---|---|
| 14 of 16 device types name a module that does not ship | `supabase/seed/0001_core_vocabularies.sql` lines 14–30 | null until the module exists, or drop `module_code` (a module derives with `derive_devices()`, which already records the type) |
| `runs.status` / `error` / `started_at` serve states nothing writes | `20261012200700_core_runs_modules.sql` | either drop them (a run is stored when it succeeded) or add `fail_run()` |
| a grid operator is both a `contacts` row and a `grid_operators` row | `20261012200300_core_grid.sql`, `20261012200950_core_regulation.sql` | in the `grid` module, `meters.grid_operator` references `grid_operators(code)` |
| a credential name on a shared vocabulary row | `sources.secret_ref` | keep it on `connections` only |
| devices have no `source_code`, every other described object does | `devices` | add it; IFC stops writing it to `metadata` |
| identifier check written twice | `meters_check`, `external_ids_check` | one helper, `identifier_valid(scheme, value)` |

---

## Hand-offs

| To | Point |
|---|---|
| `audit-packs` | where `legal_sources` and `rules` go once out of the core (no code reads `rules` but `rules_on()` and `tests/packs-fr.test.ts`); `grid_operators` as pack data of the `grid` module; `modules/tasks` templates per country and their `legal_source_code`; `municipality_code` as an identifier scheme a pack publishes; per-country defaults such as a site's time zone |
| `audit-series` | the new `series` columns of option D (`device_id`, `external_ref`, `metadata`, kind `command`) and the loss of `sensor_id`; `open_series()`, `store_values()`, `store_forecast()` as the SQL form of `storeSeries()`; `forecast_values`, partitions, quality codes, `resample()` |
| `audit-layout-doctrine` | showing the core at the root (today `supabase/migrations`); `formats/` as one package per format (shared `db.ts`, `geometry.ts` today) and the orientation helper that section 3 moves into SQL; a schema reference generated from the migrations; an MCP server beside the CLI; writing as decisions the two rules this audit relies on — "one function per gesture" and "a column only for what every row has and every query filters on"; where `connections` and `connectors/` sit |

---

## Decisions for the owner

1. **What leaves the core?**
   - A. Keep all 40 tables — no cost; the core keeps describing communities, grids and law beside buildings.
   - B. `meters`, `grid_operators` → module `grid`; `projects`, `participants` → module `community`; `legal_sources`, `rules` out — 6 tables move, `country_of()` loses its project branch, `tasks` depends on `community`, examples 01, 03–07 load modules.
   - C. B plus `contacts`, `connections`, `scenarios` out — 9 tables move; `scenario_id` on 15 tables then points outside the core.
   - **Recommendation: B.** The core keeps what every trade needs (place, device, series); the grid and the community are trades of their own.

2. **Sensors and devices?**
   - A. Every sensor a device — `devices` grows rows for every reading; breaks Brick.
   - B. A `points` table under devices — a rename; spaces and buildings can no longer host a point without a device.
   - C. Keep both, explicit link — cheapest; the duplicated quantity and kind stay.
   - D. The instrument is a device, the point is the series — `sensors` dropped, `series` + `device_id`, `external_ref`, `metadata`; examples 01, 02, 07 and the HA library rewritten.
   - **Recommendation: D.** One table fewer, one fact stated once, Brick, Haystack and SensorThings aligned, the HA round trip still lossless.

3. **Floors and spaces?**
   - A. Stay in `architecture` — no cost; devices cannot be placed in a room.
   - B. Move `floors` and `spaces` to the core — +2 tables, the module is emptied.
   - C. One core `spaces` table with a kind (`floor`, `room`, `zone`, `unit`) and a parent — +1 table, HA and IFC mappings and example 02 rewritten.
   - **Recommendation: C.** One table for the whole spatial structure, the way `contacts` is one table for every party.

4. **How is a device placed?**
   - A. Columns `site_id`, `building_id`, `surface_id`, `space_id`; `meter_id` leaves for a `grid` link — explicit and checked by `devices_check`.
   - B. One `mounted_on` column naming any object — one column, the check moves to `object_kinds`.
   - C. Links only — no column; every query joins `links`.
   - **Recommendation: A.** The places a device can be are few and known; columns keep queries and checks simple.

5. **Business functions?**
   - A. Keep "the table is the API" — no cost; rules stay in clients (SDK, connectors, formats).
   - B. One function per gesture where it writes several rows or carries a rule (21 in the core, 4 in modules), single-row inserts still allowed under the triggers — medium cost, one migration per family.
   - C. Functions only, direct writes revoked — highest cost; every format and connector rewritten.
   - **Recommendation: B.** The rule moves where every caller meets it, as in Ekwo, without forbidding the plain insert that is already safe.

6. **Columns that belong to the accounting side (`ekwo_company_id`, `ekwo_contact_id`, `contacts.email`, `contacts.phone`)?**
   - A. Keep — no cost; a product name and personal data stay in the core.
   - B. Move to the `ekwo` bridge module decision 0010 already plans — 4 columns move; `contacts` keeps name and kind.
   - C. Drop — the link to invoicing is lost.
   - **Recommendation: B.** The core names no product, and personal data stays where it is managed.

7. **Column or attribute?**
   - A. Keep both — duplicated facts (`year_built`, `material`, `installed_power` / `rated_power_kw`, `usage` / `profile`, `commissioning_date` / `installation_date`, `municipality_code`).
   - B. Rule: a column only for what every row has and every query filters on; the rest is an attribute with a period and a source — `year_built`, `material`, `municipality_code` and the floor counts leave their tables; the seeded properties `installed_power`, `usage`, `commissioning_date` stop repeating a column.
   - C. Everything to attributes — every query pays a join.
   - **Recommendation: B.** One place per fact, and history and provenance for the facts that change.

8. **`successors`?**
   - A. Keep the table — 5 columns, 1 example.
   - B. Three link types (`split_into`, `merged_into`, `replaces`) in `links` — one table fewer; example 05 and `tests/district.test.ts` rewritten.
   - **Recommendation: B.** A split or a replacement is a dated link between two objects; `links` already holds those.
