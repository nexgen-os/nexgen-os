# 0049 — The market follows the place; a support scheme is the country's, its contract the device's

> Status: accepted

## Context

A study of a producer or of a consumer reads the market it is in: the
bidding zone whose day-ahead price it is paid or charged, the control area
and the transmission operator that balance it, the imbalance settlement
period its balance responsible party is settled over, the support scheme
its production is paid under and what that scheme obliges it to do when
prices are negative, the carbon intensity of the grid it takes from. The
reference platforms of the trades hold all of these. Each could have been a
table of its own, keyed by country, with its own resolution from a place.

## Decision

**What a country decides about its market is pack data, resolved from the
place as every value is** ([0009](0009-what-applies-follows-the-region.md),
[0021](0021-one-cascade-of-defaults.md)). The bidding zone, the control
area (ENTSO-E EIC codes) and the imbalance settlement period are defaults
of the country, of a region or of a municipality when a country has
several zones; `grid.market_of(kind, id)` resolves them for a meter, a
participant or a project through `parameter_of()`, each with its source and
status, and adds the transmission operator of the country (`grid.operators`
of kind `tso`, with its EIC code). A zone that is not interconnected
decides none and says so.

**A market series names its zone.** A day-ahead price or a grid carbon
intensity is a series of the organisation (as prices and weather are), with
a `bidding_zone` attribute; a reader takes the series of the object's zone
(`grid.zone_series()`, `"zone": true` in a `kpis` variable). An indicator
that reads an hourly series falls back on the monthly default of the pack
when the organisation holds none, and the figure says which.

**A role of the market is held, not typed.** A balance responsible party,
a balancing service provider, a supplier, an aggregator is a role
(`grid.market_roles`) an organisation or one of its contacts holds over a
period (`grid.market_parties`), with its EIC code.

**A support scheme is the country's; its contract is the device's.** The
kinds (feed-in tariff, contract for difference, green certificates, net
metering) are a vocabulary with the formula each pays; a tender is how a
scheme is awarded, not a kind. The rules of a country — eligibility,
duration, the obligation to stop at negative prices with its power
threshold, dated — are its pack's (`grid.json`, `grid.support_schemes`). The
contract enriches the producing device, whatever its technology — the
device is what is contracted, its type and rated power decide eligibility
and the obligation — so it lives in `grid` (`grid.support_contracts`) and
not in the module of one technology. Its tariff is the contract's: a pack
holds no price that changes within a year.

## What it forbids

- A bidding zone, a control area or a settlement period written in code,
  or a table of zones beside the defaults.
- A price series without the zone it holds for, read for a place by
  guessing.
- A support contract on a `solar` row, a wind row, a storage row: one table,
  on the device.
- A tariff of a scheme in a pack.

## See also

[0020](0020-a-pack-holds-what-a-function-reads.md),
[0044](0044-a-condition-has-one-shape.md),
[0048](0048-a-value-says-what-kind-of-value-it-is.md).
