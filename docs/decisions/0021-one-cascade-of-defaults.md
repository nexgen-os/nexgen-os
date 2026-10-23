# 0021 — One cascade of defaults, climbing a region to its parent, and no global fallback

> Status: accepted · amended by [0053](0053-a-technology-figure-holds-everywhere-below-every-place.md) and [0054](0054-a-parameter-is-resolved-once-from-the-country-down-to-the-device.md)

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
of its participant's place (its municipality first, when its pack lists
it), then the regions it is part of, nearest first, then its country
([0043](0043-the-participant-is-the-node.md)). The first level that holds a value answers, and the answer says
which level it came from.

**A value of a pack may hold for a condition, and the most specific one
answers at its level.** A frame of projects decides a perimeter, a tax
differs by customer segment, a rule holds around a wind turbine, a
derogation in a rural municipality: a `defaults` row names its condition in
the one shape of a condition ([0044](0044-a-condition-has-one-shape.md)) —
the kind of project, the segment, the device type, the density class, an
attribute — `{}` matching every object. At each level of the pack, of the
rows whose condition the object meets, a kind, a segment or a type matching
its refinements, the one with the most criteria answers, and the answer
names them. A level that answers is the answer, however specific a row
above it: a region's value wins over the country's. Two rows as specific
as each other are a gap of the pack, refused by name
(`parameter_ambiguous`).

**A region climbs to its parent.** `region` is the ISO 3166-2 subdivision a
pack chooses to list (a department in France, a region in Belgium); when
the pack lists two levels, each subdivision names the one it is part of
(`regions.parent_code`). A value decided at the upper level holds in every
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
country. (A module may publish a cited technology figure below every place:
[0053](0053-a-technology-figure-holds-everywhere-below-every-place.md).) When no level holds a value, the resolution refuses by name and
says which parameter is missing for which object; null is an answer, never
a number borrowed from elsewhere.

**A method constant is not a default.** The coefficients of a published
model belong to the model's profile in its module (a yield profile, an
allocation key), where the calculation records them; the cascade holds what varies
by place and by owner.

**A figure records what it read.** The value and the level it came from are
inputs of the estimate or the settlement ([0004](0004-a-figure-says-where-it-comes-from.md)), so it
still says which number it read after the pack moved on.

## What it forbids

- A fallback value in the core, in a module or in a client for a parameter a
  country decides.
- A module with its own order of resolution.
- A value that depends on a kind of project, a segment or a technology
  chosen by a `case` in a function instead of a condition of its row.
- A default stored as a column of an organisation or a project, or as a
  settings `jsonb` without unit, period and source.

## See also

- Inherits Ekwo OS 0038 (*A deadline is a rule of the country; null is an
  answer*) and 0041 (*A company has a profile*), translated: the profile is
  the organisation's attributes.
- [0009](0009-what-applies-follows-the-region.md) — the region of a place.
- [0038](0038-everything-raises-by-name.md) — the refusal is named.
