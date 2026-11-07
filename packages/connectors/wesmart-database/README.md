# `@nexgen-os/wesmart-database`

The database of the WeSmart platform read into a Nexgen OS installation run
for the same organisations, again every night without a duplicate, and
reconciled with it per participant and per month, to the kilowatt-hour. MIT.

The platform is **read, never written**: every query runs in one
transaction opened `read only` and rolled back
(`readWesmartDatabase()`), whatever the rights of the connection. What it
reads becomes the plain shape of an imported history (`HistoryDescription`
of `@nexgen-os/core`), and `importHistory()` writes it through the
functions of the core, as the person who runs it, under row level security.

## What lands where

| In the platform | In the model |
|---|---|
| `organisations` | an organisation (`create_organisation()`), found again by the id of its record, scheme `wesmart_database` |
| `projects` of an organisation | a project (`importProject()`), its country the project's own; a project without an organisation is skipped (`organisation_missing`) |
| `participants` | a participant with its place (address, postal code, city, country, point when it has one) and the time zone the caller names; `producer` when its profile says so, `consumer` otherwise |
| `participants.smart_meter_id` | a meter of scheme `gs1_gsrn` (18 digits), measuring both ways; another record of the project on the same point (a producer record beside a consumer one) is skipped (`meter_shared`), and so is an identifier of another form (`meter_identifier_unknown`) |
| `devices` | a device, its type in the core's `device_types` (`ev_charger` → `charger`, `heatpump` → `heat_pump`, `chp` → `cogeneration`…), its power; an electric vehicle is skipped (`device_type_unknown`) |
| `dso_meter_readings` | the meter's `offtake_energy` (`offtake_kwh` + `consumption_kwh`, the two columns the platform has written offtake in) and `injection_energy`, a quarter-hour each, dated at its start, in kWh, source `wesmart_database` |
| `connector_mandates` | a mandate of the meter (`grid` module), `sent`, `approved` (with the operator's reference, `external_id`) or `refused`; an expired, revoked or failed one is skipped (`mandate_closed`) |

What is skipped is returned in `skipped`, by the id of its record and the
name of its reason. Nothing is logged.

The platform keeps no time zone: the caller names it (`--time-zone`), as
the platform's own queries do.

## Every night

```sh
# once, as the owner of the database: the sources row and the identifier scheme
NEXGEN_DB_URL=… nexgen-os import wesmart --register

# as a person (a key, a session or a user id), the platform's connection in the environment
export NEXGEN_IMPORT_SOURCE_URL=…   # a role that may read the platform; never written to a file
nexgen-os import wesmart --time-zone Europe/Brussels --dry-run   # writes inside a savepoint, rolls back
nexgen-os import wesmart --time-zone Europe/Brussels --apply     # writes, then reconciles
nexgen-os import wesmart --time-zone Europe/Brussels --report    # writes nothing, reconciles
```

`--only <id,id>` reads only those organisations; `--from` and `--to` bound
the readings; `--json` prints the whole report.

## The report

- **counts** per kind (organisation, project, participant, meter, device,
  mandate): found, created (or to create), failed;
- **readings**: the series written, the values read, the values that
  changed (zero on a night when the platform changed nothing);
- **months**: one line per participant, month (in its time zone) and
  quantity — the platform's sum, the sum the model gives back
  (`resample()`), their difference, and `equal` (under half a kWh),
  `differs`, `missing` or `failed` with the name of the refusal;
- **personal_data**: what the import moved and what the report keeps of it.

The report names no person, no place and no metering point: an object is
given by its id in the model and the id of its record in the platform, a
refusal by its name, never by its message.

## Personal data

The participants of an energy sharing project are persons. The platform
processes their data on behalf of the organisations that run the projects;
the import moves it (names, places, metering points, readings, mandates)
into the model those organisations run, and the provenance of each series
says where it came from (`source_code = 'wesmart_database'`). The test
of this package reads a made-up platform only (`tests/fixture.ts`).
