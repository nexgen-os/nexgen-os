# 0016 — A third party's name goes where its data, its computation or its file is

> Status: accepted · 15/10/2026, rewritten 19/10/2026

## Context

Nexgen OS leans on other people's work at every step: a weather service, a
PV library, the file an installer's tool writes, a published method of the
literature. Each time the question comes back: does the thing keep the
third party's name, or is it rewritten under a generic name? Both answers
are right somewhere, and a wrong one costs: a generic name over a rewritten
method hides which model ran and makes two runs incomparable; a vendor's
name over code written here claims a thing the vendor did not write and may
not reproduce.

## Decision

**Generic function, named model, cited source.** A third party's name lives
in exactly four places, each with its rule; everywhere else a function says
what it computes and takes the model as data.

| Where | What the third party brings | Its name is… | Rewritten? |
|---|---|---|---|
| a connector (Open-Meteo, PVGIS) | data | the provider's: the data stays theirs, with its licence and version, recorded as the source of every value ([0011](0011-external-data.md)) | never |
| a program connector (pvlib) | a computation, JSON in and JSON out | the tool's: a run records the engine and its version, or it cannot be replayed ([0013](0013-external-engines.md)) | never |
| a format library (EPW, IFC, CityJSON, PAN and OND) | a file | the format's when it is a standard, the vendor's file name when the format is theirs ([0035](0035-a-format-library-touches-no-database.md)) | read, never re-implemented from behaviour |
| a model inside a module (PVWatts, the Sandia inverter model) | a published method | the method's public name, as the literature cites it (NREL PVWatts, SAND2007-5036, IEC 61724-1): a reference, not a brand | yes, with the reference beside the code |

**Only published, open methods are rewritten.** A proprietary tool (PVsyst,
PV\*SOL, the closed parts of SAM) is read through its files and compared
against, never re-implemented from its behaviour. A profile named
`pvsyst_like` or `pvsol_like` says it *imitates* that tool's chain of losses
for a calibration ([0012](0012-solar-module.md)); the suffix is the claim's
limit. These are the only places a vendor's name appears outside a format
library.

**The function is generic; the model is a parameter the run keeps.** A
yield takes a profile (`pvwatts`, `pvgis_like`); an allocation takes a key
(`fixed`, `proportional`, `dynamic`); an inverter run says its model
(`sandia`). A function named after a model is a sign the model should be
data.

**No country and no product in a name.** The order of an energy-sharing
cascade, a ceiling, a tariff rule are data of a country pack; a method is
never named after the platform that first ran it.

## What it forbids

- A function named after a model, a country or a product.
- A proprietary tool re-implemented from its behaviour.
- A rewritten method without the reference it implements.
- A vendor's name outside a connector, an engine, a format library or a
  profile that says it imitates.

## What it replaced

Names chosen case by case: functions named after the model they happened to
implement, and methods named after the product that first ran them.

## See also

- Inherits Ekwo OS 0063 (*A module code outlives its names*), for the
  permanence of a name once written on data.
- [`AGENTS.md`](../../AGENTS.md), "For an agent working on the code".
- [0024](0024-one-language-per-layer.md) — where code in another language
  goes.
