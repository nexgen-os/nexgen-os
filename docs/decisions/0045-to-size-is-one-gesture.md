# 0045 — To size is one gesture, `size()`, with a named criterion

> Status: accepted

## Context

How much PV a roof should carry, how large a battery a site needs: the
platform built on this core calls it sizing, everywhere — its screens say
"Dimensionnement", its engine returns an optimal and a suggested power. An
engine that sized on a criterion nobody chose (a self-consumption rate of
60 % implied by default) diverged in silence from every other caller, and
the platform made the criterion mandatory. Two modules of this core size
(`solar`, and `battery` next to it); written apart, they would name the
same gesture two ways and aim at criteria written two ways.

## Decision

**To size is one gesture, one word.** A module that can size offers
`<module>.size(subject, criterion, bounds)`. "Optimise" is kept for
operating equipment in time — a dispatch, a charging schedule — never for
choosing its size.

**The criterion is named, never implied, from one vocabulary of the core.**
`sizing_criteria` holds `self_consumption_rate` and `self_sufficiency` (a
target between 0 and 1), `payback` (the shortest), `net_present_value` (the
largest; not building is worth zero) and `max_power` (the largest the limit
allows: the roof, the connection). Every module that sizes reads it; a
criterion a module cannot size for is refused by name.

**The bounds are physical and say where they come from.** A stated maximum,
with its source, or the description of the place: the roof faces of the
`building` module times the power a square metre carries, a parameter
(`pv_power_per_area`) resolved like any other.

**A sizing is a figure.** It sweeps the sizes up to the limit, writes the
curve and the recommended point as an estimate of the module about the
subject (`kind = 'sizing'`), with the criterion, the bounds, the curves and
the money it read ([0004](0004-a-figure-says-where-it-comes-from.md)).
Money is the caller's, in the currency of the place.

## What it forbids

- A function that sizes under another name (`optimal_kwc`, `optimise_pv`).
- A default criterion, or a criterion spelt in a module's own words.
- A recommended size without the curve it was chosen on.

## See also

- `modules/solar/src/size.ts`; the platform's rule, `utils/solarSizing.ts`
  (the economic criterion and the target self-consumption rate).
- [0018](0018-one-function-per-gesture.md), [0041](0041-a-module-names-one-thing.md).
