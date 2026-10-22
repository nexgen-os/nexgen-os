# `charging` — electric vehicle chargers, their sessions, their steering and their size

Status: shipped. Schema: `charging`. Requires: `actions`.

A charger is a device of the core of type `charger`. This module says what
the charger is — its EVSEs and connectors, its power, its identity in the
Open Charge Point Protocol (OCPP), the meter it sits behind — records the
sessions it delivers, asks it to keep charging profiles as commands, and
sizes the charge points of a place for a named criterion. What it computes
is an estimate, kept in `charging.estimates` (decision
[0004](../../docs/decisions/0004-a-figure-says-where-it-comes-from.md)).

## What it adds to the core

| Table | Holds |
|---|---|
| `charging.devices` | the charger, a device of type `charger` with the same id (`call derive_devices('charging.devices', 'charger')`): `max_power_kw` of the station, all EVSEs together; `charge_point_id`, the id it connects to its central system with (one per organisation), and `ocpp_version` (`1.6`, `2.0.1`, `2.1`); `meter_id`, a meter of its participant (`meter_of_other_participant` otherwise); the identity it booted with, in `metadata.boot`, once a log is imported. |
| `charging.connectors` | its EVSEs, numbered from 1 as OCPP numbers them, and their connectors: `standard` (a code of `connector_standards`), `current_type` (`ac`, `dc`), `phases` (1 to 3 for AC, none for DC), `max_power_kw`, `max_current_a`. In OCPP 1.6 a connector is its own EVSE, with the same number. |
| `charging.connector_standards` | a vocabulary: IEC 62196 Type 1 and Type 2, CCS 1 and 2, CHAdeMO, SAE J3400, GB/T 20234, MCS, a domestic socket; each with its current type and the word OCPP 2.0.1 says it with. |
| `charging.sessions` | what a charger delivered to one vehicle: `evse_id`, `connector_id`, `started_at`, `ended_at`, `energy_kwh`, `peak_power_kw`, `id_token` and `id_token_type`, `vehicle` when it is known, `stop_reason`, and where it comes from: `source` (`station`, `file`), `source_ref` (a charge point id, a file name) and the `transaction_id` at that source, once per charger, source and transaction. |
| `charging.profiles` | a charging profile asked of a charger: EVSE (0 for the station), `purpose` (`station_max`, `tx_default`, `tx`, `external_constraints`), `stack_level`, `kind` (`absolute`, `relative`, `recurring`) and `recurrency`, `rate_unit` (W or A), start, duration, validity, transaction, `periods` (`[{start_s, limit, phases}]`), the setpoint series of its effect and the command action that carries it, by id. |
| `charging.estimates` | a sizing of charge points, about a participant or a project, with its `criterion`, `provenance`, `inputs` and `results`. |

It publishes the quantity `current` (in amperes, the unit `A`) for a
profile that limits current, and the criterion `demand_served` in the
core's `sizing_criteria`.

**The id token is personal data.** An RFID card number or a contract id
may identify a person. It is kept as the station gave it, read by the
members of the organisation only (row level security), never resolved to a
person by the module and not returned by the MCP tool that reads sessions.
Whoever operates the chargers decides how long it is kept and on which
basis, under the rules of their country.

## Sessions

`charging.record(device, session, source, source_ref)` writes a session
once per (charger, source, transaction id): the first message creates it,
a later one completes it — a stop adds its end, its energy and why it
stopped; the peak is the greatest seen. A session from a file and one from
the station with the same transaction id are two rows, each saying where
it comes from.

`importStationLog(db, device, entries, version)` (`src/import.ts`) reads a
log of frames with [`@nexgen-os/ocpp`](../../packages/formats/ocpp/README.md),
records its sessions through `charging.record()` (a second import changes
nothing), and stores its meter values as `measured` series of the charger
through `store()`, one per quantity and EVSE (`consumption_energy` from the
register of energy imported, `consumption_power`, `current`,
`charge_level`, `production_*` when a vehicle gives energy back), each
converted from the unit the station gave to the unit of its quantity. A
value per phase, and a measurand with no quantity (voltage, frequency), is
counted as skipped.

## Steering: a charging profile is a command

Decision [0047](../../docs/decisions/0047-a-charging-profile-is-a-command.md).

```sql
select charging.limit(:charger, '{
  "evse_id": 1, "purpose": "tx_default", "stack_level": 1, "kind": "absolute", "rate_unit": "W",
  "starts_at": "2026-06-03T17:00:00Z",
  "periods": [{"start_s": 0, "limit": 11000}, {"start_s": 3600, "limit": 7400}]
}'::jsonb);                                   -- the command action, proposed
select actions.move(:action, 'validated');    -- by the person
-- the central system sends it, then reports what the station answered:
select charging.report(:action, '2026-06-03T17:00:02Z');              -- accepted: done, the schedule stored
select charging.report(:action, '2026-06-03T17:00:30Z', 'timeout');   -- or failed, and why
```

