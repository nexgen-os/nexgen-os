# `contracts` — the contracts energy is bought and sold under, and their prices

Status: shipped. Schema: `contracts`.

A site buys from a supplier and sells its surplus to a buyer; a roof plant
sells its production to the company under it; a company hedges its
consumption with a virtual PPA on a wind farm far away; a community sets
the price its members pay for the energy they share. Each of these is a
contract, and what it costs is a price that holds on an interval of time.
This module holds both. It computes no amount: who owes how much to whom
over a month is a run, computed by an application or by an engine, and the
invoice lives in Ekwo (decision [0010](../../docs/decisions/0010-ekwo-link.md)).

## What it adds to the core

| Table | Holds |
|---|---|
| `contracts.contract_types` | what a contract is about: `supply`, `injection`, `ppa_physical`, `ppa_virtual`, `community_tariff`, `market`, each with the way energy goes for the holder of the delivery point (`offtake`, `injection`, `both`) and whether energy is delivered or only settled. A vocabulary: read by everyone signed in, written by migrations, modules and packs. |
| `contracts.price_indices` | the market indices a price may follow — a day-ahead price of a bidding zone, a monthly average, a regulated tariff — with the currency (ISO 4217) and the unit of energy they are quoted in, and their source. The module ships none: the packs and the installation publish theirs. |
| `contracts.contracts` | an object (`contract`): its type, its two parties as contacts (a null party is the organisation that holds the row), what it covers (a meter, a participant, a project, at least one), how its volume is counted (`pay_as_consumed`, `pay_as_produced`, `allocated_power` with its kW), its priority among the contracts of a point (1 first), the days it holds (the first included, the last excluded), its status (`draft`, `signed`, `cancelled`). The signed document and its amendments attach to it. |
| `contracts.price_signals` | what a contract costs on an interval of time, start included, end excluded (no end: until further notice): a `fixed` price, a price `indexed` on a named index (multiplier × index + adder), a `cap` or a `floor`, in the currency and per the unit of energy of the row (`KiloW-HR`, `MegaW-HR`), with who says so. An hourly grid is one row per hour, as OpenADR 3 sends it. |

A contract's parties are contacts of its organisation; a participant it
names is in the project it names; a meter it names is one the participant
is behind (a group is behind the meters of those it gathers). Two signals
of one kind never cover the same instant of a contract; an indexed price is
quoted in the currency and unit of its index, since the module converts
none. Contracts and signals may exist only in a scenario, like any object.

## The contracts of a point on a day

```sql
select contracts.in_force(:meter, date '2026-06-20');
-- [{"name": "Roof plant PPA", "type": "ppa_physical", "direction": "offtake", "physical": true, "priority": 1, "volume_basis": "pay_as_produced", …},
--  {"name": "Community tariff — cold store", "type": "community_tariff", "priority": 2, …},
--  {"name": "Cold store supply", "type": "supply", "priority": 3, …},
--  {"name": "Wind hedge", "type": "ppa_virtual", "physical": false, "priority": null, …}]
```

The contracts of a meter are those on the meter and on the participants
behind it, groups included; those of a participant, its own and those of
its meters; those of a project, its own and those of every participant
and meter taking part. Only signed contracts holding on the day are given,
by priority, those without one last. The day is always given: the same
call gives the same answer. It reads under the caller's row level
security, and takes a scenario as its third argument.

## What a contract sets at an instant

```sql
select contracts.prices_at(:supply, timestamptz '2026-06-20 12:00+02');
-- {"contract_id": …, "at": …, "signals": {
--    "indexed": {"index_code": "day_ahead_se4", "index_multiplier": 1, "index_adder": 45, "currency": "SEK", "per_unit": "MegaW-HR", …},
--    "cap":     {"price": 1400, "currency": "SEK", "per_unit": "MegaW-HR", …},
--    "floor":   {"price": 150, …}}}
```

One signal per kind: in a scenario, the scenario's own before its
parent's, and those before the world as it is. It computes no price from
an index; the run that settles reads the index's value.

## What stays outside

- The amounts: a settlement — volume times price, the order energy is
  matched with contracts, pay as consumed or as produced — is a run of an
  application or of an engine that reads these rows.
- The invoice: Ekwo's, which keeps who is legally a party.
- The values of an index and the carbon intensity of the grid: series of
  the core, read beside the contracts.
- The components of a grid tariff (per kW, per month, per day) and the
  taxes of a country: the `grid` module and the packs.

## Later

An engine contract for settlement (contracts, signals and series in, lines
per contract and party out), the passage of a settlement line to an Ekwo
document, the import of a supplier's contract and the export of signals
in the formats tariffs are exchanged in.
