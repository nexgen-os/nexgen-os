# `@nexgen-os/s2` — S2 (EN 50491-12-2) messages ⇄ plain shapes

Reads what a customer energy manager (CEM) and the resource manager (RM)
of a device say to each other in **S2**, the European standard
EN 50491-12-2 for energy management in homes and buildings, in the JSON
the [S2 JSON schemas](https://github.com/flexiblepower/s2-json) define
(version 1.0.0); checks every message against those schemas, field by
field; and writes back what an energy manager sends. MIT; no dependency,
no connection, no clock, no database.

A resource manager says what its device is, what it measures and expects,
and how it may be steered: by a power envelope (`PEBC`), a power profile
(`PPBC`), operation modes (`OMBC`), a fill rate (`FRBC`) or a demand
(`DDBC`). The energy manager selects one control type and sends
instructions within it.

| S2 | Shape | Notes |
|---|---|---|
| any of the 36 messages | `S2Message` | `readMessage()` from its text or its JSON, `writeMessage()` to the text S2 sends; both check it |
| any message | `string[]` | `problemsOf()`: every departure from the schemas, `<path>: <what is wrong>` — a missing field, a field the schema does not know, a word outside its enumeration, a list outside its bounds, an id, a date without its offset, a duration that is not whole milliseconds |
| a text received | `ReceptionStatus` | `receptionStatusOf()`: `INVALID_DATA` when it is no JSON object with a message id, `INVALID_MESSAGE` when it does not hold to its schema, `OK` otherwise; null for a `ReceptionStatus` |
| `ResourceManagerDetails` | `ResourceDetails` | resource id, name, manufacturer, model, serial number, firmware, roles per commodity, control types, instruction delay in milliseconds, forecast, quantities measured, currency |
| `PowerMeasurement` | `Measurement[]` | one per commodity quantity, dated in UTC, in its unit, with the sign the device gives |
| `PowerForecast` | `ForecastStep[]` | one per element and commodity quantity, dated at its start, its end the start plus the duration; expected value and the bounds given (limit, 95 %, 68 %) |
| `PEBC.Instruction` | written from `EnvelopeStep[]` | `writePowerEnvelopeInstruction()`: one envelope per commodity quantity from dated steps that follow one another, as the durations S2 carries |

`COMMODITY_QUANTITIES` gives the unit of each commodity quantity, as its
schema defines it (W for an electric or thermal power, l/s, g/s, l/h for a
flow, °C for a temperature), and the phase of an electric power.
`CONTROL_TYPE_OF_PREFIX` maps a message prefix to its control type.

```ts
import { readMessage, readPowerForecast, receptionStatusOf, writePowerEnvelopeInstruction } from '@nexgen-os/s2';

const answer = receptionStatusOf(text);   // what to send back before acting on it
const message = readMessage(text);        // message_unreadable, message_invalid
const steps = readPowerForecast(message); // dated at their start, in UTC
const instruction = writePowerEnvelopeInstruction({ messageId, id, powerConstraintsId, envelopes });
```

Every refusal starts with its name: `message_unreadable`,
`message_invalid` (followed by every problem), `message_type_unexpected`,
`envelope_invalid` (a gap or an overlap between steps, a lower limit above
its upper one, envelopes that do not start together).

What it never does: open a WebSocket or pair with a device (that is S2
Connect, a connector's job), keep a session, decide an instruction,
convert a unit or change the sign of a value, or check what only the
receiver can know — that an id it refers to exists (`INVALID_CONTENT`).

## The schemas it is written from

The S2 JSON schemas are published by the S2 user group
([s2standard.org](https://s2standard.org/)) at
[github.com/flexiblepower/s2-json](https://github.com/flexiblepower/s2-json)
under the Apache License 2.0. This package does not copy the schema files:
`src/schema.ts` describes, for each message and each object it carries,
its fields and what each holds, written from version 1.0.0, with the field
names as the schemas spell them (`supported_commodites` of a DDBC
actuator and `Id` of a DDBC operation mode included). Two choices:

- an id is checked whole against the pattern of `ID` (2 to 64 letters,
  digits, `-`, `_` or `:`), which the schema writes without anchors;
- a currency is checked as an ISO 4217 code of three capital letters, not
  against the list the schema repeats.

It is tested on a recorded session of a home battery (`tests/fixtures/`).
