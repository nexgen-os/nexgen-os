# 0016 — Third-party tools and methods: where their names go

**Decided 15/10/2026.** Builds on [0011](0011-external-data.md)
(connectors and sources), [0012](0012-solar-module.md) (named yield
profiles) and [0013](0013-external-engines.md) (external engines).

## Context

Nexgen OS leans on other people's work at every step: a weather service,
a PV library, the file an installer's tool writes, a published method of
the literature. Each time, the question comes back: does the thing keep
the third party's name, or is it rewritten under a generic name of ours?
Both answers are right somewhere, and a wrong one costs: a generic name
over a rewritten method hides which model ran and makes two runs
incomparable; a vendor's name over our own code claims a thing we did not
write and may not reproduce.

## Decision

**Generic function, named model, cited source.** A third party's name
lives in exactly three places, each with its rule; everywhere else a
function says what it computes and takes the model as data.

| Family | What the third party brings | Its name is… | Rewritten? |
|---|---|---|---|
| `connectors/<provider>` (open-meteo, pvgis) | data | the provider's: the data stays theirs, with its licence and version, recorded as the `source` of every series ([0011](0011-external-data.md)) | never |
| `engines/<tool>` (pvlib) | a computation, JSON in and JSON out | the tool's: a run records `engine` and its version, or it cannot be replayed ([0013](0013-external-engines.md)) | never |
| `formats/<format>` (weather-files, panond, ifc, cityjson) | a file we read | the format's when it is a standard (EPW, TMY3, IFC, CityJSON), the vendor's file name when the format is theirs (PAN and OND of PVsyst) | read, never written |
| a model inside `modules/` (`pvwatts.ts`, the Sandia inverter model, `exceedance()`) | a published method | the method's public name, as the literature cites it (NREL PVWatts, SAND2007-5036, IEC 61724-1): a reference, not a brand | yes, with the reference in the docstring |

Three rules follow.

1. **Only published, open methods are rewritten.** A proprietary tool
   (PVsyst, PV\*SOL, SAM's closed parts) is read through its files and
   compared against, never re-implemented from its behaviour. A yield
   profile named `pvsyst_like` or `pvsol_like` says it *imitates* that
   tool's chain of losses for a calibration ([0012](0012-solar-module.md));
   the suffix is the claim's limit. These are the only places a vendor's
   name appears outside `formats/`.
2. **The function is generic; the model is a parameter the run keeps.**
   `yield(system, profile)` takes `pvwatts` or `pvgis_like`;
   `sharing.allocate(community, period, key)` takes `fixed`,
   `proportional`, `dynamic` or `p2p`; the inverter run says
   `model: sandia`. A function named after a model (`pvwattsYield`,
   `sandiaEfficiency`) is a sign the model should be data.
3. **Nothing of a country or of a product of ours in a name.** The order
   of an energy-sharing cascade, a ceiling, a tariff rule are data of a
   country pack; a method is never called after the platform that first
   ran it. A sentence of [AGENTS.md](../../AGENTS.md) carries this rule
   to whoever writes code here.

## Consequences

- A reader of a run knows what ran (`engine`, `model`, `profile`, source
  of each series) without opening the code.
- Adding a model is adding a value and its implementation behind a
  generic function, never a second function beside it.
- The energy-flow modules to come (`consumption`, `sharing`, `storage`)
  port Nexgen's computations under generic names; the method of each
  allocation key and dispatch is named and cited, the national rules sit
  in the packs.
