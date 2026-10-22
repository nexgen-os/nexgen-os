# 0045 — The participant is the node: it carries the place, the meters and the devices, and every module starts from it

> Status: accepted · 21/10/2026

## Context

Schema 0.3, as first written, put a place between a participant and its
devices: `sites` was an object of the core, a participant was "on a site",
a meter was on a site and carried by a participant, a device was on a site
and behind a meter of it (`devices.site_id`, `devices.meter_id`,
`connect_device()`), and the `building` module said where on the site a
device sat (`building.devices`, `place_device()`, `move_device()`) and on
which roof face a PV array stood (`place_array()`, the `placed_on` link).
Three paths led from a device to its place — its site, its meter's site,
its placement — and two from a device to a meter. None of it came from the
field.

The platform this core was taken from ([0006](0006-named-objects.md))
earned its structure there. In it the participant is the grouping and the
information node of a project: an actor — a household, a company, a
tenant, a PV plant — with its address and its point on the map, that
carries the meter (one, exceptionally several: the grid's, the operator's)
and groups the devices behind the meter: a battery, a charger, a PV
system, a heat pump. Under a device are its series: the energy it takes or
gives, what it measures. Every optional module links to the participant:
the description of its buildings, the grid side of its meters, its bills,
its share of a community, its tasks, its weather. A device is not placed
in 3D.

## Decision

**The participant is the node of a project, and carries the place.** The
place columns `sites` carried move to `participants`, column for column:
street, second line, postal code, city, region, country, geometry in
WGS 84, precision and source of the location, time zone
([0025](0025-a-place-has-one-shape.md)). `join_project()` takes the place
in its one shape, the time zone defaulting from the region, else the
country, from the pack; `locate_participant()` places it again;
`place_of(participant)` gives it back. A participant without a place is a
group of others: it carries no meter and no device
(`participant_group_carries`).

**The core has six objects**: organisation → project → participant →
meter and device → series. A meter is carried by a participant
(`meters.participant_id`); a device belongs to a participant
(`devices.participant_id`) and is behind the meters that participant
carries (`participant_meters()`). There is one path from a device to its
meters and to its place: its participant.

**Every module starts from the participant**, or from an object that
belongs to one ([0042](0042-a-module-starts-from-an-object-of-the-core.md)).
`participant_of(kind, id)` answers whose an object is, for the core's kinds
by their foreign keys, for a module's kind by the module's
`<schema>.participant_of()`. `country_of()`, the time zone of a series and
the cascade of `parameter_of()` read it: device → participant → its group
→ project → organisation → the region, then the country, of the
participant's place ([0021](0021-one-cascade-of-defaults.md)).

**The physical description enriches the participant**, in the `building`
module: its ground (`building.sites`: a parcel, an area, a use), its
buildings (`building.buildings.participant_id`, and the ground they stand
on when it is described), their spaces and surfaces, and the participant
that occupies a floor or a unit of a building it shares
(`building.spaces.occupant_id`). It
says nothing about where a device sits ([0026](0026-a-device-is-not-placed-for-now.md)).
A PV array of the `solar` module keeps its own azimuth and tilt, and
nothing else of where it is.

## What it forbids

- A core object between the participant and its devices or its meters: a
  site, a building, a connection point a device names.
- A device placed outside its participant: a device on another
  participant's meter, a device of a group, a second path from a device to
  a meter or to a place.
- A module that enriches the position of a device — a building, a room, a
  roof face, a point — before the platform needs it. When it does, a
  decision says so, and a module carries it.

## What it replaced

Schema 0.3 as first written (rewritten in place for 0.3.0, 21/10/2026):
`sites` in the core, `participants.site_id`, `meters.site_id`,
`devices.site_id`, `devices.meter_id`, `devices.geometry`,
`connect_device()` and the `behind_meter` link, `create_site()`,
`locate_site()`, `site_of()`; in the `building` module, `building.devices`,
`place_device()`, `move_device()`, `place_array()`, the `placed_in` and
`placed_on` links, and `building.site_of()`. The place of a site is the
participant's; the ground of a site is `building.sites`.

## See also

- [0006](0006-named-objects.md) — the six objects of the core.
- [0022](0022-the-instrument-is-a-device-the-point-is-the-series.md) —
  one device, several series.
- [0025](0025-a-place-has-one-shape.md) — the one shape of a place, on the
  participant.
- [0026](0026-a-device-is-not-placed-for-now.md) — a device is not placed.
- [0042](0042-a-module-starts-from-an-object-of-the-core.md) — how a module
  enriches an object of the core.
- [0044](0044-there-is-no-registry.md) — the hierarchy is the foreign keys.
