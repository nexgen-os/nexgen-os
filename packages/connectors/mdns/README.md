# `@nexgen-os/mdns` — the devices of a place found on its own network

Many devices of a place announce themselves on its local network: a meter
dongle, a charging station, an inverter, a heat pump, a home automation
box. They do it by DNS-based service discovery
([RFC 6763](https://www.rfc-editor.org/rfc/rfc6763)) over multicast DNS
([RFC 6762](https://www.rfc-editor.org/rfc/rfc6762)): each one is an
instance of a service type (`_<service>._tcp`) with a name, a host, a port,
its addresses and a few key=value pairs. This package asks for the service
types it is given and gathers what answers. MIT, no dependency, no database.

```ts
import { discover, matchDiscovered } from '@nexgen-os/mdns';

const { services } = await discover({ services: ['_http._tcp', '_example._tcp'], timeoutMs: 3000 });
// [{ name: 'Meter', service: '_example._tcp', host: 'meter-0a1b2c', port: 80,
//    addresses: ['192.168.1.42'], txt: { api_enabled: '1', path: '/api/v1' } }]

const proposals = matchDiscovered(services, catalogue);
// [{ service: { … }, keys: ['meter/example'] }]
```

It runs on a machine of the place's own network — a gateway, a laptop
during the installation, a box at the meter — never from a server
elsewhere: multicast does not leave the network it is sent on.

## What it gives

| Function | What it does |
|---|---|
| `discover({ services, timeoutMs, transport })` | Sends a one-shot query for the PTR records of the service types (twice: at the start and at a third of the time, as a lost multicast packet is common), reads every answer within `timeoutMs` (3 s by default), and returns the instances found and the number of messages it could not read |
| `instancesOf(records, services?)` | Assembles instances from records: a PTR of a service type gives an instance, its SRV its host and port, its TXT its pairs, the A and AAAA of the host its addresses. An instance whose SRV has not come yet keeps `host` and `port` null; one that said goodbye (a PTR with a time to live of zero) is left out |
| `matchDiscovered(found, candidates)` | For each service found, the keys of the catalogue entries it may be — by service type, or by host name pattern (`*` for any run of characters, case ignored). A service no entry matches comes back with no key |
| `readMessage(bytes)`, `writeMessage(message)`, `queryOf(services)` | DNS messages read and written: questions, and answer, authority and additional records of types A, AAAA, PTR, SRV and TXT; compressed names are read, names are written whole |
| `udpTransport({ interface })` | The network: a UDP socket on a port of its own, which sends to `224.0.0.251:5353` and receives the answers responders send it by unicast (RFC 6762 §5.1), so that it runs beside the machine's own responder. `discover()` takes any `MdnsTransport` instead, for a test or another network stack |

The catalogue is data: an entry is `{ key, mdns, hostname }`, the shape of
the discovery section of an evcc template as `@nexgen-os/evcc` reads it, or
a list an installation keeps. Nothing here knows a brand or a model, and
what is found is a proposal: the person installing a device says which one
it is before a connector reads it.

## Refusals

- `service_invalid`: a service type that is not `_<service>._tcp` or
  `_<service>._udp` (with or without `.local`);
- `message_invalid`: a message cut short, a name that points outside the
  message or in a loop, an address or a label that cannot be written.
  `discover()` skips such an answer and counts it in `unreadable`.

## What it does not do

It does not answer queries, keep a cache, follow a device as it comes and
goes, or query IPv6 multicast (`ff02::fb`); the TXT values are read as
UTF-8 text. A device that does not announce itself is found by its address,
given by the person.
