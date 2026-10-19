# 0021 — One cascade of defaults, and no global fallback

> Status: accepted · 19/10/2026

## Context

A yield, a sizing or a settlement starts from values nobody has measured
yet: a system loss, a degradation rate, a share of self-consumption, a
reference price. Before this rule each module found them its own way: one
read a column of the organisation, another a constant in its code, the
weather module its own order of project, connection, pack and core. Two
modules asked the same question and got two answers, and a figure computed
for one country silently used a number chosen for another when the pack had
none.

## Decision

**A default is a value of a level, and one function resolves it, in one
order**: the object itself, then its parents (a device's site, a site's
project), then its organisation, then the region of its place, then its
country. The first level that holds a value answers, and the answer says
which level it came from.

**Below the country, a default is an attribute.** The object, its parents
and its organisation hold their own values as attributes, with a period and
a source like any other fact ([0019](0019-a-column-only-for-what-every-row-has.md),
[0023](0023-an-organisation-is-an-object.md)). **The country and its regions
hold theirs in the pack** ([0020](0020-a-pack-holds-what-a-function-reads.md)),
dated and cited.

**There is no global level.** No value is chosen by the core for every
country. When no level holds a value, the resolution refuses by name and
says which parameter is missing for which object; null is an answer, never
a number borrowed from elsewhere.

**A method constant is not a default.** The coefficients of a published
model belong to the model's profile in its module (a yield profile, an
allocation key), where the run records them; the cascade holds what varies
by place and by owner.

**A run records what it read.** The value and the level it came from are
inputs of the run ([0004](0004-deterministic-runs.md)), so the same run
replayed later reads the same number even after the pack moved on.

## What it forbids

- A fallback value in the core, in a module or in a client for a parameter a
  country decides.
- A module with its own order of resolution.
- A default stored as a column of an organisation or a project, or as a
  settings `jsonb` without unit, period and source.

## What it replaced

Per-module resolution orders (the weather model of a site, the loss of an
organisation), constants in module code, and the "core default by coverage"
at the end of the weather module's order.

## See also

- Inherits Ekwo OS 0038 (*A deadline is a rule of the country; null is an
  answer*) and 0041 (*A company has a profile*), translated: the profile is
  the organisation's attributes.
- [0009](0009-addresses-and-geocoding.md) — the region of a place.
- [0038](0038-everything-raises-by-name.md) — the refusal is named.
