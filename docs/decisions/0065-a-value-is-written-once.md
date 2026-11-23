# 0065 — A value is written once; a total is computed, and a copy kept for an older reader is written by the database alone

> Status: accepted

## Context

The installed power of a place could be written in three spots that
nothing related: the rated power of each device (`devices.rated_power_kw`),
the peak DC power of a PV system in the `solar` module
(`solar.devices.kwp_dc`, and the sum of its arrays), and an attribute
`installed_power` entered by hand on the participant or the project, which
is the one the indicators divided by. A school could say 30 kWp on its
device, 36 on its arrays and 25 on its attribute, and each reader answered
its own. The golden cases of four packs entered the same power twice.

The platform this core was taken from carried the same shape — a power
stored on the participant beside the powers of its devices — and it
drifted: figures of a study disagreed with the equipment described under
them. Two values that say one fact end, sooner or later, saying two.

## Decision

**A value is written once.** A fact has one place: a column of the object
that has it, a row of the module that describes it, an attribute, a
parameter of a pack. Before a column, an attribute or a field of a file is
added, the fact is looked for where it may already be.

**A total is computed, never entered.** What sums, counts or derives from
rows is a function that reads them. The installed power of a participant or
a project is `installed_power()`: the sum of the rated powers of its
electricity-producing devices (the type `generator` and its refinements)
that are not removed at that moment, a planned device included, since a
project under study describes what will be installed.

**A reader has one path.** The one reader of an attribute, `attribute_at()`,
answers the installed power from the devices, so `parameter_of()`
([0055](0055-a-parameter-is-resolved-once-from-the-country-down-to-the-device.md)),
the indicators (`specific_yield`, `performance_ratio`) and the conditions
([0044](0044-a-condition-has-one-shape.md)) read it without a second
implementation. The row it answers is computed and stored nowhere; it says
so in its reference, and its quality is `estimated`, the word of a value
nobody qualified ([0057](0057-one-word-per-thing-in-the-lists-of-the-core.md)).

**What was declared stays readable.** The attribute `installed_power`
entered by hand is still read for a participant or a project whose devices
carry no power — an installation older than this record, a study that knows
a total and no device yet. Where a device carries one, the devices answer.
Nothing is deleted and nothing is refused: an export of an older
installation still imports.

**A copy kept for an older reader is written by the database, and guarded.**
The rated power of a PV system is its peak DC power. The `solar` module
keeps `kwp_dc` on the system and on its arrays, where the packages of
earlier releases read it, and the database alone keeps the three equal: the
system's `kwp_dc` is the sum of its arrays when they carry a power, the
device's `rated_power_kw` is what the module describes
(`solar.devices_power()`), and writing another figure on either is refused
by name, `power_from_arrays` ([0038](0038-everything-raises-by-name.md)).
`solar.system_kwp()` reads the device's rated power last, so a system
installed with its power and nothing more computes.

## What it forbids

- A column, an attribute or a field that repeats a fact another one holds.
- A sum, a count or a rate entered beside the rows it comes from.
- Two free entries of one figure kept "in sync" by the code that writes
  them: when a copy must stay, a trigger writes it and a named refusal
  guards it.
- A golden case, a demonstration or an example that enters one figure twice.

## Consequences

- A participant whose declared attribute differs from its devices now
  answers its devices: an indicator divided by the attribute moves there,
  and its inputs say which it read.
- `modules/solar/supabase/migrations/0006_one_power.sql` aligns the PV
  systems described with two figures on the more detailed one — the arrays,
  then the system — and says how many it moved.
- The module of another generator (wind, hydro) that describes a power of
  its own follows the same pattern: the device's rated power is what it
  describes.

## See also

- [0019](0019-a-column-only-for-what-every-row-has.md) — a column only for what every row has.
- [0028](0028-two-objects-that-are-one-are-merged.md) — two objects that are one are merged.
- [0042](0042-a-module-starts-from-an-object-of-the-core.md) — a module enriches an object of the core.
- [0055](0055-a-parameter-is-resolved-once-from-the-country-down-to-the-device.md) — a parameter is resolved once.
