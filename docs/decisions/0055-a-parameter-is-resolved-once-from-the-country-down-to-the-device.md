# 0055 — A parameter is resolved once, from the country down to the device; what an owner may choose is a parameter, never a method constant

> Status: accepted · amends [0021](0021-one-cascade-of-defaults.md)

## Context

[0021](0021-one-cascade-of-defaults.md) gave the model one cascade,
`parameter_of()`, and [0053](0053-a-technology-figure-holds-everywhere-below-every-place.md)
a generic level below every place. The cascade is right; what reaches it
was not.

The first yield in one command (`solar estimate`) read its system loss from
the yield profile: 14 % written in `solar.yield_profiles`, beside the Faiman
coefficients, as if it were part of the model. An organisation that had
measured its own installations and set 2.5 % could not say so, and every
yield it asked for came out 9 to 12 % low. Checked on five real roofs in
France (5° to 25°, south to south-west, 34 to 396 kWp), PVGIS with the
organisation's 2.5 % gives the value the production platform shows to the
kWh, and the estimate with the profile's 14 % gives 9 to 12 % less. Same
irradiance, same engine; one number read from the wrong place.

The Nexgen platform in production, from which this model is drawn, shows
the other side of the same lesson. Its values climb participant → project →
organisation → platform default, the first one set answering, with the
level shown beside the value in the forms ("inherited from the
organisation", "platform default") and in the annex of a report. Years of
projects proved that order. What it also shows is what happens without one
resolver: about ten separate cascades (economic parameters, PV yield hours,
device production hours, device cost, battery conventions, chargers,
degradation, report assumptions, solar losses), three tables of yield hours
per country that disagree, a country hard-coded in two SQL functions, a
system loss settable on the organisation only, and a stored `0` that
silently stops the cascade where the form meant "empty".

This decision keeps the order that platform proved, and the single resolver
that platform lacks.

## Decision

**1. One order, from the least specific to the most specific; the most
specific value set answers.**

| Level | Holds | Written by |
|---|---|---|
| generic | a cited technology figure, the same everywhere ([0053](0053-a-technology-figure-holds-everywhere-below-every-place.md)) | the module that reads it |
| country | what the country decides or publishes, dated and cited | the country pack |
| region, municipality | what a subdivision decides, climbing to its parent | the country pack |
| organisation | what the owner chose for all its projects | the organisation |
| project | what holds for one project | the project's members |
| group of participants | what holds for a group | the project's members |
| participant | what holds for one place and its meter | the project's members |
| device | what holds for one piece of equipment | the project's members |

Read top-down, each level refines the one above; resolved, `parameter_of()`
starts at the object and climbs (device → participant → group → project →
organisation → municipality → region → country → generic), and the first
level holding a value answers. A country default sits above the
organisation: an owner's choice always wins over the country's, and the
country's over the generic figure. An array of a PV system reads its
device's chain.

**2. What an owner may legitimately choose for an installation is a
parameter, resolved by `parameter_of()`.** The test is one question: *could
two owners of the same model, with the same weather, rightly use two
different values?* If yes, the value is a parameter: a system loss, a
soiling loss, a temperature coefficient of a module, an albedo, a
degradation rate, a lifetime, an efficiency, a price, a tax, an
indexation. If changing it changes the model itself — the Faiman U0 and
U1 of a profile, a transposition model, the constants of PVWatts — it is a
method constant and stays in the profile ([0021](0021-one-cascade-of-defaults.md)).

A profile that needs a parameter names it (`system_loss`), and the value it
used to carry becomes the generic level of that parameter, published by
the module with its source (PVGIS PVcalc's 14 % default). The profile
keeps no number an owner could want to change.

**3. Every level of the chain may hold every parameter**, unless the
attribute type restricts the kinds of objects it applies to, by name and
with a reason. A parameter settable on the organisation only is the
exception that must be written down, not the default.

**4. Unset is absent; zero is a value.** An unset level holds no attribute.
A form, an import or an agent never writes `0`, `''` or `false` for an
empty field; it removes the attribute. A `0` stored is an answer and stops
the climb, as it should when someone means zero.

**5. One resolver, no fallback outside it.** A module, the command line,
the MCP server and a client read a parameter through `parameter_of()` and
only through it. No `?? 0.14`, no country table in code, no `case` on a
country, no second cascade in TypeScript: a TypeScript gesture calls the
function. A missing value raises `parameter_missing` with the parameter
and the level reached ([0038](0038-everything-raises-by-name.md)), never a
number borrowed from elsewhere.

**6. The answer says where it comes from, and the figure keeps it.** Every
answer carries its level, the object or place that held it, its source,
quality and date. A figure records them in its inputs
([0004](0004-a-figure-says-where-it-comes-from.md)): a change at the
organisation applies to the figures computed after it, and a past figure
still says which number it read. A surface that shows a resolved value
shows its level beside it, as the production platform does.

**7. A change of resolution is checked against what already works.** A
pull request that moves a parameter into the cascade, adds a level or
changes a default compares, on the same inputs, its result with the Nexgen
platform in production, with a PV*SOL study where one exists, and with
three to five real projects described without naming their owners
("France, 57 kWp, 25°"). The table (reference, value, gap) goes in the pull
request; a gap above 1 % that is not explained blocks it.

## Mapping from the production platform

| Production platform | This model |
|---|---|
| participant row of the economic parameters | attribute of the participant |
| project row (`participant_id is null`) | attribute of the project |
| `organisation_defaults` | attribute of the organisation |
| country tables of yield hours, national rates | the country pack (`defaults`), dated and cited |
| component defaults, `FALLBACK_*`, engine defaults | the generic level, published by the module with its source |
| `EconomicParamLevel`, the report's `scope` | the `level` of the answer |
| device columns (tilt, orientation, degradation) | what is measured stays a fact of the device; what is chosen is an attribute of the device |

## What it forbids

- A number an owner could choose, written in a profile, a module's code or
  a client.
- A parameter that only one level may hold, without a written reason.
- A stored `0` meaning "not set".
- A resolver beside `parameter_of()`, in SQL or in TypeScript.
- A resolved value shown without its level.

## Where it stands

- `system_loss` is the first parameter moved: the `solar` module publishes
  it with PVGIS PVcalc's 14 % at the generic level, `pvgis_like` and
  `pvwatts` name their `system` loss without a value, and an estimate
  records the fraction and its level. `soiling_loss` already climbed the
  chain.
- The temperature coefficient γ of `pvwatts` is read from the module
  product, else from the request: it has no cascade yet and is the next
  one to move.

## See also

- [0021](0021-one-cascade-of-defaults.md) — the cascade and its order.
- [0053](0053-a-technology-figure-holds-everywhere-below-every-place.md) — the generic level.
- [0012](0012-a-yield-says-what-it-was-computed-from.md) — a yield says what it was computed from.
- [0057](0057-one-word-per-thing-in-the-lists-of-the-core.md) — the quality of a value.
