# 0058 — A flexible device is a device, an activation is a command

> Status: proposed

## Context

The `flexibility` module is listed as proposed in [`modules/README.md`](../../modules/README.md)
and on the [road to 1.0](../road-to-1.0.md): the activation of a flexible
device — a battery, a charger, a heat pump, a PV plant curtailed — by a
grid operator, an aggregator or an energy manager, its ramp, the deviation
of what was delivered from what was asked, and the pooling of devices into
one offer. What a producer or a community lacks today is the same in every
country: the record of each activation, its deviation, its penalty and its
remuneration; the activation seen as an event of the place rather than a
fault; and the proof of the power available, interval by interval.

The model already holds most of what this needs. A device is an object of
the core ([0006](0006-the-core-names-six-objects.md)), its time-varying
values are its series ([0022](0022-the-instrument-is-a-device-the-point-is-the-series.md)),
a value asked of a device at an instant is a command of the `actions`
module ([0017](0017-an-action-is-something-to-do.md)), a charging profile
already rides on it ([0047](0047-a-charging-profile-is-a-command.md)), the
market of a place and its parties are `grid`'s
([0049](0049-the-market-follows-the-place-a-scheme-is-the-countrys-its-contract-the-devices.md)),
and a computed figure lives in a table named after what it gives, with its
inputs and its provenance ([0004](0004-a-figure-says-where-it-comes-from.md)).
This decision names the four objects of the module, their fields, their
units and their links, before any migration; it adds no object beyond
them.

## Decision

**Four objects, each in one of the three forms of
[0042](0042-a-module-starts-from-an-object-of-the-core.md).**

| Object | Table | Form | Holds |
|---|---|---|---|
| flexible asset | `flexibility.devices` | derived, the device's id | what a device can be asked |
| offer | `flexibility.offers`, `flexibility.offer_devices` | secondary, to the organisation's participant and its devices | what is offered, when, at which price |
| activation | `flexibility.activations` | secondary, names its command by id | what was asked, by whom |
| settlement | `flexibility.settlements` | a figure of the module | what was delivered and what it is worth |

**A flexible asset is a device**, enriched with the same id
(`flexibility.devices`, written through `derive_devices()` for any device
type): the power it can be asked upwards and downwards (`power_up_kw`,
`power_down_kw`, kW, from its operating point), its ramp (`ramp_kw_per_min`,
kW/min), its minimum step (`min_step_kw`, kW), its minimum and maximum
duration of an activation (`min_duration`, `max_duration`, intervals) and
the time it needs to be ready (`notice`, an interval). Its availability
changes with time, so it is not a column: it is two series of the device,
`flexible_power_up` and `flexible_power_down` (kW, quality `estimated` when a
module computed them, `published` when the operator of the device sent
them), dated at the start of their interval. A site is not a fourth kind of
asset: the flexibility of a place is the devices of its participant
([0043](0043-the-participant-is-the-node.md)), pooled in an offer.

**An offer pools devices for a product in a window.** `flexibility.offers`
belongs to a participant (the place that offers) and lists its devices in
`flexibility.offer_devices`; it names its product by the code a pack
publishes (`product_code`, a vocabulary of the module written by packs —
no product in code, [0020](0020-a-pack-holds-what-a-function-reads.md)),
its direction (`up` or `down`), its window (`window_start`, `window_end`,
UTC, the start of the first interval and the end of the last), its volume
(`volume_kw`, kW), its price (`price_per_mwh`, in the `currency` of the
market of the place, never assumed), and the party it is offered to, as a
contact of the core (`contact_id`), whose role — aggregator, balancing
service provider — is `grid`'s to say (`grid.market_parties`); no table of
the module names a table of another. Its `status` is its own lifecycle,
short and without a person's gesture inside: `draft`, `submitted`,
`accepted`, `rejected`, `withdrawn`, `expired`.

**An activation is a command.** Asked by a grid operator, an aggregator or
an energy manager, an activation is one action of kind `command` per device
of the offer (`actions.command()`), on the setpoint series of the device —
the power asked, kW — at the start of the activation; its effect is that
series, exactly as for a charging profile
([0047](0047-a-charging-profile-is-a-command.md)). The activation itself is
a row of `flexibility.activations`: its offer (or none, for an activation
outside an offer), its direction, `start_at` and `end_at` (UTC), the power
asked (`requested_kw`, kW), who asked (`requested_by`, a contact of the
core, and `requested_role`, the market role in `grid`'s words), the
reference the requester gave it (`external_ref`), and the ids of its
commands; it holds no foreign key to the `actions` module. One lifecycle:
validated by the person, or by an agent the person allowed, carried out by
a connector, reported done or failed with its reason (`actions.report()`).
What the device delivered is never a column of the activation: it is read
from the series of its meter, which measures offtake and injection.

**A settlement is a figure.** `flexibility.settlements`, one row per
activation and per method, with its subject (the activation), its
`provenance` (the program and its version, or the requester when the
settlement was received), its `inputs` (the series read, the baseline
method and its parameters, the rules of the product in the pack, by
version) and its `results`: the energy adjusted (`adjusted_kwh`, kWh,
against a baseline named by the method the literature cites it by), the
power delivered interval by interval (a series of the settlement), the
deviation from the power asked (kW and per cent), the penalty and the
remuneration (in the currency of the market). `flexibility.settle(activation,
method)` computes it; a settlement sent by an aggregator is imported with
quality `published` beside the one the module computed, and the two are
compared, never merged.

## Consequences

- An activation is seen where every command is seen: what a person reads of
  a place — steps, recommendations, commands — stays one list, and an
  activation is an event of the place, never a fault.
- The power asked, the power accepted and the power delivered are three
  things in three places: the activation, the setpoint series of the
  device, the series of its meter.
- What a country decides — its products, their minimum volume, their ramp
  and tolerance rules, their penalties — is data of its pack, dated and
  sourced; the module computes with the rules it is handed.
- A connector to an aggregator declares a device, receives an activation
  and sends back what was delivered and the settlement; it speaks the
  aggregator's protocol, the module never does.
- The `flexibility` module requires `actions`; installed without `grid`, an
  offer still names its party as a contact, without its market role.
- The available power down of a PV plant, the activation rate and the
  revenue per MW and per month are indicators of the module, kept as its
  figures; they come after these four objects.
