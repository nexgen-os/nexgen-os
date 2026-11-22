# `@nexgen-os/mqtt`

The readings of **P1 dongles**, received from an MQTT broker, as the series
of the meters they read. A dongle on the P1 port of a smart meter publishes
what the meter says every second or every few seconds: the JSON message of
the open P1M5 firmware, or the DSMR telegram as the meter wrote it. This
package places each message on the meter (or the device) its dongle is
known by, dates it by the meter's clock in the time zone of that object's
participant, keeps one reading a minute, and hands the kept readings in
batches to its caller, which writes them: the core's `measuredObjects(db)`
writes through `store()`, the one write path. MIT, and it runs without the
core ([0064](../../../docs/decisions/0064-an-mit-package-reaches-no-agpl-package.md)).

The broker is a protocol, never a library this package ships
([0014](../../../docs/decisions/0014-integrations-dashboards-warehouses-streams.md)):
any client that subscribes and emits `message` events fits, MQTT.js as it
is. The readings themselves are read by [`@nexgen-os/dsmr`](../../formats/dsmr/README.md)
and turned into series by `meterSeriesOfDsmr()` of
[`@nexgen-os/connector`](../../connector/README.md), the same mapping a file of telegrams goes through.

## Use

```ts
import mqtt from 'mqtt';
import { measuredObjects, registerSource } from '@nexgen-os/core';
import { listen, P1_PORT_SOURCE, p1Stream } from '@nexgen-os/mqtt';

await registerSource(db, P1_PORT_SOURCE); // the `p1_port` source, once
const client = mqtt.connect(process.env.BROKER_URL!, { username, password }); // the secret from the vault
const stream = p1Stream(measuredObjects(db), { scheme: 'p1_dongle', organisationId });
const listening = listen(client, stream, {
  topics: ['p1/+/data/readings'],
  onReceived: (r) => { if (r.status === 'refused') console.warn(r.identifier, r.problems); },
});
// …
await listening.stop(); // writes what is left
```

The installation records each dongle once, as an identifier of the meter it
reads, in a scheme of its own (the scheme is data, the package names none):

```sql
insert into identifier_schemes (code, name, pattern) values ('p1_dongle', 'A P1 dongle', '^[A-Z0-9]+$');
select add_identifier('meter', '<meter id>', 'p1_dongle', 'P1000001');
```

## What a message becomes

1. **Its dongle.** `dongleIdentifier()` reads the `dongle_id` of a P1M5
   message, otherwise the meter's equipment identifier (`0-0:96.1.1`) of a
   telegram; `identifierOf` replaces it (a segment of the topic, say).
2. **Its object.** The identifier, valid now, in the stream's `scheme` (and
   `organisationId` when given), asked of the caller's `byIdentifier()`;
   `measuredObjects(db)` reads it under the connection's rights: a meter or
   a device. Found or not, a dongle is remembered for
   `rememberSeconds` (300) before it is looked up again.
3. **Its time.** The reading is dated by the meter's clock in the time zone
   of the object's participant, never by the time it was received.
4. **Thinned.** One reading per object every `keepEverySeconds` of meter
   time (60; 0 keeps them all): the registers are cumulative, so the
   quarter hours `resample()` gives lose nothing, and the power and voltage
   are kept once a minute.
5. **Written.** `flush()` (every `flushEverySeconds`, 60, under `listen()`)
   hands each object's batch to the caller's `write()`, which
   `measuredObjects(db)` writes as its series of kind `measured` under the
   source `p1_port`: the energy registers as cumulative `offtake_energy` /
   `injection_energy` series by tariff, the power and the voltage as
   instants by phase.

| What came | What it gives |
|---|---|
| a message whose dongle no identifier names | refused, `identifier_unknown` |
| an identifier in several organisations the connection reads | refused, `identifier_ambiguous`; give `organisationId` |
| an identifier on another object than a meter or a device | refused, `object_not_measured` |
| a participant without a time zone | refused, `time_zone_required` |
| a message naming no dongle, or not a message | refused, `identifier_missing`, `telegram_unreadable` |
| a reading without the meter's time | refused, `time_missing` |
| a telegram whose checksum does not match | left out at the flush, in `skipped` |
| a batch the caller refuses (another value kind on the series) | the flush's `error`, its readings dropped |

A refusal never stops the stream: the next message is read.

## Not yet

- The meters of the bus (gas, water, heat on channels 1 to 4): their volume
  is in the telegram, and `meterSeriesOfDsmr(readings, { channel })` gives
  it; the stream writes the electricity meter only.
- The one message shape of the stream door, the envelope of the
  connectors' series, received from any broker.
