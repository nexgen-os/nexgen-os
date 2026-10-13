# What Nexgen OS is, and what it is not

Nexgen OS is open source data infrastructure: a database schema, rules
written as data, format libraries, connectors and modules, for the people
who describe, equip and operate places. It is software. It is not an
engineering office, not a surveyor, not an installer, not an energy
supplier, not a grid operator and not a financial adviser, and installing
it, using it or reading this repository does not make WeSmart, or anyone who
contributed to it, your engineer or your adviser.

*Version 1.0 — 13 October 2026. This page applies to Nexgen OS, the software
of this repository. The hosted edition is governed by its own terms.*

## What a figure here is

- **A yield, a loss, a saving, a payback is an estimate**: the result of a
  run that says which weather, which period, which models, which losses and
  which prices it was computed with. Change an input and the figure changes.
  A run is reproducible; it is not a guarantee of production.
- **A P50 or a P90 is a probability over years of weather**, from the data
  and the method the run names. It is an input to a bankability study, not
  the study.
- **A geometry, a footprint, a height, a roof face is as precise as its
  source says**: a cadastre, a city model, a survey, a geocoder — each
  carries its precision and its licence. A point placed by a geocoder is not
  a boundary.
- **A rule in a country pack is a reading of a text at a date**, written so
  that anyone can check it against the source it names. The text prevails.
- **A settlement computed here is a computation**; the invoice, the tax and
  the accounting entry are issued by the tool you use for that.

## What you keep

The data is in a database you control. Nothing in this repository sends it
anywhere, and nothing in this repository calls a service you did not
configure. Row level security is part of the schema; keeping the keys safe
is yours.

## Licences

The core and the modules are AGPL-3.0: use them, change them, run them for
others, and publish what you change. The format libraries and the connectors
are MIT. The data you read through a connector keeps the licence of its
source, which the `sources` table names, with its attribution and the time
you may keep it.
