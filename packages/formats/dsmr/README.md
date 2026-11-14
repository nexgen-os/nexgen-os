# `@nexgen-os/dsmr`

What the P1 port of a smart meter says, read into plain values: the DSMR
telegram the meter writes on it, and the JSON message the open P1M5 dongle
publishes from it. MIT. No database, no network, no time zone written in the
code: the caller gives the zone of the meter's place.

```ts
import { readTelegram, readP1m5 } from '@nexgen-os/dsmr';

const reading = readTelegram(text, { timeZone: participant.time_zone }); // the P1 port's telegram
const same = readP1m5(message, { timeZone: participant.time_zone });     // <dongle>/data/readings
for (const v of reading.values) console.log(v.obis, v.measure, v.direction, v.phase, v.tariff, v.value, v.unit);
console.log(reading.at, reading.problems); // the meter's clock in UTC; problems by name, never corrected
```

## What it reads

- **A DSMR telegram**, 2.2 to 5.0.2 (Netbeheer Nederland, *P1 Companion
  Standard*), and its Belgian variant e-MUCS: the identification line
  `/XXX5…`, one object per line `OBIS(group)(group)…` (a group continued on
  the next line included), and the last line `!CRC`. From DSMR 4 on, the
  CRC16 of every character from `/` to `!` is checked (CRC-16/ARC); a
  telegram whose checksum does not match is read and says `crc_mismatch`,
  and `crc` is `invalid`; the caller decides what to keep. A meter before
  DSMR 4 writes no checksum: `crc` is `absent`.
- **A P1M5 message**, the JSON the P1M5 firmware (1.0.47 and later)
  publishes on `<dongle>/data/readings`: one key per OBIS code, a measure as
  `{ value, unit }`. The keys that are not OBIS codes (`id`, `dongle_id`,
  `timestamp`…) are kept in `fields`, as sent.

Both give the same reading: `equipment_id` (`0-0:96.1.1`, decoded from its
hexadecimal octets), `version` (`0-0:96.1.4`, or `1-3:0.2.8`), the tariff
the meter counts in now (`0-0:96.14.0`), the measures in `values`, and
every object as written in `lines`, those that are not measures included
(identifiers, switches, messages, logs, the history of the monthly peaks):
nothing is lost.

## What a value measures

Read from its OBIS code (IEC 62056-61, `A-B:C.D.E`), never from a table of
names:

| C | Measure | Direction | Phase |
|---|---|---|---|
| 1 / 2 | power, or energy with D = 8 | `offtake` / `injection` | — |
| 21 / 22, 41 / 42, 61 / 62 | power | `offtake` / `injection` | L1, L2, L3 |
| 31, 51, 71 | current | — | L1, L2, L3 |
| 32, 52, 72 | voltage | — | L1, L2, L3 |
| 24, with A = 0 and B = 1…4 | volume of a gas, water or heat meter on the bus | — | — |

`offtake` is what the connection takes from the grid (the standard's
*delivered to the client*), `injection` what it puts back (*delivered by
the client*). D says how the value stands in time: `instant` (7),
`cumulative` (8, a register that only grows, its tariff in E, 0 the total),
`average` (4, the demand of the running quarter hour) and `maximum` (6, the
highest quarter hour of the month, at its own stamp). A volume is
`cumulative`, at the stamp its meter sent. Which tariff register is the day
and which the night is the country's, never this library's.

The quantities a value becomes in a model are the importer's: `offtake_power`
and `injection_power` (kW), `offtake_energy` and `injection_energy` as
cumulative series (kWh), `voltage` (V), `current` (A), `volume` (m³).

## Time

**A meter writes its local time, `YYMMDDhhmmssX`, with a season letter X
and no offset**: S when its clock is on summer time, W otherwise. The
reader turns it into UTC with the zone the caller gives
(`time_zone_required` without one); the letter tells apart the two instants
of the hour repeated in autumn. A stamp in the hour skipped in spring is
`local_time_nonexistent`, a letter the zone contradicts `season_mismatch`,
a repeated hour without a letter `local_time_ambiguous`. A reading without
a meter time (`0-0:1.0.0`, absent before DSMR 4) has `at` null and says
`time_missing`: it is never dated by the time it was received.

## Problems

`telegram_unreadable`, `crc_mismatch`, `no_values`, `time_missing`,
`time_zone_required`, `date_unreadable`, `local_time_nonexistent`,
`local_time_ambiguous`, `season_mismatch`, `value_unreadable`. Each has a
`detail` that names the object.

## Credits

The codes a P1M5 dongle publishes, and the shape of its message, are those
of the OpenWatt project: the firmware
[`openwatt-firmware-p1m5`](https://github.com/openwatt-energy/openwatt-firmware-p1m5)
(MPL-2.0) and the broker [`conduit`](https://github.com/openwatt-energy/conduit)
(MIT, its table `configs/p1m5.json`). This library reads their data and
reuses none of their code.