`charging.limit()` creates the command through `actions.command()` on the
charger's setpoint series of `power` (kW) or `current` (A), named after the
EVSE, with the limit of the first period as its value, and keeps the
schedule. `charging.report()` hands the answer to `actions.report()`;
accepted, it stores every period still to come in the setpoint series.

## Sizing: `charging.size()`

`size(db, {subject, criterion, target, vehicles, bounds})` (`src/size.ts`,
decision [0045](../../docs/decisions/0045-to-size-is-one-gesture.md)) finds
how many charge points, and at which power, a participant or a project
needs. Everything it reads is data, said in its inputs:

- the **vehicles** of a typical day: when each group arrives and leaves
  (local `HH:MM`; a departure at or before the arrival is the next day),
  the energy each asks for, how many;
- the **powers** of a charge point to consider (`bounds.powersKw`, never
  assumed: they depend on the grid of the place) and the most points
  (`bounds.maxPoints`, the number of vehicles by default);
- the **power of the connection**: `bounds.connectionKw`, or the sum of the
  `subscribed_power` attributes of the meters of the subject, each named in
  the inputs; less `bounds.baseLoadKw`, what the other loads of the place
  take at most.

Each candidate is run at a step of 15 minutes over three days of the same
pattern and the second day is measured, so that a vehicle staying
overnight counts once. A vehicle takes a free point on arrival, first come
first served, or is refused; it holds its point until it leaves and
charges at the point's power until it has what it asked for; when the
points would draw more than the connection leaves, every charging vehicle
is slowed in the same proportion, as a load management does.

| Criterion | Recommends |
|---|---|
| `demand_served` (target 0 to 1, stated) | the smallest installed power, then the fewest points, that delivers the target share of the energy asked before the vehicles leave |
| `max_power` | the largest installed power the connection allows without slowing a vehicle, the most demand served among equals |

Every point of the curve says its points, power, installed power, share of
demand served, vehicles refused and peak drawn. Refusals:
`sizing_criterion_unknown`, `criterion_unsupported`, `target_required`,
`vehicles_required`, `vehicles_invalid`, `bounds_required`,
`connection_power_required`, `connection_exhausted`; and in the results,
`target_not_reached` or `connection_too_small` when no candidate meets the
criterion.

What it does not model: the charging curve of a battery (a vehicle draws
the point's power until it is full), the power a vehicle accepts below the
point's, the variations of the base load over the day, prices and tariffs.

## The central system is an operated service

A charging station speaks OCPP to one central system (a CSMS) over a
WebSocket it opens and keeps. That server — authentication of the
stations, the WebSocket per station, retries, the clock of each command —
is a running service, not part of this repository. An operator builds one
on the library and on the core's functions:

1. accept the WebSocket of a station under its `charge_point_id`, find its
   charger in `charging.devices`;
2. read each frame with `readFrame()` and the reader of its action
   (`readBootNotification()`, `readStatusNotification()`,
   `readMeterValues()`, `readStartTransaction()`, `readStopTransaction()`,
   `readTransactionEvent()`), answer it as the protocol says, and write
   what it means through `charging.record()` and `store()`;
3. send the commands validated in `actions.actions` (kind `command`, a
   series of a charger, status `validated`, by `due_at`) with
   `writeSetChargingProfile()`, the profile number being
   `charging.profiles.profile_number`, and report the answer with
   `readProfileAnswer()` and `charging.report()`.

Open-source central systems to learn from, cited and not depended on:
[SteVe](https://github.com/steve-community/steve) (OCPP 1.2 to 1.6, Java),
[CitrineOS](https://github.com/citrineos/citrineos-core) (OCPP 2.0.1,
TypeScript), [MaEVe](https://github.com/thoughtworks/maeve-csms) (OCPP
2.0.1, Go), and on the station side
[EVerest](https://github.com/EVerest/everest-core); the
[`ocpp`](https://github.com/mobilityhouse/ocpp) package for Python speaks
both versions.

## Later

- OCPP 2.1 (bidirectional charging, its new profile purposes);
- OCPI, the roaming of sessions and tariffs between operators;
- OSCP and OpenADR, the flexibility signals of a grid operator, as profiles
  of purpose `external_constraints`;
- ISO 15118, what the vehicle tells the charger (its energy asked, its
  departure, Plug & Charge contracts);
- smart charging engines as program connectors
  ([0013](../../docs/decisions/0013-a-program-connector-reads-one-request.md)),
  proposing profiles through `charging.limit()`.
