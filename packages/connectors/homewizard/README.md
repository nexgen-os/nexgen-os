# `@nexgen-os/homewizard`

The [HomeWizard](https://www.homewizard.com) P1 meter as a connector of Nexgen
OS, on its **local API v1**
([documentation](https://api-documentation.homewizard.com/docs/v1/measurement)).
The dongle sits on the P1 port of a smart meter and answers on the
participant's own network, without a key, once the participant has enabled
the local API in the HomeWizard Energy app. MIT.

No mandate is involved: the participant owns the dongle, and the program that
reads it runs where the dongle is. The operator's hub is the other path to the
same meter (a `MeterDataProvider` under mandate, `switchgrid`, `enedis-sge`):
the hub gives the validated quarter hours the next day, the dongle gives the
meter as it is now.

## Reading the meter

```ts
import { storeSeries } from '@nexgen-os/core';
import { homewizard, homewizardSource } from '@nexgen-os/homewizard';

const dongle = homewizard({ host: '192.168.1.20', timeZone }); // host from the connectors row, zone from time_zone_of()
await dongle.identify();                                        // refuses another product than HWE-P1, or another API than v1
const reading = await dongle.read();
for (const s of reading.series) await storeSeries(db, { organisationId, objectKind: 'meter', objectId: meterId, sourceCode: 'homewizard', kind: 'measured' }, s);
for (const b of reading.bus) await storeSeries(db, { organisationId, objectKind: 'meter', objectId: gasMeterId, sourceCode: 'homewizard', kind: 'measured' }, b.series);
```

`registerSource(db, homewizardSource)` writes the `homewizard` source once
(`kind = 'device'`, `auth = 'none'`, not redistributable: the data is the
participant's).

## What a reading gives

| Field of `/api/v1/data` | Quantity | Value kind | Unit | Name |
|---|---|---|---|---|
| `total_power_import_kwh`, `…_t1_kwh` to `…_t4_kwh` | `offtake_energy` | cumulative | kWh | none for the total, `tariff <n>` |
| `total_power_export_kwh`, `…_t1_kwh` to `…_t4_kwh` | `injection_energy` | cumulative | kWh | none for the total, `tariff <n>` |
| `active_power_w`, `active_power_l1_w` to `l3` | `offtake_power` and `injection_power` | instant | W | none for the connection, the phase |
| `active_voltage_l1_v` to `l3` | `voltage` | instant | V | the phase |
| `external[]` of unit `m3` (gas, water), or `total_gas_m3` of an older firmware | `volume`, in `bus` | cumulative | m³ | none: one meter each |

- The dongle gives one signed power per phase, positive when the place takes
  from the grid: it is split into the two directions, the other one at 0.
- The electricity values carry no stamp: they are dated when they are read,
  to the second, by the clock the caller gives (`now`).
- A meter of the bus stamps its value in local time (`YYMMDDhhmmss`), without
  the summer or winter flag of the telegram. It is dated in the participant's
  time zone (`timeZone`); without one it is skipped as `time_zone_required`,
  and in the hour repeated when the clocks go back as `stamp_ambiguous`.
- Each meter of the bus comes back with its type and its identifier (the hex
  the dongle gives, decoded when it is printable text), to be stored on its
  own meter, never on the electricity one.
- Skipped, with the field and the reason in `skipped`: a value that is not a
  number (`value_invalid`), a unit the core has no quantity for
  (`unit_unsupported`, the GJ of a heat meter), a stamp that is not a date
  (`stamp_invalid`).
- Left out on purpose: the running quarter-hour demand and the month's peak
  (the core computes demand from the series), the current (no `current` in
  the core vocabulary yet), the counts of sags, swells and failures, the
  Wi-Fi signal.

`resample()` turns the cumulative registers into energy per step.

## Refusals

`connector_config_required` (no address), `source_unauthorised` (403: the
local API is not enabled in the app), `source_unavailable` (the dongle does
not answer, or answers an error), `device_unsupported` (another product,
another API version).

## Not yet

The API v2 (HTTPS with a token the participant approves on the device), the
kWh meters and sockets (they measure a device, not a connection: they belong
with the device contract of the core), the raw telegram (`/api/v1/telegram`,
read by the DSMR format library).
