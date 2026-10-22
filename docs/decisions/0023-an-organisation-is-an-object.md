# 0023 — An organisation is an object

> Status: accepted

## Context

Every row of the core carries the organisation that owns it, and row level
security decides by organisation. If the organisation itself could not be
described, it could hold no attribute, no identifier and no document: its
defaults (a loss it applies to every study, a reference price it
negotiated) would have nowhere to go but a column or a settings table of
their own, and its registration numbers and its contracts would live
outside the model.

## Decision

**An organisation is an object, like a participant or a device.** It is a kind,
`organisation`, and everything that attaches to an object attaches to it
as `('organisation', id)`: attributes with their period and source,
external identifiers, documents, series.

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
in law and how it is invoiced is the invoicing side's
([0010](0010-the-participant-is-billed-ekwo-os-keeps-the-invoice.md)); the object holds what describing and studying
places needs.

## What it forbids

- A settings table or a `jsonb` column of organisation preferences.
- A level of defaults above the organisation other than the region and the
  country.
- An organisation's identifier or document kept outside the attachments.

## See also

- Inherits Ekwo OS 0041 (*A company has a profile*) and 0043 (*A company
  leaves with its books*): an organisation leaves with its places, devices,
  series and its own attributes.
- [0006](0006-the-core-names-six-objects.md) — the objects, and what is attached to them.
- [0001](0001-the-hierarchy-is-the-foreign-keys.md) — an attachment names its object's kind.
- [0037](0037-the-schema-grants-its-own-rights.md) — row level security by
  organisation.
