# 0048 — A value says what kind of value it is

> Status: accepted

## Context

A series value carries a two-byte quality — 0 measured, 1 estimated,
2 substituted, 3 missing ([0007](0007-series-at-scale.md)) — and a place
says how precisely it was located (`location_precision`). An attribute and
a default of a pack said where they came from (a source, a reference) but
not what kind of value they were. A costing that reads a regulated tariff,
a statistic applied to a place and a guess of the owner through one
`parameter_of()` could not tell them apart, and a page could not say which
line of a study is published and which is estimated.

## Decision

**One vocabulary, `value_statuses`, for every value kept outside a
series**: `published` (read in a text that decides it: a law, a regulated
tariff, a register, a datasheet), `measured` (measured on the object
itself), `estimated` (computed or estimated from other values) and
`default` (a conventional value a study starts from when nothing better is
known). The words that mean what a series quality code means carry that
code: `measured` is quality 0, `estimated` is quality 1; a series'
substituted and missing values have no attribute counterpart, and
published and default have no series counterpart.

**Every attribute and every default has a status.** An attribute nobody
qualified is `estimated` — never claimed measured or published without
saying so; a pack's default is `published` unless its row says otherwise
(`status` in `defaults.json`). `set_attribute()` takes the status;
`parameter_of()` returns it with the value, its level, its source and its
reference. A module that keeps a value of its own as a row says its status
in the same words: the loss chain of a yield (`solar.estimate_losses`).

## What it forbids

- A second vocabulary of the kind of a value (`quality`, `confidence`,
  `origin`) on another table: the words are these four.
- Reading a series quality code as anything else than its own words: code 0
  is measured, 1 estimated, wherever a value says it.
- A status deduced from a source: a published text may be cited for an
  estimate made from it; the row says which.

## See also

[0004](0004-a-figure-says-where-it-comes-from.md) (a figure says where it
comes from), [0021](0021-one-cascade-of-defaults.md) (one cascade of
defaults), [0007](0007-series-at-scale.md) (the quality of a series value).
