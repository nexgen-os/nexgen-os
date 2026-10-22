# 0026 — A device is not placed for now; the `building` module describes the place, and a space is one notion with a kind

> Status: accepted · 19/10/2026, rewritten 21/10/2026 twice

## Context

A heat pump sits in a plant room, a meter in a cabinet, a PV array on a roof
face, a thermostat in a flat. The 0.2 core placed a device with three
columns of its own — the building, the space, the surface — beside its
site; 0.3 as first written moved that placement to the `building` module
(`building.devices`, `place_device()`, `move_device()`, `place_array()`).
Neither came from the field. In the platform this core was taken from, a
device belongs to a participant, behind its meter, and nobody places it in
a building: what a page needs of a device is whose it is, what it is and
what it measures ([0045](0045-the-participant-is-the-node.md)). The inside
of a building is still one tree of spaces, each of a kind, each inside
another, in IFC, CityGML, Brick and Home Assistant alike.

## Decision

**A device is not placed for now.** It belongs to its participant
(`devices.participant_id`) and is behind that participant's meters; no
table of the core or of a module says in which building, room or on which
roof face it sits. What a file says about it — the building and the room an
IFC model contains it in, the area of a Home Assistant device, a position —
travels in its `metadata`, as the file said it. What a device measures in
a room is a series of that room, read by the device
([0022](0022-the-instrument-is-a-device-the-point-is-the-series.md),
[0029](0029-a-series-belongs-to-an-object.md)).

**The `building` module describes the place of a participant.** Its ground
(`building.sites`), its buildings, their spaces and surfaces enrich the
participant ([0042](0042-a-module-starts-from-an-object-of-the-core.md));
`building.participant_of()` says whose each is, through their foreign
keys.

**A space is one notion with a kind and a parent.** A floor, a room, a zone
and a unit (a flat, an office lot) are spaces of the module: each belongs
to a building, has a kind and, optionally, the space it sits in. A new kind
of space is a vocabulary row, never a new table. A place is not always
built: a ground-mounted PV plant, a field, a car park is a ground whose
surfaces lie on it, with no building at all.

**A PV array keeps its own azimuth and tilt, and nothing else.** A tilted
frame on a flat roof differs from the roof; the array says its orientation
itself. A participant of a project occupies a floor or a unit of a
building it shares: the space names it (`occupant_id`).

## What it forbids

- A placement of a device — a building, a space, a surface, a point — in a
  table of the core or of a module, before a decision says the platform
  needs it.
- A building, a space or a surface column in a table of the core, or a
  core function that names the `building` module.
- A column of one module naming a table of another (`solar.pv_arrays`
  naming a surface).
- A table per kind of space (floors, rooms, zones).

## What it replaced

The 0.2 core's `devices.building_id`, `space_id` and `surface_id` and its
`move_device()`; in 0.3 as first written, `building.devices`,
`building.place_device()`, `building.move_device()`,
`building.place_array()`, the `placed_in` and `placed_on` links and
`devices.geometry`. Before them, floors and spaces as two tables of the
`architecture` module, and a meter column on the device.

## See also

- [0006](0006-named-objects.md) — the objects of the core.
- [0008](0008-3d-module.md) — the module that describes what is built.
- [0022](0022-the-instrument-is-a-device-the-point-is-the-series.md) — what a
  device measures.
- [0025](0025-a-place-has-one-shape.md) — the shape of a participant's place.
- [0045](0045-the-participant-is-the-node.md) — the participant is the node.
