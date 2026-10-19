# 0036 — A file is imported once, and a reader reports rather than corrects

> Status: accepted · 19/10/2026

## Context

Files arrive more than once: the same IFC model sent twice by an architect,
the same export of a meter's history dropped in a folder again, a CityJSON
tile downloaded on two days. A second import that writes a second building
or doubles a year of readings is worse than none, because nothing on the
page says which rows are the copy. Files are also often wrong: a weather
file with a missing hour, a model without a coordinate reference system, a
history with a gap. A reader that fills the hour, assumes a system or
smooths the gap produces a file that looks right and hides the only
evidence that it was not.

## Decision

**A file is imported once.** An import records the file it came from, by its
checksum, and the source it names. Importing the same file again into the
same organisation is refused by name (`already_imported`); a corrected file
is a new file, and what it replaces is said by the person or the gesture
that imports it.

**A reader reports and never corrects.** What a file says is returned as it
says it; what is wrong with it is returned as a named problem beside the
values: a missing interval, a value out of its range, a total that does not
add up. Whether to import with the problem, or not at all, is the
importer's decision, and a refusal carries the problem's name.

**Nothing is guessed to satisfy a model.** A coordinate reference system, an
encoding, a time zone, a unit or a time convention the file does not state
is asked of the caller, never assumed: a model without its reference system
is refused (`crs_required`), and a series whose time convention is unknown
is not stored.

**Exceptions are for files, problems for lines.** A file that cannot be read
at all (wrong format, broken encoding, over a limit) raises; anything about
one element or one value is reported.

**An export is written from the rows, never recomputed.** A file written
from the model carries the values as stored, with their source; a total in
the file is the sum of the rows written in it.

## What it forbids

- A second import of the same file that writes the same objects or values
  again.
- A reader that fills a gap, rounds a value, swaps a convention or picks a
  default to make a file pass.
- An export that recomputes a figure the model already holds.

## What it replaced

Imports that trusted the caller not to run them twice, and readers whose
behaviour on an incomplete file was left to each library.

## See also

- Inherits Ekwo OS 0047 (*A bank statement is imported once*), 0049 (*A
  statement reader reports and never corrects*) and 0050 (*An invoice file
  is written from the books*).
- [0035](0035-a-format-library-touches-no-database.md) — what a format
  library may touch.
- [0038](0038-everything-raises-by-name.md) — the names of refusals.
