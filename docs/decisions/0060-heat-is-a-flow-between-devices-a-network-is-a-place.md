# 0060 — Heat is a flow between devices, a network is the place they share

> Status: proposed

## Context

Heat is an energy of the place as electricity is: a heat pump, a boiler, a
solar thermal collector, a borehole or the waste heat of a data centre or
of a process gives it; a building, a process or a tank takes it; a heat
network carries it from the ones to the others, and a community may share
it. What a producer, a network operator or a community lacks is the same
in every country: the heat each source gave, at which temperature, the heat
each sink took, what the network lost on the way, and who is owed what for
heat shared.

The model already holds most of what this needs. A meter carries the
resource it measures, and `heat` is one of them in the core
(`meters.resource`); a source, a sink or a tank is a device of the core
([0006](0006-the-core-names-six-objects.md)), its time-varying values are
its series ([0022](0022-the-instrument-is-a-device-the-point-is-the-series.md));
the participant is the node of every flow
([0043](0043-the-participant-is-the-node.md)); a module starts from an
object of the core ([0042](0042-a-module-starts-from-an-object-of-the-core.md))
and names one thing with its own physics
([0041](0041-a-module-names-one-thing.md)); and a computed figure lives in
a table named after what it gives, with its inputs and its provenance
([0004](0004-a-figure-says-where-it-comes-from.md)). The `heating` module
proposed in [`modules/README.md`](../../modules/README.md) designs the
equipment of one building; this decision names the objects of the flow
between places, before any migration, and adds none beyond them.

## Decision

**The module is `heat`, and it names four objects, each in one of the three
forms of [0042](0042-a-module-starts-from-an-object-of-the-core.md).**

| Object | Table | Form | Holds |
|---|---|---|---|
| heat device | `heat.devices` | derived, the device's id | its role and the temperatures it works at |
| network | `heat.networks`, `heat.network_participants` | secondary, to a project and its participants | the places a heat network joins |
| balance | `heat.balances` | a figure of the module | what was given, taken and lost, interval by interval |
| sharing | `heat.settlements` | a figure of the module | who gave and who took heat shared, by a key |

**A source, a sink and a tank are devices**, enriched with the same id
(`heat.devices`, written through `derive_devices()` for any device type):
their `role` (`source`, `sink` or `storage`), the carrier (`water`,
`steam`, `air`, a vocabulary of the module), the temperatures they supply
and return at (`supply_temperature_c`, `return_temperature_c`, °C, as
designed), their thermal power (`thermal_power_kw`, kW) and, for a tank,
its capacity (`capacity_kwh`, kWh thermal). The origin of the heat of a
source — a fuel, the ambient air, the ground, the sun, the waste heat of a
named process — is its device type, never a column of text. What changes
with time is a series of the device: the heat given or taken
(`heat_energy`, kWh thermal, dated at the start of its interval), the
supply and return temperatures measured (°C), the state of charge of a
tank (kWh). The electricity a heat pump draws stays on the meter it sits
behind, which measures offtake and injection.

**A network is the place the devices share.** `heat.networks` belongs to a
project and joins participants through `heat.network_participants`; a
participant that takes heat from it carries a meter whose resource is
`heat`, and a participant that gives heat carries its sources. The network
holds its design temperatures and its length (`length_m`, m); its losses
are not a column: they are a figure.

**A balance is a figure.** `heat.balances`, one row per network or per
participant, per period and per method, with its `provenance` (the program
and its version), its `inputs` (the series read, the method and its
parameters) and its `results`: the heat given by each source, taken by
each sink, stored and released, and lost on the network, each as a series
of the balance in kWh thermal. `heat.balance(subject, from, to, method)`
computes it with a method the literature cites by name; the fine physics
of a network or of a building is an engine outside the module, called with
its model as data, whose result lands here with its provenance.

**Heat shared is settled as electricity shared is.** `heat.settlements`,
one row per network, per period and per key, holds the heat each
participant gave and took, and its value in the currency of the place when
a price is handed to it; the key is the engine of
[0056](0056-the-key-a-community-applies-is-its-engine.md), and what a
country decides about heat sharing is data of its pack.

## Consequences

- A heat network is described with the gestures already known: declare a
  meter with resource `heat`, install a device, import a series, compute.
- Heat and electricity of the same place meet at the participant: a heat
  pump is a device of `heat` with its electricity on the participant's
  meter, and a data centre's waste heat is a source of a network joining
  its neighbours, never a fault of the data centre.
- What a country decides — the eligibility of a heat network, its sharing
  rules, the factor of a fuel — is data of its pack, dated and sourced.
- A connector to a heat meter or a network supervisor writes the series of
  the devices and meters; it speaks their protocol, the module never does.
- The `heating` module keeps the design of the equipment of one building
  and reads the heat devices of this module when both are installed; the
  efficiency of a network and the share of renewable heat are indicators of
  the module, kept as its figures, and come after these four objects.
