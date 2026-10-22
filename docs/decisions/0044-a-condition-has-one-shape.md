# 0044 — A condition has one shape

> Status: accepted

## Context

Two tables of the model say when a row applies. A default of a pack holds
for a kind of project, a customer segment, a technology, the density class
of a municipality ([0021](0021-one-cascade-of-defaults.md)); a template of
the `actions` module applies to a kind of project and to a project whose
attribute passes a threshold. Written two ways — four columns on one side,
a column and a document `{property, op, value}` on the other — the same
criterion was checked by two constraints, matched by two pieces of code,
and spelt two ways in the files a pack or an overlay writes. A third table
that needs "applies when" would have had to pick one, or invent a third.

## Decision

**A condition is one JSON object, the same everywhere.** Its keys are all
optional, and every key given must hold:

```json
{"project_kind": "fr_acc", "segment": "professional", "device_type": "wind",
 "density_class": "rural_town",
 "attribute": {"attribute_type": "installed_power", "op": ">=", "value": 36}}
```

`{}` holds for every object. A kind, a segment or a device type matches its
refinements; the attribute is the object's own, compared with a number.

**One function checks it, one matches it.** `condition_check()` refuses a
condition that is not this shape, by name (`condition_invalid`), naming the
key or the code that is wrong; `defaults` and `actions.templates` both
call it. `condition_facts(kind, id, at)` gathers what an object is — the kind
of its project, the segment of its participant, the type of its device, the
density class of its municipality — and `condition_matches(condition, facts)`
answers true, false, or null when the condition reads an attribute the
object does not have: nothing is decided in the dark. `parameter_of()` and
`actions.plan()` both read through it; the most specific row is the one
with the most criteria (`condition_specificity()`).

**One place per criterion.** The place a row holds in — a country, a
region, a municipality — is the row's level, not a criterion of its
condition: `defaults.country` and `region`, `actions.templates.country`
and `regions`. A template keeps no `project_kind` column: its condition
carries it.

**Packs and overlays write it the same way.** A default of `defaults.json`
carries `"condition": {...}` in that shape (`packs/schema/pack.1.json`,
`$defs/condition`), compiled as it is into the seed.

## What it forbids

- A second column, or a second document, that says when a row applies.
- A matcher in a module: a module reads `condition_matches()`.
- A criterion a reader cannot gather for its object: a template is matched
  against a project, so its condition names a kind and an attribute, never a
  segment or a technology (`condition_invalid`).

## See also

- [0021](0021-one-cascade-of-defaults.md), [0017](0017-an-action-is-something-to-do.md),
  [0018](0018-one-function-per-gesture.md).
