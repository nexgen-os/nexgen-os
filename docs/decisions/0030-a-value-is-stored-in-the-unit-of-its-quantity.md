# 0030 — A value is stored in the unit of its quantity

> Status: accepted

## Context

A meter answers in Wh, a hub in kWh, an inverter in W, a weather service in
W/m² or J/cm², a gas meter in m³. When each format library carries its own
list of conversion factors, the same factor is written three times. A store that keeps each value in its original unit makes every
sum a conversion and every comparison a risk; a store that converts in each
client converts differently in each one.

## Decision

**Every quantity has one unit, and every value of that quantity is stored
in it.** The unit is data of the quantity, mapped to its QUDT term; summing
two series of the same quantity never needs a conversion.

**Conversion is data of the core.** A vocabulary of units says, for each
unit, the quantity kind it measures, its factor and its offset to the unit
of reference, and one function of the core converts. The one write path of
series takes the unit the value came in and converts on the way in
([0031](0031-one-way-to-write-a-series-one-way-to-read-it.md)); a format
library or a connector reads the same vocabulary instead of keeping a
factor of its own.

**A unit the vocabulary does not know is refused by name**, never guessed
from its spelling.

**A price is a quantity kept in a currency.** `energy_price` (per MWh),
`power_price` (per kW and per year) and `fixed_price` (per month) have one
unit each, written in `XXX`, the ISO 4217 code for "no currency", as the
pattern every currency is copied from: each currency a country declares
gets its own units (`EUR-PER-MegaW-HR`, `EUR/MWh`), so that no function
names a currency. A value is stored in its currency's copy of the unit: an
attribute or a default of a place in the currency of its country, a series
in the currency it keeps (its object's country's, or for an organisation's
market price the one of the unit of its first write). Two currencies never
convert: an exchange rate is a series, not a factor.

**Direction is a quantity, not a sign.** Energy taken from the grid and
energy given to it are two quantities, both positive; a total is derived,
never a signed sum keyed by hand.

## What it forbids

- A series stored in a unit other than its quantity's.
- A list of conversion factors in a format library, a connector or a
  client.
- A negative value standing for a direction.
- A currency written in a function, or a price summed across currencies.

## See also

- Inherits Ekwo OS 0010 (*Amounts are positive; totals are derived*) and
  0011 (*An amount is rounded at the decimals of its currency*).
- [0002](0002-standards-as-vocabulary-mappings.md) — units mapped to QUDT.
- [0035](0035-a-format-library-touches-no-database.md) — libraries read the
  vocabulary.
