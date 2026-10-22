# 0034 — A pack upgrade is never silent, and a golden case is its contract

> Status: accepted, implemented

## Context

A pack changes: a new grid operator, a corrected identifier pattern, a new
yearly value. A seed applied once, without an upsert, reaches no
installation that already holds the pack, and the change stays in the
repository instead of the databases that need it. An installation also has
to know which version of a pack it holds, and something has to prove that
a pack and the modules reading it still agree. Ekwo OS answers both with a
manifest compiled into a seed, an upgrade computed by natural key, and a
golden year that replays a pack through the engine.

## Decision

**A pack is written as JSON against a published schema, and compiled.** The
pack build command turns it into a committed seed; the pack check command
refuses a pack that does not match the schema, names an unknown vocabulary
row, or holds a value without its source and its reference
([0020](0020-a-pack-holds-what-a-function-reads.md)).

**The installation knows what it holds.** Each installed pack is recorded
with its version and its checksum; its certification is in its
`pack.json`. `doctor` compares them with the files of the release.

**An upgrade is computed by natural key, and nothing is lost on the way.** An
addition is copied in; a validity that closes is applied; a row the
installation holds and the pack does not is never removed. A row's natural
key (a country and a code, a scheme and a pattern) is what the seed upserts
on, so applying a pack twice changes nothing.

**A value is dated, never edited.** A new figure is a new row with the date it
holds from, and the old one is closed on that date. A computation run again for
its date reads the value it read the first time, and the figure names it
in its inputs ([0004](0004-a-figure-says-where-it-comes-from.md)).

**Adding anything is a version.** A pack that changes without a new version
is a pack nobody can upgrade to.

**A golden case is the contract of a pack.** A pack carries reference
cases, one per kind of project its country knows — an organisation, a
project of a kind, its participants with their segment and municipality,
their meters and devices and a few hours of series, described as data — and
the figures the model must find from them: the defaults resolved with
their level and condition, the perimeter verdict of each participant, the
operator of each meter, the shares of a settlement, a yield, the
indicators, each with its source and its tolerance. One runner, with no
country in it, installs every pack, replays every case and compares. A
golden case proves coherence, not legal truth: what it cannot prove is
carried by the references of the values and by the certification.

**Only a named professional of the trade certifies a pack.** The project
maintains packs; a certification names the person who reviewed one (a grid
specialist, a building regulation specialist) and the version reviewed.

## How it is implemented

- `packs/<cc>/golden/<case>/scenario.json` and `expectations.json`; their
  shape is `packages/cli/src/pack/golden.ts`.
- `nexgen-os pack check` reads the cases without a database: their shape,
  the objects the two files name, the country and the frame of the
  project, a source on every expectation, a tolerance on every figure; a
  pack with no case is refused (`golden_missing`) unless its `pack.json`
  says why (`"golden": {"exempt": "…"}`, the fixture pack of the tests).
- `tests/golden.test.ts` installs every module and every pack, builds each
  case through the gestures a caller uses, and compares what
  `parameter_of()`, `storage.battery_of()`, `community.check_perimeter()`,
  `grid.operator_of()`, `settleSharing()` with the example engine, the
  PVWatts model of `solar` and `kpis.measure()` answer. A new pack adds
  files and no code.
- An expectation may be a refusal by name: a value the pack does not decide
  yet is shown as `parameter_missing`, never filled in to make the case pass.

## What it forbids

- A seed applied once, or a pack value changed in place.
- A pack version that moves while the content differs, or content that
  moves without a version.
- A golden figure adjusted until the test passes: a figure the golden case
  shows to be wrong is reported to the pack's reviewers.
- A test that expects a country: what a test asserts about the core comes
  from the packs.

## See also

- Inherits Ekwo OS 0026 (*Ekwo maintains a pack; only an accountant reviews
  one*), 0028 (*A pack upgrade is never silent*) and 0029 (*A golden year is
  the contract of a pack*).
- [0020](0020-a-pack-holds-what-a-function-reads.md) — what a pack holds.
- [0040](0040-a-release-has-a-tag-a-schema-version-and-a-floor.md) — the
  release a pack ships with.
