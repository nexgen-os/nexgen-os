# 0027 — A product is a catalogue entry, and a device is an instance of it

> Status: accepted

## Context

A PV module model, an inverter model, a heat pump model are described once
by their manufacturer and installed thousands of times. Repeating their
power, their dimensions and their datasheet on every installed device is
how one roof ends up with a 400 W module and the next with 0.4 kW of the
same model. IFC solves it with types and occurrences; Ekwo OS with a
catalogue of products that a document line refers to without being bound
by it.

## Decision

**A product is a catalogue entry of the core**: a manufacturer, a model, a
device type, its unit power or capacity, its surface, its datasheet. An
entry is shared by every organisation, or an organisation's own.

**A device is an instance of a product.** It names the product it is and
takes its values from it; what is specific to the installed device — its
count, its orientation, its commissioning — is the device's own.

**The catalogue pre-fills a device and never constrains it.** A device
without a product is valid; a device may differ from its product where the
installation does, and its own value wins.

**The physics of a product is a module's.** A module that needs the
parameters of a model — the electrical model of a PV module, the curve of
an inverter, the cycles of a battery — derives the catalogue entry into a
table of its own with the same id, as it derives a device.

**Prices are data with a source.** A price on a catalogue entry says where
it comes from and when; a curated price list that may not be passed on
stays where its licence allows.

## What it forbids

- Copying a product's values onto every device as the device's own.
- Refusing a device because it has no product, or because it differs from
  one.
- Physical parameters of one trade as columns of the catalogue.

## See also

- Inherits Ekwo OS 0044 (*A product is a catalogue entry in the core, not
  stock*).
- [0032](0032-a-module-has-its-own-schema.md) — a module derives the
  catalogue.
- [0012](0012-a-yield-says-what-it-was-computed-from.md) — the physics of PV modules and inverters.
