# 0026 — A device is placed on a surface or in a space, and a space is one notion with a kind

> Status: accepted · 19/10/2026

## Context

A heat pump sits in a plant room, a meter in a cabinet, a PV array on a roof
face, a thermostat in a flat. The first core could place a device on a site,
a building, a surface or a meter, but not in a room: floors and spaces lived
in the `architecture` module, out of the core's reach. And the inside of a
building was split by name — floors here, rooms there, zones and units
elsewhere — while IFC, CityGML, Brick and Home Assistant all describe it as
one tree of spaces, each of a kind, each inside another.

## Decision

**A space is one notion with a kind and a parent.** A floor, a room, a zone
and a unit (a flat, an office lot) are spaces of the core: each belongs to
a building, has a kind and, optionally, the space it sits in. A new kind of
space is a vocabulary row, never a new table.

**A device is placed by columns, on the few places a device can be.** A
device always belongs to a site; it may say, more precisely, the building,
the surface (a roof face, a facade, a ground area) or the space it is in or
on. A site is not always built: a ground-mounted PV plant, a field, a car
park or a pond is a site whose surfaces lie on the ground, with no building
at all, and its devices are placed on those surfaces. These places are few and known, so they are columns, checked together:
the building of the surface or of the space is the device's building, and
all of them are on the device's site.

**Anything else is a link.** Which meter a device is behind, which zone a
heat pump serves, which network a charger belongs to are dated, typed links
between two objects, declared by the module that knows them.

## What it forbids

- A table per kind of space (floors, rooms, zones) in the core or in a module.
- A device placed on a building, a surface or a space of another site.
- A column naming any object at all ("mounted on"), whose target the schema
  cannot check.
- A meter or a grid object as a column of the device.

## What it replaced

Floors and spaces as two tables of the `architecture` module, out of the
core; a meter column on the device.

## See also

- [0006](0006-named-objects.md) — the places, the devices and the series of
  the core.
- [0019](0019-a-column-only-for-what-every-row-has.md) — why the places are
  columns.
- [0022](0022-the-instrument-is-a-device-the-point-is-the-series.md) — what a
  device measures.
- [0025](0025-a-place-has-one-shape.md) — the shape of the site.
