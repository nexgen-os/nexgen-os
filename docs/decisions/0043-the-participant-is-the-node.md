# 0043 — The participant is the node: it carries the place, the meters and the devices, and every module starts from it

> Status: accepted

## Context

A model can put many things between a participant and its devices: a site
the participant is on, a meter on that site, a device on the site and
behind the meter, a placement of the device in a building, an array on a
roof face. Each is one more path from a device to its place and to its
meter, and none comes from the field.

The platform this core was taken from ([0006](0006-the-core-names-six-objects.md))
earned its structure there. In it the participant is the grouping and the
information node of a project: an actor — a household, a company, a
tenant, a PV plant — with its address and its point on the map, that
carries the meter (one, exceptionally several: the grid's, the operator's)
and groups the devices behind the meter: a battery, a charger, a PV
system, a heat pump. Under a device are its series: the energy it takes or
gives, what it measures. Every optional module links to the participant:
the description of its buildings, the grid side of its meters, its bills,
its share of a community, its actions, its weather.

## Decision

**The participant is the node of a project, and carries the place.**
`participants` holds the place in its one shape: the two address lines
(`address_line1`, `address_line2`, as Ekwo OS names them), postal code, city, region, country, geometry in WGS 84, precision and
source of the location, time zone ([0025](0025-a-place-has-one-shape.md)).
`join_project()` takes the place in that shape, the time zone defaulting
from the region, else the country, from the pack; `locate_participant()`
places it again; `place_of(participant)` gives it back. A participant
without a place is a group of others: it carries no meter and no device
(`participant_group_carries`).

**The core has six objects**: organisation → project → participant →
meter and device → series. A meter is carried by a participant
(`meters.participant_id`); a device belongs to a participant
(`devices.participant_id`) and is behind the meters that participant
carries (`participant_meters()`). There is one path from a device to its
meters and to its place: its participant.

**Every module starts from the participant**, or from an object that
belongs to one ([0042](0042-a-module-starts-from-an-object-of-the-core.md)).
`participant_of(kind, id)` answers whose an object of the core is, by its
foreign keys; a module answers for its own objects by its own
(`building.participant_of()`). `country_of()`, the time zone of a series
and the cascade of `parameter_of()` read it: device → participant → its
group → project → organisation → the region, then the country, of the
participant's place ([0021](0021-one-cascade-of-defaults.md)).

**The physical description enriches the participant**, in the `building`
module: its ground (`building.sites`: a parcel, an area, a use), its
buildings (`building.buildings.participant_id`, and the ground they stand
on when it is described), their spaces and surfaces, and the participant
that occupies a floor or a unit of a building it shares
(`building.spaces.occupant_id`). It says nothing about where a device sits
([0026](0026-a-device-belongs-to-its-participant.md)). A PV array of the
`solar` module keeps its own azimuth and tilt, and nothing else of where it
is.

## What it forbids

- A core object between the participant and its devices or its meters: a
  site, a building, a connection point a device names.
- A device placed outside its participant: a device on another
  participant's meter, a device of a group, a second path from a device to
  a meter or to a place.
- A module that enriches the position of a device — a building, a room, a
  roof face, a point — until the platforms built on the core need it. When
  they do, a decision says so, and a module carries it.

## See also

- [0006](0006-the-core-names-six-objects.md) — the six objects of the core.
- [0022](0022-the-instrument-is-a-device-the-point-is-the-series.md) —
  one device, several series.
- [0025](0025-a-place-has-one-shape.md) — the one shape of a place, on the
  participant.
- [0026](0026-a-device-belongs-to-its-participant.md) — a device belongs to
  its participant.
- [0042](0042-a-module-starts-from-an-object-of-the-core.md) — how a module
  enriches an object of the core.
- [0001](0001-the-hierarchy-is-the-foreign-keys.md) — the hierarchy is the
  foreign keys.
