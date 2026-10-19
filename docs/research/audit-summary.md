# Audit of 19 October 2026 — the structure of Nexgen OS against Ekwo OS

Four audits were run in parallel on `main` at `38f4c32`, each against a
checkout of Ekwo OS, the accounting core built on the same playbook. This page
is the one-screen reading of the four: what they agree on, where they hand a
question to one another, the 35 decisions they leave to the owner, and the
order in which the moves depend on each other. The detail and every figure are
in the four reports:

| Report | Question | Decisions |
|---|---|---|
| [audit-core.md](audit-core.md) | the 40 tables and 38 functions of schema `nexgen`; the 3-4 key objects; sensors against devices | 8 |
| [audit-layout-and-doctrine.md](audit-layout-and-doctrine.md) | the root of the repository and its visible core; `formats/`; how code is shipped; the written doctrine | 8 |
| [audit-series.md](audit-series.md) | the time-series store, its API, the open-source options on managed Postgres | 10 |
| [audit-packs.md](audit-packs.md) | what a country pack holds, what leaves it, the cascade of defaults, the new pack structure | 9 |

## What the four audits agree on

- **The shape is right, the proportion is not.** Ekwo OS's tables are not
  narrower (13.6 columns on average against 10.0 here); its compactness comes
  from few objects and many functions, about 4.2 per table of which 64 are
  business gestures. Nexgen OS has 0.95 functions per table and one business
  gesture, `record_run()`. The core is a sound attachment engine carrying
  objects that are not its own and too few gestures.
- **Three notions in the core, the rest in modules.** The 3D skeleton (sites,
  buildings, one `spaces` table for floors, rooms, zones and units, surfaces),
  the devices mounted on it, and the series they produce. Grid and community
  become modules; the law leaves the public repository; sensors fold into
  devices and series (the instrument is a device, the point is the series).
  The schema goes from 40 tables to about 33, plus the three tables the packs
  need (`countries`, `regions`, `defaults`).
- **One function per gesture, one way to read, one way to write.** About
  twenty core functions named after what a person does; `store()` as the one
  write path for series, `resample()` returning the amount of each bucket;
  `parameter_of()` as the one resolution of a default, with a named refusal.
- **Data over code, everywhere.** A pack of five sections (identity,
  identifiers, sources, grid, defaults) compiled from JSON as Ekwo does; a
  `units` vocabulary instead of factor lists repeated in format libraries;
  tasks generic in their module, never per country in a pack.
