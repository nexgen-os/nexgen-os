# `@nexgen-os/zaptec`

[Zaptec](https://zaptec.com) charging stations, read from their maker's
cloud on its public REST API (`https://api.zaptec.com`;
[documentation](https://api.zaptec.com/help/index.html)), with the account
of the charger's owner. What it reads lands on a charger of the
[`charging`](../../../modules/charging/README.md) module: its sessions and
the series of the device. MIT.

A station that speaks OCPP to a central system of the installation is read
by its log instead ([`@nexgen-os/ocpp`](../../formats/ocpp/README.md) and
`importStationLog()` of `charging`); this connector is for the stations that
report to Zaptec's cloud only, as most household stations do.

## What it reads

```ts
import { collectZaptecSessions, zaptec } from '@nexgen-os/zaptec';

const cloud = zaptec({ username, password }); // the secret of the connectors row
await cloud.chargers();       // the chargers the account reaches
await cloud.state(chargerId); // what one reported last
await collectZaptecSessions(db, cloud, { organisationId, deviceId, chargerId, from, to });
```

| Call | Endpoint | Gives |
|---|---|---|
| `chargers()` | `GET /api/chargers`, every page | each charger: its id in the cloud (what the other calls take), its serial, name, installation, active, online |
| `state(chargerId)` | `GET /api/chargers/{id}/state` | the observations below, each at its own stamp, as series in the core's terms; the operation mode in words (`disconnected`, `connected_requesting`, `connected_charging`, `connected_finished`) |
| `sessions({ chargerId, from, to })` | `GET /api/sessions/archived`, every page of its cursor | the sessions that ended in the window, each as the record `charging.record()` takes and the readings of the energy it delivered |

| Observation | Series of the charger |
|---|---|
| `TotalChargePower` (513) | `consumption_power`, W, instant |
| `VoltagePhase1` to `3` (501–503) | `voltage`, V, instant, named `L1` to `L3` |
| `CurrentPhase1` to `3` (507–509) | `current`, A, instant, named `L1` to `L3` (the quantity of the `charging` module) |

A stamp the cloud gives without an offset is read as UTC, the time the
cloud dates in.

## Sessions and their energy

`collectZaptecSessions(db, connector, request)` writes a window of sessions
on a charger described in `charging.devices` (`charger_not_described`
otherwise):

- each session through `charging.record()`, once per session id: source
  `station` (the cloud is the station's central system), `source_ref` the
  station's serial, `transaction_id` the session's id, its start, end and
  energy, the name of the token the station read; in `metadata` the
  station, the installation, a third party's transaction id, the firmware,
  and whether it was recorded offline, on a trusted clock, signed (OCMF),
  aborted or stopped by a card;
- the energy as one `consumption_energy` register of the device
  (cumulative, kWh, `measured`, source `zaptec`): each session counts from
  zero at its start, through the readings the cloud kept during it, to its
  energy at its end. The core reads a register that falls back as a reset,
  so `resample()` gives the energy of each hour or day across sessions. A
  session without detailed readings puts its whole energy in the bucket it
  started in.

A second collection of the same window changes nothing. What is left out is
named in `skipped`: a voided session, replaced by a corrected one
(`session_voided`); a session whose start or end is not a date
(`stamp_invalid`); the readings of a session recorded offline on a clock the
station did not trust, whose record is kept (`clock_unreliable`); a reading
below the one before it or outside the session (`value_invalid`).

## Configuration

An organisation's `connectors` row names the source `zaptec` and the
account by `secret_ref` (the vault holds it; the caller resolves it and
passes `username` and `password`, the connector reads no environment), and
in `config` the charger ids it collects. The account is the owner's, or a
service partner's the owner granted access to its installation; the cloud
refuses a charger it does not own (`source_unauthorised`).

## Its source

The package ships its `sources` row, [`source.json`](source.json)
(`zaptecSource`; write it with `registerSource()` of the core): kind `api`,
`auth = 'oauth2'` (the password grant of the cloud), worldwide, not
redistributable: the data is the charger owner's, read with their account.

## What is not done yet

- The answers in `tests/fixtures` are built on the shapes of the published
  OpenAPI description, not recorded: record them with a real account at the
  first run and keep them beside these; the tests must pass unchanged.
- Commands (stop, resume, a current limit) wait for the device connector
  contract of the core, through which a command a person validated is
  carried.
- Left out on purpose: the user who authorised a session (a person's name
  and e-mail), the signed payloads (kept by Zaptec), prices, the
  installation's settings.

## Licence

MIT.
