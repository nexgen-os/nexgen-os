# 0057 — One word per thing in the lists of the core: a value says its quality

> Status: accepted. Supersedes [0048](0048-a-value-says-what-kind-of-value-it-is.md).

## Context

A review of the sixteen reference lists of the core in 0.3.0 kept thirteen
as they are and found the same thing named twice, or one word naming two
things:

- what kind of value a value is was `quality` on a value of a series and
  `status` on an attribute and a default of a pack, and 0048 forbade the
  word `quality` everywhere else;
- `status` also named the lifecycle of a project, a participant, a device,
  a connector and an action, so one word carried two meanings on two
  neighbouring columns;
- the conventional value a study starts from was called `default`, in a
  table called `defaults` whose rows are mostly published values: a row
  could be a default with the status `default`, or not;
- the four words lived in a table, `value_statuses`, with its policy and its
  grants, that nobody extends and whose one extra column was read by a test
  only, and a second time as an enum of the pack schema;
- a simulated series stored its values as measured (code 0), because
  `store()` wrote 0 whenever the writer gave no quality;
- `role_capabilities.role` took any word of a given shape, where the presets
  it resolves are four.

## Decision

**The kind of a value is its `quality`, everywhere.** One word, two
encodings: a two-byte code on a value of a series, the hot table —
0 measured, 1 estimated, 2 substituted, 3 missing, from 100 up a pack's code
of a data hub ([0007](0007-series-at-scale.md)) — and a word of the domain
`nexgen.value_quality` on every other row that keeps a value: `published`
(read in a text that decides it: a law, a regulated tariff, a register, a
datasheet), `measured` (on the object itself; code 0), `estimated`
(computed or estimated from other values; code 1) and `assumed` (a
conventional value a study starts from when nothing better is known).
`attributes.quality`, `defaults.quality` and a module's own rows
(`solar.estimate_losses.quality`) carry the domain; `set_attribute()` takes
`p_quality`, `parameter_of()` returns `quality` with the value, its level,
its source and its reference; a pack writes `quality` on a value
(`defaults.json`).

**Every attribute and every default has a quality.** An attribute nobody
qualified is `estimated` — never claimed measured or published without
saying so; a pack's default is `published` unless its row says otherwise.

**A value of a series has a quality too, and it never claims more than its
series.** `store()` writes the quality the writer gives; when it gives none,
0 in a series that is measured, a setpoint or a command — the value as its
source delivered it — and 1 in a simulated series, which a computation
writes and which measures nothing. A forecast's values carry no quality
(`forecast_values`): a forecast is an estimate by what it is.

**`status` is a lifecycle, and nothing else**: of a project, a participant,
a device, a connector, an action, a mandate. A pack's certification keeps
`status` in its manifest, a document of the toolchain and not a column.

**A closed list nobody extends is a check on its column**, or a domain when
several columns share it; a list is a table only when packs or modules add
rows to it (`device_types`, `quantities`, `sources`, `project_kinds`…). The
presets `role_capabilities` resolves are such a list: `owner`, `editor`,
`viewer`, `participant`, the one place a role becomes capabilities
([0051](0051-roles-resolve-into-capabilities.md)).

## What it forbids

- A second word for the kind of a value (`status`, `confidence`, `origin`)
  on any table, of the core or of a module: the word is `quality`, its
  words those of the domain or the codes of a series.
- `default` as a word of quality: `defaults` is the table of what a country
  decides, a conventional value is `assumed`.
- A simulated value stored as measured because nobody said otherwise.
- `status` for anything but a lifecycle.
- A table for a list of words nobody adds to.
- A quality deduced from a source: a published text may be cited for an
  estimate made from it; the row says which.

## See also

[0004](0004-a-figure-says-where-it-comes-from.md) (a figure says where it
comes from), [0007](0007-series-at-scale.md) (the quality of a series value),
[0021](0021-one-cascade-of-defaults.md) (one cascade of defaults),
[0051](0051-roles-resolve-into-capabilities.md) (roles resolve into
capabilities). The upgrade of an installation of 0.3.0 is written in the
changelog of 0.4.0.
