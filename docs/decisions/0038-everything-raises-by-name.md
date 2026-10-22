# 0038 — Everything raises, by name

> Status: accepted

## Context

The model is used by people, by the command line, by the Python client, by
connectors that run at night and by agents. A warning printed to a log is
read by none of them; a refusal phrased as a sentence is read differently
by each, translated by one and matched by a regular expression in another.
A refusal is useful when the caller can tell, without reading the code,
what was wrong and what to fix.

## Decision

**A rule is held where the data is.** A constraint, a trigger or a gesture
of the schema enforces it, so that every caller meets it, whatever its
language ([0018](0018-one-function-per-gesture.md)).

**Everything raises; nothing warns.** A write that breaks a rule is refused
whole. A value that would be wrong is not written with a note beside it.

**Every refusal starts with a name**, in snake case and in English, followed
by what is needed to act on it: `time_zone_required`, `crs_required`,
`series_not_found`, `already_imported`, `invalid_identifier`. The name is
the contract; the text after it may become more precise. A name is read in
one place: the database's message, an engine's `error`, the command line's
output.

**The command line answers one document and an exit code.** A command
prints what it did or one named line per problem, and exits 0 or 1; with
`--json`, the same in one document. `doctor` and the installer start every
line of a problem with its name (`postgis_required`, `migrations_pending`,
`database_too_old`).

**An engine and a connector pass names through.** An engine's own refusal
reaches the caller by its name, and the runner adds its own
(`engine_not_found`, `engine_failed`); nothing is reworded on the way.

**A missing value is named, never borrowed.** A default nobody set is a
refusal that names the parameter and the levels it looked at
([0021](0021-one-cascade-of-defaults.md)), never a value taken from another
country or a constant of the code.

## What it forbids

- A warning in place of a refusal, or a write that succeeds with a value
  the rule would have refused.
- A refusal without a name, or a name that changes from one release to the
  next.
- A caller that retries a named refusal blindly instead of fixing what the
  name says.

## See also

- Inherits Ekwo OS 0013 (*Locks live in the database, and everything
  raises*) and 0054 (*The command line answers one document and an exit
  code*).
- [`AGENTS.md`](../../AGENTS.md), "When the database says no".
- [`packages/cli/README.md`](../../packages/cli/README.md), "Refusals".
