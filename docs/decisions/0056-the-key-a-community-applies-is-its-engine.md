# 0056 — The key a community applies is its engine; the module keeps the model and checks the physics

> Status: accepted

## Context

Energy sharing answers one question — who, among the participants of a
project, received how much of the energy the others injected — and every
operation answers it its own way. Fixed shares voted by a general
assembly, shares in proportion to offtake, an order of priority, a
cascade from a site's own consumption to its community, a key that moves
with the hour or the price: the methods differ between countries, between
operators of one country and between projects of one operator, and they
change when a general assembly votes again. The people who run a
community want to write their own key and to read the one they apply.

A sharing function in a module would pick one of these methods for
everybody, or grow one branch per method, per country and per operator;
the module would then hold what a pack or a statute decides, against
[0020](0020-a-pack-holds-what-a-function-reads.md), and its figure would
be the module's and not the community's.

## Decision

**How energy is shared is a program of the `energy_sharing` kind**
([0013](0013-a-program-connector-reads-one-request.md)): one request in,
one result out, in any language, never reading the database. Its request
holds the participants of the period with their role and their
attributes, the offtake and the injection metered behind each one, kWh per
step on one grid of steps, the allocation key as the project holds it
(`method`, `parameters`) and the rules of the country or the project as
the caller passes them. Its result says, for each participant and step,
what it received from the sharing and gave to it, and what is left for
its supplier and the grid.

**The `community` module keeps the model.** The allocation key is an
attribute of the project, with its period and its source; what a key
reads of a participant (`allocation_share`, `allocation_rank`…) is an
attribute of the participant; the consents and the perimeter are the
module's, the perimeter rule its pack's. `settleSharing()` gathers the
request, starts the program the caller names and stores its answer as a
settlement of the module, with the program, its version and its inputs:
the figure says which key computed it.

**The module checks the physics of every answer** before anything is
stored: at every step a participant receives at most its offtake and gives
at most its injection, and the project shares no more than it gave, nor
more than the smaller of its total injection and its total offtake
(`settlement_exceeds_physics`). A key decides who receives; it never
creates energy.

**The repository ships one program to copy**, `sharing_example`, which
shares in proportion to offtake and knows no rule. A community's own key
lives in its own package, open or private
([0011](0011-external-data.md)), and is started by the same contract.

## What it forbids

- A sharing method, a national sharing rule or an operator's key as a
  function of a module or of the core.
- A settlement stored without the program and the version that computed
  it, or that an engine answered beyond the physics of its inputs.
- A program that reads or writes the database, or a module that guesses
  which program to start: the caller names it.
- A key held anywhere but as an attribute of its project, with its period
  and its source.

## See also

- [0013](0013-a-program-connector-reads-one-request.md) — a program
  connector reads one request.
- [0004](0004-a-figure-says-where-it-comes-from.md) — a figure says where
  it comes from.
- [0020](0020-a-pack-holds-what-a-function-reads.md) — a pack holds what a
  function reads; the perimeter rule of a country is its pack's.
- [0010](0010-the-participant-is-billed-ekwo-os-keeps-the-invoice.md) —
  the volumes shared become settlement lines, invoiced by Ekwo OS.
- [`modules/community/README.md`](../../modules/community/README.md#energy-sharing)
  and [`packages/connectors/sharing-example`](../../packages/connectors/sharing-example/README.md).
