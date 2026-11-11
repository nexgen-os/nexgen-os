# `@nexgen-os/easee`

[Easee](https://easee.com) charging stations, read from their maker's cloud
on its public REST API (`https://api.easee.com`;
[documentation](https://developer.easee.com)), with the account of the
charger's owner. What it reads lands on a charger of the
[`charging`](../../../modules/charging/README.md) module: its sessions and
the series of the device. MIT.

A station that speaks OCPP to a central system of the installation is read
by its log instead ([`@nexgen-os/ocpp`](../../formats/ocpp/README.md) and
`importStationLog()` of `charging`); this connector is for the stations that
report to Easee's cloud.

## What it reads

```ts
import { collectEasee, easee } from '@nexgen-os/easee';

const cloud = easee({ username, password }); // the secret of the connectors row
await cloud.chargers();                      // the chargers the account reaches
await collectEasee(db, cloud, { organisationId, deviceId, chargerId, from, to });
```

| Call | Endpoint | Gives |
|---|---|---|
| `chargers()` | `GET /api/chargers` | each charger by its serial number (what the other calls take) and its name |
| `observations({ chargerId, from, to })` | `GET /api/chargers/{id}/observations/{observation}/{from}/{to}` | the history of the observations below, each value at its own stamp |
| `sessions({ chargerId, from, to })` | `GET /api/sessions/charger/{id}/sessions/{from}/{to}` | the sessions of the window, each as the record `charging.record()` takes |

| Observation | Series of the charger |
|---|---|
| `LIFETIME ENERGY` (124) | `consumption_energy`, kWh, cumulative: the charger's own register, so `resample()` gives the energy of each hour or day |
| `TOTAL POWER` (120) | `consumption_power`, kW, instant |

A stamp the cloud gives without an offset is read as UTC, the time the
cloud dates in.

## Sessions

`collectEasee(db, connector, request)` writes a window on a charger
described in `charging.devices` (`charger_not_described` otherwise):

- each session through `charging.record()`, once per session id: source
  `station` (the cloud is the station's central system), `source_ref` the
  charger's serial, started when the car was connected and ended when it
  was disconnected (open while it is), its energy, the token the station
  read; in `metadata` when energy started and stopped flowing, how long it
  flowed, and whether the cloud holds the session complete;
- the observations as `measured` series of the device, source `easee`.

A second collection of the same window changes nothing. What is left out is
named in `skipped`: a session without an id or a start, a stamp that is not
a date (`stamp_invalid`), a value that is not a number (`value_invalid`).

The cloud limits how often it is asked: two lists of chargers a minute, ten
lists of sessions an hour. A collection asks each endpoint once per charger
and window; a refusal for asking too often is named (`source_rate_limited`)
and never retried here: the job that schedules collections waits.

## Configuration

An organisation's `connectors` row names the source `easee` and the account
by `secret_ref` (the vault holds it; the caller resolves it and passes
`username` and `password`, the connector reads no environment), and in
`config` the chargers it collects. The access token is renewed with its
refresh token, and by signing in again when that is refused.

## Its source

The package ships its `sources` row, [`source.json`](source.json)
(`easeeSource`; write it with `registerSource()` of the core): kind `api`,
`auth = 'oauth2'`, worldwide, not redistributable: the data is the charger
owner's, read with their account.

## What is not done yet

- The answers in `tests/fixtures` are built on the shapes of the published
  OpenAPI description, not recorded: record them with a real account at the
  first run and keep them beside these; the tests must pass unchanged.
- Commands (start, stop, a current limit) wait for the device connector
  contract of the core, through which a command a person validated is
  carried.
- Left out on purpose: the price and the cost of a session (a price is the
  data of a contract), the signed payload (OCMF, kept by Easee), the
  operation mode, schedules and settings.

## Licence

MIT.
