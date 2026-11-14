# 0059 — Access is evaluated once per query, as a set the reader may reach

> Status: proposed · the rules of the core are unchanged until it is accepted

## Context

Every rule of the core asks one question per row:
`row_has_capability(organisation_id, project, participant, capability)`
([0051](0051-roles-resolve-into-capabilities.md)), where the project and the
participant of a row that hangs on an object are found by
`project_of(object_kind, object_id)` and `participant_of(object_kind,
object_id)`. Each is a PL/pgSQL function, `security definer`, that Postgres
cannot fold into the query: a read pays it on every row of the table before
it keeps the rows of the reader.

`tests/access-cost.test.ts` counts those calls in the transaction of one
read by the account of a participant
([0052](0052-the-end-customer-is-a-participant.md)), who sees one
participant, one meter, one device, two series and one attribute, on an
instance where every participant carries the same (in memory, PGlite; a
server is faster, the proportions are the same):

| participants of the instance | read | calls of the rule | ms |
|---:|---|---:|---:|
| 1 000 | series | 20 000 | 217 |
| 10 000 | participants | 20 000 | 329 |
| 10 000 | meters | 80 000 | 986 |
| 10 000 | devices | 80 000 | 989 |
| 10 000 | attributes | 150 000 | 1 559 |
| 10 000 | series | 200 000 | 2 254 |

The cost follows the instance, not the reader: two calls per participant,
eight per meter or device, ten per series, fifteen per attribute. Three
causes add up:

1. **One evaluation per row.** The answer depends on the reader and on the
   row's organisation, project and participant; the rows of one project
   all get the same answer, asked again for each.
2. **The write rule guards reads too.** `secure_table()` creates a
   `_select` rule and a `_write` rule `for all`; Postgres joins the
   permissive rules of a command with `or`, so a row the reader does not
   see is checked twice. Of the 110 rules of the core and the shipped
   modules that call a function per row, 52 are `for all`.
3. **The object is resolved per row.** Seventeen tables (the series, their
   values and rollups, the attributes, identifiers, documents, meters and
   devices of the core, and eight tables of modules) find their project and
   participant through `project_of()` and `participant_of()`, sometimes
   where the row already carries the column (`meters.project_id`).

The first real installation, with 3 299 participants and 14 634 series, met
the floor of it: about half a second for each read of a customer's home
screen, and a read that started from the series past the eight seconds of
the `authenticated` role. The application worked around it by starting from
the participant; every application on the core would have to.

## Decision

**A rule asks whether a row belongs to the set the reader may reach,
computed once per query.**

- **The set.** `accessible_organisations(capability)`,
  `accessible_projects(capability)` and
  `accessible_participants(capability)` return the identifiers the
  signed-in user (or the key presented in the transaction) reaches with a
  capability: the organisations where a membership grants it, the projects
  shared with a role that grants it, the participants whose account is the
  user's and the members of the groups it is the account of. They are
  `stable`, `security definer`, and resolve exactly what
  `row_has_capability()` resolves today, key narrowing included.
- **The rule.** A rule reads `organisation_id = any (select
  accessible_organisations('data.read')) or project_id = any (select
  accessible_projects('data.read')) or participant_id = any (select
  accessible_participants('data.read'))`. Each `(select …)` is an InitPlan:
  Postgres evaluates it once per query and matches rows by index.
- **The object, once.** A table whose rows hang on an object carries the
  columns its rule needs (`project_id`, `participant_id`), written by the
  trigger that already checks the object, so that no rule resolves an object
  per row. Where a row has no project or no participant, the column is
  null.
- **Reads and writes apart.** A table gets one rule per command: `select`,
  `insert`, `update`, `delete`. No rule `for all`: a read never pays the
  question of a write.
- **The same rights.** `tests/access-baseline.test.ts` lists, for every way
  a person reaches a row, the rows of the core they read and write. A rule
  rewritten under this decision keeps it green without changing it, and the
  expected failure of `tests/access-cost.test.ts` becomes a plain test: the
  calls of a read do not grow with the instance.
- **No new object, no new word.** The organisation, the project, the
  participant and the capabilities stay those of
  [0051](0051-roles-resolve-into-capabilities.md); `row_has_capability()`
  and `has_capability()` stay, for a gesture that asks about one object.
  The change does not break a client: `schemaMin` does not move.

## What it forbids

- A rule that calls a function per row of its table.
- A rule `for all`.
- A rule that resolves the object of a row (`project_of()`,
  `participant_of()`) instead of reading a column of the row.
- A workaround in an application for the cost of a rule: the cost is the
  core's to fix.

## See also

- [0051](0051-roles-resolve-into-capabilities.md) — the capabilities a rule asks for.
- [0052](0052-the-end-customer-is-a-participant.md) — the account of a participant, the reader measured here.
- [0037](0037-the-schema-grants-its-own-rights.md) — the schema grants its own rights.
- [0007](0007-series-at-scale.md) — series at scale.
