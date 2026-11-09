# `@nexgen-os/homeassistant-api`

A household's [Home Assistant](https://www.home-assistant.io) as a connector
of Nexgen OS, live, on its
[WebSocket API](https://developers.home-assistant.io/docs/api/websocket)
(`/api/websocket`). Home Assistant reaches the devices of every brand its
integrations know; this package reads what it knows of them into the
snapshot [`@nexgen-os/homeassistant`](../../formats/homeassistant/README.md)
reads from a file, so nothing new is needed between the installation and
the model. MIT.

```ts
import { homeAssistantSnapshot } from '@nexgen-os/homeassistant-api';
import { readHomeAssistant } from '@nexgen-os/homeassistant';
import { importHomeAssistant } from '@nexgen-os/building'; // modules/building/src

const snapshot = await homeAssistantSnapshot(
  { url: 'http://homeassistant.local:8123', token },          // token from the connector's secret_ref
  { from: '2026-06-21T00:00:00Z', to: '2026-06-22T00:00:00Z' }, // the recorder's states over the period
);
await importHomeAssistant(db, { participantId, buildingId }, readHomeAssistant(snapshot));
```

## What it reads

| Command | Gives |
|---|---|
| `config/floor_registry/list` | the floors (none on an installation older than 2024.4, which has no floors) |
| `config/area_registry/list` | the areas |
| `config/device_registry/list` | the devices: name, the name a person gave it, manufacturer, model, serial number, area |
| `config/entity_registry/list` and `get_states` | the entities, with the device class, state class and unit their current state carries when the registry entry does not say them |
| `history/history_during_period` | the states over `from` → `to` (`minimal_response`, `no_attributes`, every change kept), dated when they were last updated |

Without `from`, the current state of each entity is read instead.
`entities` narrows the read to the entities named, and their devices; by
default every entity the registry holds and has not disabled is read. An
entity Home Assistant only knows by its state (a YAML entity without a
`unique_id`) has no stable identity and is left out; asked by name, it is
refused, `entity_not_found`.

## The connection

`connectHomeAssistant({ url, token })` opens one socket, answers
`auth_required` with the token, and gives a session whose `call(type,
payload)` sends one command and waits for its result;
`homeAssistantSnapshot()` opens, reads and closes. The token is a
long-lived access token of a Home Assistant user (Profile → Security), held
by the installation's vault and named by the `secret_ref` of the
organisation's `connectors` row; nothing here reads the environment or
stores it. The socket is the global `WebSocket` (Node 22 and later), or any
other passed as `socket` (the `ws` package on Node 20, a test's fake).

Refusals, by name: `secret_not_found` (no token), `invalid_url`,
`source_unauthorised` (`auth_invalid`), `source_refused` (a command
answered with an error, its Home Assistant code in the message),
`source_timeout` (no answer within `timeoutMs`, 30 s by default),
`source_unavailable` (the socket failed or closed), `entity_not_found`.

## What it never does

It reads only. A value a person wants of a device is a command of the
`actions` module, proposed, validated by the person and carried out by a
connector, never written by this read. It converts no unit and invents no
value: the snapshot carries what the installation says, and the `building`
module's importer converts by the `units` vocabulary.
