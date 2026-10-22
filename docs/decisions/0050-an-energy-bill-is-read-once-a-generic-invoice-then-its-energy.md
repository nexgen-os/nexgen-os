# 0050 — An energy bill is read once: a generic invoice, then its energy

> Status: accepted

## Context

An energy bill says more about a place than any other document its owner
holds: the connection point and its identifier, the energy taken over a
period, band by band, what a kWh costs and how the contract prices it, what
the network and the taxes add, the subscribed power. A product that reads
bills could read each one twice — once as an invoice for its books, once
as energy for its studies — with two prompts, two schemas and two sets of
figures that do not agree. And a reader of energy bills written for the
bills of one country would carry its band names, its taxes and its currency
in code.

## Decision

**A bill is read once, as an invoice, by one generic reader.** The reader
returns the EN 16931 shape `ReceivedInvoice` of `@ekwo-ai/factur-x` (MIT):
parties with their VAT and legal identifiers, lines with their quantity,
UN/ECE unit code, net price, VAT category and rate and their period, the
invoicing period, the totals. A Factur-X or UBL file is read by that
library; a PDF by a model asked for that one schema. Nexgen OS never reads
the PDF again.

**The energy is a layer on that result, `@nexgen-os/energy-bill`.** The
reader adds, in one declared shape, what EN 16931 has no word for: the meter
and its scheme, which line bills which time-of-use band and season, network
delivery, taxes per kWh, contributions on a fixed base, the subscription,
what the bill states as information, the contract type with the words
printed for it, the subscribed power. The library brings both to one
reading — periods from the consumption lines, kWh counted once, prices by
band and season (billed and latest), the revision and the projection,
network included or billed, totals checked — and says in named remarks
what does not add up, correcting nothing it cannot prove.

**Nothing of a country is in it.** Bands and seasons are codes a pack
gives; units are the invoice's (MWh is read as kWh); amounts stay in the
invoice's currency and a bill in another currency than its participant's
country is refused, not converted.

**Each fact is written once, by the module that owns it, with the bill as
its source** ([0004](0004-a-figure-says-where-it-comes-from.md),
[0036](0036-a-file-is-imported-once.md)): the bill a document of the
participant with its checksum; the meter found by its identifier or
declared; the contract the participant's published attributes; the energy
an estimate of `consumption`; the invoice a purchase of `billing`,
by its id in Ekwo OS ([0010](0010-the-participant-is-billed-ekwo-os-keeps-the-invoice.md)).
kWh stay kWh ([0030](0030-a-value-is-stored-in-the-unit-of-its-quantity.md)).

## What it forbids

- A second read of the same bill for its energy, or a prompt that returns
  an energy schema of its own beside the invoice.
- A band name, a tax name, a currency or a rule of how a country splits
  network and energy in the library or a module.
- A price the bill does not print, or a figure derived to make totals agree.
- A meter declared twice for one identifier, a bill attached twice.

## See also

[0035](0035-a-format-library-touches-no-database.md),
[0048](0048-a-value-says-what-kind-of-value-it-is.md).
