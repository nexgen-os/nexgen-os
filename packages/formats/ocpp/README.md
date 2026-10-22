# `@nexgen-os/ocpp` — the Open Charge Point Protocol ⇄ plain shapes

Reads what a charging station and its central system (CSMS) say to each
other in the Open Charge Point Protocol, versions **1.6J** and **2.0.1**
(JSON frames over a WebSocket), into plain shapes any tool can use, and
writes back what a central system sends to steer a station. MIT; no
dependency, no connection, no clock, no database.

| OCPP | Shape | Notes |
|---|---|---|
| a frame `[2, id, action, payload]`, `[3, id, payload]`, `[4, id, code, description, details]` | `Frame` | `readFrame()`, `writeFrame()`, the round trip is exact |
| `BootNotification` | `StationIdentity` | vendor, model, serial number, firmware; the meter of a 1.6 station; why a 2.0.1 station booted |
| `StatusNotification` | `ConnectorState` | EVSE, connector, status in one vocabulary (`available`, `preparing`, `charging`, `suspended_ev`, `suspended_evse`, `finishing`, `occupied`, `reserved`, `unavailable`, `faulted`), the 1.6 error code; in 1.6 a connector is its own EVSE, 0 is the station |
| `MeterValues`, `transactionData`, `meterValue` of a `TransactionEvent` | `Reading` | measurand (`Energy.Active.Import.Register` when omitted), phase, location, context, value, unit symbol; a 2.0.1 value scaled by its `multiplier`; signed data is skipped |
| `StartTransaction` + its result, `StopTransaction` (1.6); `TransactionEvent` (2.0.1) | `SessionRecord` | one per transaction: EVSE and connector, start and end, energy (register at the end minus at the start), peak active power, id token and its type, stop reason |
| `SetChargingProfile` and its answer | `Schedule`, `{ failure }` | purpose (`station_max`, `tx_default`, `tx`, `external_constraints`), stack level, kind, recurrency, rate unit (W or A), start, duration, validity, transaction, periods; `Accepted` is no failure, `Rejected`, `NotSupported`, an error frame or no answer (a timeout) is one |

`MEASURANDS` says where a measurand goes in a model of devices and series:
the quantity that holds it (`consumption_energy` for the register of
energy imported, `consumption_power`, `current`, `charge_level`…), whether
it is a register or an instant, and its unit. A measurand absent from it
(voltage, frequency, reactive power) is still read, with no quantity.

```ts
import { readStationLog, writeSetChargingProfile, readProfileAnswer } from '@nexgen-os/ocpp';

const log = readStationLog(entries, '2.0.1');      // identity, states, readings, sessions, profiles
const request = writeSetChargingProfile(schedule, '1.6', 7);
const { failure } = readProfileAnswer(answerFrame); // null once accepted
```

`readStationLog()` pairs each call with its result by its id, so that a
1.6 transaction gets the id the central system gave it, and folds the
messages of one transaction in order.

What it never does: open a WebSocket, answer a station, decide a limit,
convert a unit the protocol does not define, or resolve an id token. An id
token may identify a person: whoever keeps it decides how.

## The schemas it is written from

The Open Charge Alliance publishes OCPP 1.6 (with its JSON schemas) and
OCPP 2.0.1 (its Part 3, the JSON schemas of every message) on
[openchargealliance.org](https://openchargealliance.org/); the 2.0.1
specification and its schemas are published under the Creative Commons
Attribution-NoDerivatives 4.0 International licence. This package does not
copy the schema files: its types are written from them, keep their field
names, and are tested on recorded frames of both versions
(`tests/fixtures/`).

Into Nexgen OS, `importStationLog()` of the `charging` module records the
sessions and stores the readings as series of the charger.
