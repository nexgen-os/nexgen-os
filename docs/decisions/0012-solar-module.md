# 0012 — The `solar` module: a yield that says what it was computed from

**Proposed 13/10/2026.** Research: [docs/research/solar-tools.md](../research/solar-tools.md)
(PVsyst, PV\*SOL, SAM, pvlib, HelioScope, OpenSolar, Solargis, Meteonorm,
PVGIS, Open-Meteo, IEC 61724 / 61853 / 62446, PAN/OND, EPW/TMY, Orange
Button, read on 13/10/2026).

## Context

The product this core comes from computes a PV yield in one edge function:
hourly plane-of-array irradiance from ERA5 through Open-Meteo, a Faiman cell
temperature, a PVWatts-like conversion with one system loss and one
temperature coefficient per organisation, a typical year chosen month by
month, an annual total anchored on PVGIS. It is honest and fast, and a
six-week comparison with a partner's PV\*SOL studies showed where it
diverges: the clock of the series (two hours in winter, fixed on 13/10),
the five-year hourly mean that smooths the weather (fixed the same day),
the single loss figure where PV\*SOL and PVsyst carry eight, the weather
source itself (Meteonorm against ERA5 and SARAH: 2 to 3 % on the annual),
the sub-hourly step of the load, and conventions nobody wrote down:
azimuth zero at south in one tool and at north in another, values dated
at the end of the hour here and at the start there, winter time all year in
PV\*SOL.

The lesson of the comparison is the lesson of the research: **the gaps
between tools are gaps of inputs and conventions first, of physics second**.
A yield is comparable when it says which weather, which period, which time
convention, which models and which losses it was computed with. That is
what the module has to carry, as data, so that a run can be reproduced,
compared with a PV\*SOL or PVsyst study, and improved without a second
engine.

## Decision

### One module, `solar`, for what is specific to photovoltaics

The `solar` module replaces the planned catch-all `energy` module, which is
dissolved into modules named after what they add: `solar`, `storage`,
`charging`, `consumption`, `sharing`, `weather`, and later `flexibility`
and `generators`. Each reads the series the others produce. The seed moves
the device types `solar` and `inverter` to the `solar` module, `battery` to
`storage`, `charger` to `charging`, and wind, hydro, cogeneration and
biomass to `generators`.

| Table | What it is |
|---|---|
| `solar.pv_systems` | the PV system as a device (`derive_devices`): DC power, AC power, grid connection, commissioning date, degradation and first-year loss |
| `solar.pv_arrays` | one group of modules with one orientation: the surface it sits on (azimuth and tilt copied from `surfaces`, overridable for racks and trackers), mounting (`open_rack`, `roof_parallel`, `semi_integrated`, `insulated`, `floating`, `tracker`), module product and count, string layout, inverter product and count, albedo, bifacial. The level every tool exchanges — pvlib's Array, PVsyst's orientation, OpenSolar's module groups, Orange Button's PVArray — between the roof face and the system |
| `solar.module_products`, `solar.inverter_products` | the physics of a product of the core `device_directory`, same id: the model family (`pvsyst`, `cec`, `sapm`, `pvwatts` for modules; `sandia`, `adr`, `pvwatts`, `ond` for inverters) and its parameters as one JSON in pvlib's key names, so that pvlib, SAM and a PAN/OND reader agree on what each key means |
| `solar.horizons` | one far-horizon profile per site or surface, as (azimuth, elevation) pairs, with its source (PVGIS DEM, survey, PVsyst, Meteonorm) |
| `solar.yield_profiles` | a named set of modelling choices: decomposition, transposition, incidence, temperature (model and parameters), spectral, an **ordered list of losses** (soiling, mismatch, DC wiring, module quality, LID, AC wiring, availability, auxiliaries), DC/AC clipping. Shipped: `pvgis_like`, `pvwatts`, `pvsyst_like`, `pvsol_like`, each documented with what the tool it imitates assumes |

Weather is not the module's: it is core `series` on the site (or on a
grid point a module declares), `measured`, `simulated` (a typical year is
simulated, never a real year) or `forecast`, with their `source_code`
(`pvgis_sarah3`, `pvgis_era5`, `open_meteo_era5`, `meteonorm`, `solargis`,
a station). The module publishes the quantities it needs — `ghi`, `dni`,
`dhi`, `poa_irradiance`, `module_temperature` — and reads them through the
connectors of decision 0011. Choosing or downloading a weather model is
therefore choosing a source and a connector, open by default (PVGIS,
Open-Meteo under its terms), licensed in Nexgen, WeSmart's commercial platform (Meteonorm,
Solargis), the installation's own station or model tomorrow.

### Conventions, written once

- azimuth: degrees clockwise from true north, everywhere in the database;
  every reader and connector converts (PVGIS and Open-Meteo count from
  south, PVsyst too, pvlib and SAM from north);
