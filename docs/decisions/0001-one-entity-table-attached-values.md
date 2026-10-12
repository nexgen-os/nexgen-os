# 0001 — One entity table, with everything else attached to it

**Decided 12/10/2026. Withdrawn the same evening by [0006](0006-named-objects.md):**
the generic entity was too abstract to work with; the core now names its
objects. What survives of this decision is the attachment pattern (attributes,
identifiers, links, series, documents attach to any object through one
registry) and the vocabularies as data.

A building, a storey, a roof face, a PV array, a sensor and an organisation are
all rows of `entities`. What each one is comes from a vocabulary (`classes`).
What is known about it is attached: values, series, tags, identifiers,
representations, relationships.

**Why.** The foundation has to describe architecture, 3D, BIM, IoT and energy
alike, and new kinds of things arrive every month: green roofs, façade panels,
drone masts, district heating substations. A table per kind turns each of them
into a migration of the core. Brick, Haystack, IFC and NGSI-LD all reach the
same shape: an entity with a class, properties and relationships.

**What stays typed.** The fields every physical thing needs and every query
filters on are columns: `class`, `parent_id`, `geometry`, `elevation_m`,
`height_m`, `azimuth_deg`, `tilt_deg`, `status`, `scenario_id`. Everything else
is a value attached with its period and its source. 3DCityDB's experience
shows that an entirely generic attribute store makes ordinary queries hard;
the typed columns keep those queries simple.
