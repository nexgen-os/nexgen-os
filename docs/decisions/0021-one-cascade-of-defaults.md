# 0021 — One cascade of defaults, climbing a region to its parent, and no global fallback

> Status: accepted

## Context

A yield, a sizing or a settlement starts from values nobody has measured
yet: a system loss, a degradation rate, a share of self-consumption, a
reference price. Left to each module, one reads a column of the
organisation, another a constant in its code, a third its own order of
project, connector, pack and core. Two modules ask the same question and get
two answers, and a figure computed for one country silently uses a number
chosen for another when the pack has none.

## Decision

**A default is a value of a level, and one function resolves it, in one
order**: the object itself, then its parents (a device's participant, a
participant's group and project), then its organisation, then the region
of its participant's place, then the regions it is part of, nearest first,
then its country
([0043](0043-the-participant-is-the-node.md)). The first level that holds a value answers, and the answer says
which level it came from.

**A region climbs to its parent.** `region` is the ISO 3166-2 subdivision a
pack chooses to list (a department in France, a region in Belgium); when
the pack lists two levels, each subdivision names the one it is part of
(`regions.parent`). A value decided at the upper level holds in every
subdivision under it without a copy, and a value of the lower level wins
over it. The answer names the region that decided. A pack with one level
lists regions without a parent, and its cascade goes from the region to the
country.

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
inputs of the run ([0004](0004-a-figure-is-a-run.md)), so the same run
replayed later reads the same number even after the pack moved on.

## What it forbids

- A fallback value in the core, in a module or in a client for a parameter a
  country decides.
- A module with its own order of resolution.
- A default stored as a column of an organisation or a project, or as a
  settings `jsonb` without unit, period and source.

## See also

- Inherits Ekwo OS 0038 (*A deadline is a rule of the country; null is an
  answer*) and 0041 (*A company has a profile*), translated: the profile is
  the organisation's attributes.
- [0009](0009-what-applies-follows-the-region.md) — the region of a place.
- [0038](0038-everything-raises-by-name.md) — the refusal is named.
