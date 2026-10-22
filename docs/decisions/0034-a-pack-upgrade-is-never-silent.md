# 0034 — A pack upgrade is never silent, and a golden case is its contract

> Status: accepted

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
holds from, and the old one is closed on that date. A calculation replayed at its
date reads the value it read the first time
([0004](0004-a-figure-names-its-inputs-and-never-changes.md)).

**Adding anything is a version.** A pack that changes without a new version
is a pack nobody can upgrade to.

**A golden case is the contract of a pack.** A pack carries a reference
case — a participant and what it carries, described as data — and the
figures its calculations give; one runner, with no country in it, installs each
pack, replays its case and compares. A golden case proves coherence, not
legal truth: what it cannot prove is carried by the references of the
values and by the certification.

**Only a named professional of the trade certifies a pack.** The project
maintains packs; a certification names the person who reviewed one (a grid
specialist, a building regulation specialist) and the version reviewed.

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
