# 0026 — A device is placed by the `building` module, on a surface or in a space, and a space is one notion with a kind

> Status: accepted · 19/10/2026, rewritten 21/10/2026

## Context

A heat pump sits in a plant room, a meter in a cabinet, a PV array on a roof
face, a thermostat in a flat. The 0.2 core placed a device with three
columns of its own — the building, the space, the surface — beside its
site. It made the core the owner of the description of a building: every
installation carried buildings, floors and roof faces, whether it described
any or not, and a device table whose columns named them. The core walks
organisation → project → participant → site → meter → device → series;
where a device sits inside a building is a fact of the physical
description, the territory of BIM and CityGML
([0008](0008-building-module.md)). And the inside of a building is one tree of
spaces, each of a kind, each inside another, in IFC, CityGML, Brick and
Home Assistant alike.

## Decision

**The core knows the site of a device and the meter it is behind; the
`building` module knows where on the site it is.** A device always belongs to a
site and may be behind a meter of it (`devices.site_id`,
`devices.meter_id`). Its placement — the building it is in, the space it
is in, the surface it is mounted on — is one row of `building.devices`,
with the device's id ([0042](0042-a-module-starts-from-an-object-of-the-core.md)),
written by `building.place_device()`. The places are few and known, so they
are columns of that row, checked together: the building of the surface or
of the space is the placement's building, and all of them are on the
device's site. `building.move_device()` keeps the place a device leaves as a
dated `placed_in` link.

**A placed device keeps its parents.** The module declares its `devices` table
as giving a device parents (`declare_parents()`), read before the device's
own columns: `site_of()`, `building.building_of()` and the cascade of
`parameter_of()` go through its surface, its space, its building, then its
site, and the core names no module.

**A space is one notion with a kind and a parent.** A floor, a room, a zone
and a unit (a flat, an office lot) are spaces of the module: each belongs
to a building, has a kind and, optionally, the space it sits in. A new kind
of space is a vocabulary row, never a new table. A site is not always
built: a ground-mounted PV plant, a field, a car park is a site whose
surfaces lie on the ground, with no building at all.

**An object of another module is placed by a link.** A PV array of the
`solar` module keeps its own azimuth and tilt (a tilted frame on a flat
roof differs from the roof); the surface it sits on is a dated `placed_on`
link written by `building.place_array()`, which fills the array's
orientation from the face only when the array has none. A participant of a
project occupies a building, a floor or a unit through an `occupies` link.

## What it forbids

- A building, a space or a surface column in a table of the core, or a
  core function that names the `building` module.
- A column of one module naming a table of another (`solar.pv_arrays`
  naming a surface).
- A table per kind of space (floors, rooms, zones).
- A device placed on a building, a surface or a space of another site.

## What it replaced

The 0.2 core's `devices.building_id`, `space_id` and `surface_id` and its
`move_device()`; before them, floors and spaces as two tables of the
`architecture` module, and a meter column on the device.

## See also

- [0006](0006-named-objects.md) — the objects of the core.
- [0008](0008-building-module.md) — the module that describes what is built.
- [0019](0019-a-column-only-for-what-every-row-has.md) — why the places are
  columns of the placement.
- [0022](0022-the-instrument-is-a-device-the-point-is-the-series.md) — what a
  device measures.
- [0025](0025-a-place-has-one-shape.md) — the shape of the site.