- time: every series value is dated at the **start** of its interval, in
  UTC, and read in the site's time zone; every source declares its own
  convention (PVGIS SARAH instantaneous, Open-Meteo preceding-hour mean,
  EPW hour-ending, PVsyst interval start in winter time) and the connector
  converts;
- a typical year is `simulated`; a run on real years says which years;
- losses are a list with an order, never one percentage; the single
  `systemLoss` of today is the `pvwatts` profile with one entry.

### A run says everything

A yield run (`record_run`, decision 0004) takes a PV system, a yield
profile, the weather series and their period, the horizon, the engine and
its version (pvlib, PVGIS PVcalc, SAM), and writes `simulated` series on
the system — energy per hour, plane-of-array irradiance, cell temperature
— and a summary: annual yield, specific yield, performance ratio, P50 and
P90 with the variability components. Measured production stays `measured`
on the meter or the inverter; IEC 61724-1 performance indicators (reference
and final yield, performance ratio, energy performance index) compare the
two. Engines run outside Postgres (a worker, an API); the database holds
parameters, series, runs and their lineage.

### Formats (ST2) and products

Read: PVGIS and Open-Meteo (connectors), EPW and TMY3 weather files,
PVsyst and PV\*SOL hourly CSV results as `simulated` runs, PAN and OND
product files (read, kept as documents, never written), the CEC module and
inverter tables, SunSpec models for live inverter data. Write: the weather
series a run used as EPW or PVsyst CSV, so that a PVsyst or PV\*SOL user
reruns the same weather; a run as SAM JSON; hourly results with pvlib
names. Never: PVsyst `.PRJ` or PV\*SOL project files.

Products follow three layers. The core `device_directory` is the identity
of a product (manufacturer, model, type, unit power or capacity, surface,
datasheet, price), shared or an organisation's. The modules derive the
technical parameters — `solar.module_products` and `solar.inverter_products`
here, batteries in `storage`, protocols and registers in `monitoring`. The
data come from open readers (CEC tables, PAN/OND) for the physics, and
from a curated dataset of Nexgen, WeSmart's commercial platform, for prices, installed costs
and supplier references (`sources` row, not redistributable). The line
between open and paid runs on prices, never on physics.

### What stays with the tools

3D near shading, string and cable design, bankable reports: PVsyst,
PV\*SOL and HelioScope keep them. Their outputs land here as runs and
documents, compared on the same series.

## Consequences

- `modules/README.md` lists `solar`, `storage`, `charging`, `consumption`,
  `sharing`; the catch-all `energy` is gone.
- The product's engine becomes the `pvwatts` yield profile on the
  `open_meteo_era5` and `pvgis_sarah3` sources, with its clock and typical
  year rules written as conventions; the Sunelis comparison becomes a test:
  a PV\*SOL study imported as a run, its weather exported as EPW, the
  `pvsol_like` profile within a stated tolerance.
- ST2 gains the weather and product formats above; the first `solar`
  acceptance test is a PVGIS TMY and an Open-Meteo year on the same roof,
  run through the same profile, with the gap explained by the inputs.
- Weather is a module of its own, `weather`, shared with `heating` and
  `thermal` (decided 13/10/2026, see below). Open: which of the four
  profiles ships first (`pvgis_like` is the cheapest to verify).

## Weather: a module of its own, chosen per place (decided 13/10/2026)

Weather belongs to a place, not to a device: two PV systems on one site
share it, a heat pump on the same site reads the same temperature, and a
participant is a role, not a location. So the data and the choice sit at
the site, and a `weather` module holds what several modules need:

- `weather.points` — the grid cell or the station a site reads: its
  position, the model it belongs to and the model's resolution; sites are
  linked to their nearest point, and the weather series hang on the point,
  once, whatever the number of sites in the cell (ERA5 cells are 25 km;
  SARAH 5 km). A site with its own station is its own point.
- weather models are `sources` with their coverage (`countries`,
  `regions`, and a coverage geometry when a dataset stops at a coastline
  or a latitude), their licence and their retention. Open ones ship with
  the core (PVGIS SARAH3 in Europe and Africa, ERA5 everywhere through
  Open-Meteo); national services come with packs (a weather office's
  reanalysis or forecast); licensed ones with Nexgen, WeSmart's commercial platform,.
- `weather.source_for(site, purpose)` resolves the model to use for one
  site and one purpose (irradiance for a yield, temperature for heating,
  a forecast for dispatch), in this order: the project's explicit choice,
  the organisation's connection, the pack's rule for the country or the
  region, the core's default by coverage. A run always records which one
  it read, so two sites of one project may read two models when their
  locations call for it, and the result says so.

The choice is therefore made per site through data, never per device; a
project may pin a model for a study, and a run may be given one
explicitly for a comparison.
