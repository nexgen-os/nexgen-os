# 0053 — A technology figure holds everywhere, below every place

> Status: accepted · amends [0021](0021-one-cascade-of-defaults.md)

## Context

[0021](0021-one-cascade-of-defaults.md) gave `parameter_of()` no global
level: no value chosen by the core for every country. The C-rate and the
round-trip efficiency of a representative residential battery were then
published by each country pack, the same two figures from the same
laboratory under two source codes, and a country without a pack had none:
a battery sizing there was refused although nothing about the figure
depends on the country.

## Decision

**A module may publish a technology figure for every country**, at a
generic level of `parameter_of()` below every place: a `defaults` row with
no country and no region, its cited source and its reference, published by
the module that reads it (`published_by`). Any level above wins: the
device, its parents, its organisation, a municipality, a region, a country.
The answer says `level: generic` and which module published it.

The `battery` module publishes `battery_c_rate` 0.4 and
`round_trip_efficiency` 0.85, read on the page *Residential Battery
Storage* of the Annual Technology Baseline 2025 (National Laboratory of the
Rockies, formerly NREL): a representative 5 kW / 12.5 kWh system, and the
85 % the 2025 ATB adopts. The `fr` and `be` packs no longer carry them.

## What stays forbidden

What a country decides — a tariff, a tax, a perimeter, a reference price —
is never generic: the core publishes no generic row, and a figure that
varies by place is a pack's. A generic row is a technology figure, cited.