- **A root that reads like the model.** A `core/` folder (the Supabase CLI is
  not in the way: there is no `config.toml` and the installer is the
  project's own), TypeScript shipped under `packages/*`, other languages as
  engines, format libraries that touch nothing of the `nexgen` schema,
  geocoders with the connectors, the landing page out of the repository.
- **Plain Postgres stays.** Partitions by week, `pg_partman` and `pg_cron`,
  rollups and a latest-value table written in the core; TimescaleDB and
  `pg_duckdb` as optional accelerators, never a requirement.

## Where the audits hand to one another

The hand-off sections of the four reports were read together. No two
recommendations contradict each other. Five points were raised by one audit
and answered by another, and are settled below:

| Point | Raised by | Settled by |
|---|---|---|
| `series.sensor_id` once sensors are gone | series | core option D: `series` gains `device_id`, `external_ref`, `metadata`; the double path object / sensor host disappears |
| `grid_operators` filled by packs while `meters.grid_operator_id` points at `contacts` | packs | core: both move to the `grid` module, which keeps one table for the operator |
| `legal_sources` and `rules` out of the core | core | packs decision 1: they leave the public repository; one `source_code` and one `reference` per value stay in the pack |
| the `units` vocabulary | layout, series | series decision 6: a core `units` vocabulary and `convert_unit()`; format libraries read it |
| organisations cannot hold attributes (not objects) | packs | packs decision 4 gives them rows in `defaults`; whether organisations join `objects` stays open (decision 36 below) |

Two defects found on the way deserve a fix before any of this: a merge marker
left in `packs/README.md` (line 54), and seeds without `on conflict`, so a new
pack version reaches no existing installation.

## The decisions for the owner

Numbered across the four reports; each report holds the options and their
cost. The recommendation is repeated here so the list can be read alone.

### The core (audit-core)

1. What leaves the core — **B**: `meters`, `grid_operators` → module `grid`; `projects`, `participants` → module `community`; `legal_sources`, `rules` out.
2. Sensors and devices — **D**: the instrument is a device, the point is the series; `sensors` dropped.
3. Floors and spaces — **C**: one core `spaces` table with a kind (floor, room, zone, unit) and a parent.
4. How a device is placed — **A**: columns `site_id`, `building_id`, `surface_id`, `space_id`; `meter_id` becomes a `grid` link.
5. Business functions — **B**: one function per gesture that writes several rows or carries a rule (21 in the core, 4 in modules); the plain insert stays allowed under the triggers.
6. Columns of the accounting side (`ekwo_company_id`, `ekwo_contact_id`, `contacts.email`, `contacts.phone`) — **B**: move to the `ekwo` bridge module of decision 0010.
7. Column or attribute — **B**: a column only for what every row has and every query filters on; the rest is an attribute with a period and a source.
8. `successors` — **B**: three link types in `links`; the table goes.

### Layout and doctrine (audit-layout-and-doctrine)

9. Where the core lives at the root — **A**: `core/` with `migrations/`, `seed/`, `README.md`; `supabase/` removed; a rename map for 0.1 installations.
10. One convention for shipped code — **A**: TypeScript under `packages/*` by role (`cli`, `core`, `formats/*`, `connectors/*`, `python`); `engines/` for other languages; module code in `modules/<m>/src`.
11. What a format library may touch — **A**: nothing of Nexgen OS; importers that write the model live in `@nexgen-os/core` or the module.
12. Where geocoders go — **A**: connectors (`nominatim`, `photon`, `ban`, `geopunt`, `urbis`, `icar`); the address shape in `@nexgen-os/core`.
13. `sdk/python` — **A**: `packages/python`, PyPI `nexgen-os`.
14. The form of a decision record — **A**: Ekwo's: a record states a rule that holds, titled as the rule; five records rewritten (0001 folded into 0006, 0005 split, plans removed from 0008, 0014, 0015).
15. Which doctrine to write — **A**: the 30 titles of the report's §4d, `docs/doctrine.md` on one screen, 15 new records, written in the order of the moves.
16. `site/` at the root — **A**: moves to the site's own repository.

### Series (audit-series)

17. Which engine stores series — **A**: plain Postgres, `pg_partman`, `pg_cron`, rollups in the core; TimescaleDB and `pg_duckdb` optional.
18. Whose series a run writes — **A**: `series.run_id`; a finished run's numbers never change.
19. What `resample()` returns for a cumulative register — **A**: the amount of each bucket; the index itself through `window` and `latest`.
20. How rollups are kept fresh — **A**: one `series_rollups` table (hour, day), dirty hours drained by `series_rollup()`.
21. One write path — **A**: `store()` in SQL, direct inserts revoked from `authenticated`.
22. Where unit conversion lives — **A**: a core `units` vocabulary and `convert_unit()`.
23. How the latest value is read — **A**: a `series_latest` table maintained by `store()`.
24. Where gap filling happens — **A**: `fill()` on read, flagged estimated; written substitutes are a module's run.
25. How Parquet is produced — **A**: `formats/parquet` on the client, server extensions used when present.
26. How the SDKs return series — **A**: rows by default, Arrow / pandas / Polars as optional extras.

### Packs (audit-packs)

27. `legal_sources` and `rules` — **A**: leave the public repository; 64 rows to the private intelligence base.
28. What reference stays in a pack — **A**: one per value, `source_code` and `reference`.
29. Where country tasks go — **B**: generic templates in `modules/tasks`, an optional country overlay outside the pack.
30. Where a country default is stored — **A**: one `defaults` table (country, region, organisation) and `attributes` below.
31. One resolution function, no global level — **A**: `parameter_of()` object → parents → organisation → region → country, else `parameter_missing`.
32. The file format of a pack — **A**: JSON with a published schema, compiled to a committed seed by `nexgen-os pack build`, checked by `pack check`.
33. How a pack is versioned — **A**: `countries` records version, checksum and certification; upsert by natural key; values dated, never edited.
34. Market values in packs — **A**: dated, cited yearly reference values; organisations and projects override.
35. Who lists the regions — **A**: the pack, at its own region level.

### Left open by the hand-offs

36. Do organisations join `objects`, so that they can hold attributes like any object? (packs → core; no recommendation yet.)

## The order of the moves

The moves depend on each other; the audits suggest this order, each step a
pull request of its own, the suite green at every step:

1. **Doctrine first** (decisions 14, 15): the records the moves rely on —
   "one function per gesture", "a column only for what every row has", "a
   pack holds what a function reads", "one cascade of defaults", "the
   instrument is a device, the point is the series".
2. **The core of three notions** (1–8, 18, 21, 22, 30): one 0.2 schema,
   written in a new migration set: `spaces`, sensors folded, `grid` and
   `community` modules, `successors` into links, `series.run_id`, `store()`,
   `units`, `defaults`, `countries`, `regions`; the examples and the Home
   Assistant round trip rewritten and still lossless.
3. **The packs** (27–35): the five-section pack, `pack build` and `pack
   check`, `fr` and `be` redone, the legal rows moved out.
4. **The root** (9, 10, 12, 13, 16): `core/`, `packages/*`, geocoders as
   connectors, the site out — three pull requests of moves, no change of
   behaviour.
5. **Format libraries that touch nothing** (11): the four importers split.
6. **The series API** (17, 19, 20, 23–26): rollups, latest, fill, Parquet,
   the SDK readers; the benchmark of audit-series §4 run once on a real site.

Nothing of this is started before the owner has read the list.
