# 0023 — An organisation is an object

> Status: accepted · 19/10/2026

## Context

Every row of the core carries the organisation that owns it, and row level
security decides by organisation. The organisation itself was the one thing
that could not be described: it was not in the registry of objects, so it
could hold no attribute, no identifier, no link and no document. Its
defaults (a loss it applies to every study, a reference price it negotiated)
had nowhere to go but a column or a settings table of their own, and its
registration numbers and its contracts lived outside the model.

## Decision

**An organisation is an object, like a site or a device.** It is in the
registry of objects, and everything that attaches to an object attaches to
it: attributes with their period and source, external identifiers, links,
documents, tags.

**An organisation's defaults are its attributes.** They take their place in
the cascade between the objects it owns and the region of their place
([0021](0021-one-cascade-of-defaults.md)).

**Above the organisation, the defaults are the country's.** No level of the
model sits above an organisation except its pack's region and country;
there is no installation-wide or vendor-wide level of values.

**Its attachments obey the rights of its members.** Row level security
reads an organisation's attributes, identifiers and documents as it reads
those of any object it owns: its members read them, those who may write
for it write them.

**Legal identity and invoicing stay referenced.** What an organisation is
in law and how it is invoiced is the accounting side's
([0010](0010-ekwo-link.md)); the object holds what describing and studying
places needs.

## What it forbids

- A settings table or a `jsonb` column of organisation preferences.
- A level of defaults above the organisation other than the region and the
  country.
- An organisation's identifier or document kept outside the attachments.

## What it replaced

Organisations outside the registry of objects, with defaults planned as
rows of a separate table by organisation.

## See also

- Inherits Ekwo OS 0041 (*A company has a profile*) and 0043 (*A company
  leaves with its books*): an organisation leaves with its places, devices,
  series and its own attributes.
- [0006](0006-named-objects.md) — the registry of objects.
- [0037](0037-the-schema-grants-its-own-rights.md) — row level security by
  organisation.
