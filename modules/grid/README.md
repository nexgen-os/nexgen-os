# `grid` — the grid side of a connection point

Status: shipped with schema 0.3. Schema: `grid`.

The connection point is the core's: `meters`, the identifier its operator
knows, carried by a participant, what it can do (take, inject, both) and
the period that identifier names it, with `declare_meter()` and
`close_meter()`; the devices of that participant are behind it
([docs/model.md](../../docs/model.md)).
This module starts from that meter and adds what the grid knows about it
(decision [0042](../../docs/decisions/0042-a-module-starts-from-an-object-of-the-core.md)):
who runs the grid, and how each point is connected to it.

| Table / function | Holds / does |
|---|---|
| `grid.operators` | the distribution and transmission operators of a country, what they cover, where a third party reads meter data with the customer's consent, and the identifier scheme of the metering points they issue; a vocabulary written by the country packs |
| `grid.meters` | one row per meter that has grid details, with the meter's id: the operator that runs it and the voltage level it is connected at (a code of the country's `voltage_levels`); its organisation is the meter's, copied; it goes with its meter. Subscribed power is an attribute of the meter |
| `grid.connect_to_operator()` | says which operator runs a meter, and at which voltage level; a second call updates it; refuses `meter_not_found`, `grid_operator_unknown` |

A country pack with `grid.json` operators lists `grid` in its modules; its
operators land in `grid.operators` only. Install: `npx nexgen-os init --modules grid`.
