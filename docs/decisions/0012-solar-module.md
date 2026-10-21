# 0012 — A yield says what it was computed from

> Status: accepted · 13/10/2026, rewritten 19/10/2026 · a record of the modules

## Context

The platform this core comes from computed a PV yield in one function:
hourly plane-of-array irradiance from a reanalysis, a cell temperature
model, a PVWatts-like conversion with one system loss per organisation, a
typical year chosen month by month. A six-week comparison with a partner's
PV\*SOL studies showed where it diverged: the clock of the series, a
multi-year hourly mean that smoothed the weather, one loss figure where
PV\*SOL and PVsyst carry eight, the weather source itself (2 to 3 % on the
annual), and conventions nobody wrote down: azimuth zero at south in one
tool and at north in another, values dated at the end of the hour here and
at the start there, winter time all year in one tool.

The gaps between tools are gaps of inputs and conventions first, of physics
second. A yield is comparable when it says which weather, which period,
which time convention, which models and which losses it was computed with.

## Decision

**A trade is a module named after what it adds.** Photovoltaics is the
`solar` module; weather, storage, consumption and sharing are modules of
their own, each reading the series the others produce. There is no
catch-all energy module.

**The array is the level every tool exchanges.** Between the roof face and
the PV system sits one group of modules with one orientation, one mounting,
one product and one inverter, as pvlib's array, PVsyst's orientation and
Orange Button's PV array do. Its azimuth and tilt come from its surface and
may be overridden for racks and trackers.

**A product's physics is data in a published vocabulary of keys.** The
parameters of a module or inverter model are kept in pvlib's key names, so
that pvlib, SAM and a PAN/OND reader agree on what each key means; the
product itself is a catalogue entry of the core
([0027](0027-a-product-is-a-catalogue-entry.md)).

**A yield profile is a named set of modelling choices**: decomposition,
transposition, incidence, temperature, spectral, an ordered list of losses,
clipping. Losses are a list with an order, never one percentage. A profile
that imitates a tool says so in its name (`pvsyst_like`), and documents
what that tool assumes ([0016](0016-naming-third-party-methods.md)).

**Conventions are written once.** Azimuth in degrees clockwise from true
north; every value dated at the start of its interval, in UTC, read in the
participant's time zone ([0029](0029-a-series-belongs-to-an-object.md)); a
typical year is simulated, never a real year; every reader and connector
converts from its source's own convention.

**Weather belongs to the place.** It is a series of the participant or of a
weather point several participants share, with its source; which weather
model a participant reads is a default resolved through the one cascade
([0021](0021-one-cascade-of-defaults.md)), from the project's choice down to
the pack's rule for the country or the region, within the coverage of the
model.

**A run says everything.** A yield run records the system, the profile, the
weather series and their period, the horizon, the engine and its version,
and writes its simulated series and its summary (annual and specific
yield, performance ratio, P50 and P90). Measured production stays measured;
the indicators of IEC 61724-1 compare the two.

**Proprietary project files are read as results, never written.** A PVsyst
or PV\*SOL result lands as a run and its documents; the weather a run used
is exported in a format those tools read, so that their user reruns the
same weather.

**The line with paid data runs on prices, never on physics.** Product
physics come from open readers; prices, installed costs and supplier
references may come from a licensed dataset.

## What it forbids

- One loss percentage standing for a chain of losses.
- An azimuth from south, or a value dated at the end of its interval, past
  the reader that met it.
- A yield without its profile, weather source, period and engine version.
- A weather model chosen per device, or by a constant of the module.

## What it replaced

The planned catch-all `energy` module, the single system loss, the weather
module's own order of resolution ending on a core default, and the list of
modules to come that this record used to carry (now in the
[road map](../road-to-0.1.md)).

## See also

- [0004](0004-deterministic-runs.md), [0013](0013-external-engines.md) —
  runs and engines.
- [`modules/solar/README.md`](../../modules/solar/README.md),
  [`modules/weather/README.md`](../../modules/weather/README.md).
- IEC 61724-1, pvlib, SAM, Orange Button.
