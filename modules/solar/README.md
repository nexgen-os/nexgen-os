# `solar` — photovoltaic systems and what a yield is computed from

Decision [0012](../../docs/decisions/0012-a-yield-says-what-it-was-computed-from.md).

A PV yield is comparable with a PVsyst, PV\*SOL or PVGIS result only when it
says which weather, which period, which time convention, which models and
which losses it was computed with. This module holds those inputs as data.
Engines (pvlib, PVGIS, SAM) run outside Postgres; what they compute is an
estimate, kept in `solar.estimates` with its provenance and its inputs,
and written by the function that computed it
([0004](../../docs/decisions/0004-a-figure-says-where-it-comes-from.md)).

## Production, measured first

Production is a device's: a `production_energy` series of a PV system. A
meter measures what crosses it — offtake and injection, net of what is
consumed behind it — and the core refuses a production series on a meter
(`production_on_meter`). A production rebuilt from injection and what was
consumed on the spot is a `simulated` series naming the estimate it comes
from.

- `solar.curve_series(participant, from, to)` — for each PV system of a
  participant, the series its production is read from: measured first,
  otherwise the latest yield this module estimated for it, holding values
  in the period; on the model of `consumption.curve_series()`.
- `solar.curve(participant, from, to, step)` — the production of a
  participant on a step, the sum of its systems, with the series read and
  their kind. The sharing of `community` reads it for a participant without
  a metered series.
- The performance indicators read the measured production of the system
  only, and say so when there is none.

## Sizing: `size()`

`size(db, {participantId, criterion, target?, from, to, step, shape, bounds?, economics?})`
(`src/size.ts`, [0045](../../docs/decisions/0045-to-size-is-one-gesture.md))
answers the PV power that best meets a criterion of the core's
`sizing_criteria` for a participant, before any system exists:

- the consumption is the participant's curve, measured first
  (`consumption.curve()`); the production of one kWp is a production series
  the caller names with the power it was computed for (a yield of this
  module, a reference system);
- the limit is a stated maximum with its source, or the roof and carport
  faces of the participant (`building.surfaces`) times `pv_power_per_area`,
  resolved by `parameter_of()`;
- it sweeps a hundred powers up to the limit, then a finer step around the
  best; at each step what is consumed on the spot is min(production,
  consumption), the rest is injected;
- `self_consumption_rate` and `self_sufficiency` take the power closest to
  their target, `net_present_value` the largest value (prices, cost per kWp,
  horizon and discount rate from the caller, in the currency of the place),
  `payback` the shortest, `max_power` the limit; ties go to the smaller
  power. The rule is the platform's (`utils/solarSizing.ts`: the economic
  criterion and the target self-consumption rate);
- the curve and the recommended point are a row of `solar.estimates` about
  the participant, `kind = 'sizing'`, with its inputs.

Refusals: `participant_not_found`, `sizing_criterion_unknown`,
`target_required`, `economics_required`, `shape_invalid`, `bounds_invalid`,
`max_power_required`, `consumption_curve_missing`, `series_incomplete`,
`parameter_missing`.

## Conventions

- Azimuth: degrees clockwise from true north (90 = east, 180 = facing
  south, 270 = west), everywhere in the model. Tilt: degrees from
  horizontal. PVGIS and Open-Meteo count from south, west positive (0 =
  south, -90 = east, 90 = west): the conversion is written once,
  `azimuthFromSouth()` of `@nexgen-os/core`, and only the connectors that
  call them use it (`aspectOf()` in `@nexgen-os/pvgis`); a reader of
  PVsyst converts on the way in. Nothing stored is in another convention.
- Product parameters use pvlib's key names.
- Losses are an ordered list; each percentage applies to what the previous
  ones left, a negative one is a gain.

## Tables

| Table | What it is |
|---|---|
| `solar.devices` | a device of type `solar`, same id (`derive_devices`): `kwp_dc`, `kva_ac`, `grid_connection` (`injection`, `self_consumption`, `off_grid`), `commissioned_on`, `degradation_pct_per_year`, `first_year_loss_pct` |
| `solar.pv_arrays` | one group of modules of a system, its participant the system's, with its own azimuth and tilt, its own soiling loss when the place says it, and nothing else of where it is ([0026](../../docs/decisions/0026-a-device-belongs-to-its-participant.md)); `kwp_dc` from the module product's unit power × count unless given; `module_count = modules_per_string × strings` when all three are given |
| `solar.module_products`, `solar.inverter_products` | the physics of a `products` product, same id: `model` and `parameters` (one JSON object). The keys pvlib infers each model from are required — modules: `pvwatts` `pdc0, gamma_pdc`; `cec` `a_ref, I_L_ref, I_o_ref, R_sh_ref, R_s, Adjust`; `pvsyst` `gamma_ref, mu_gamma, R_sh_0, R_sh_exp`; `sapm` `A0, A1, C3`. Inverters: `pvwatts` `pdc0, eta_inv_nom`; `sandia` `C0, C1, C2`; `adr` `ADRCoefficients`; `ond` free. Shared rows are read by everyone signed in, like `products`. A PAN or OND file fills them: [`packages/formats/panond`](../../packages/formats/panond/README.md) reads it, `importProduct()` of [`src/products.ts`](src/products.ts) writes the product and its physics |
| `solar.horizons` | the far horizon of a participant or of a PV system, `[azimuth_deg, elevation_deg]` pairs, one per object and variant, with its source |
| `solar.variants` | a design variant of a participant's PV, on top of another one when it has a parent (`solar.create_variant()`): the arrays and horizons with a variant exist only in it and the variants built on it |
| `solar.estimates` | what the module computed for a PV system — a yield, IEC 61724-1 indicators, an exceedance: inputs, engine version, results; the series an estimate wrote name it in their source (`solar.estimates:<id>`) and hang on the system, an array's told apart by its name |
| `solar.yield_profiles` | named modelling choices: decomposition, transposition, incidence, temperature model and parameters, spectral, ordered losses, clipping. A vocabulary, read by everyone signed in |
| `solar.loss_kinds` | the losses of a yield, each at its stage of the chain: irradiance (`soiling`, `shading`, `snow`, `iam`, `spectral`), DC (`lid`, `module_quality`, `mismatch`, `dc_wiring`, `degradation`), conversion (`inverter`, `clipping`), AC (`ac_wiring`, `transformer`), system (`availability`, or the aggregate `system`). A vocabulary |
| `solar.estimate_losses` | the loss chain of a yield estimate, one row per loss in its order: its fraction (null when a model of the engine computes it), the array when the arrays differ, where it was read (`solar.yield_profiles:<code>`, or the place's soiling with its source and reference) and its quality (`value_quality`: a profile's usual starting value is `assumed`) |
| `solar.estimate_levels` | the exceedance levels of an exceedance estimate, one row per probability: P50 and those asked for |

`solar.system_kwp(system, variant?)` gives the DC power of a system: the sum
of its arrays (those of reality, and those of the variant and the
variants it builds on), or its own `kwp_dc` when it has none.

## Soiling of a place

How much light dirt takes depends on the place — dust from a field or a
road, birds, rain, a cleaning routine — rather than on a profile's modelling
choices. `soiling_loss` (a fraction, `0.02` for 2 %) is the column of a PV
array that says its own, or an attribute of its PV system (a `device`) or of
its participant, attached like any other with its source and its period.
`solar.soiling_of(object, at?)` reads the array's own, then what `parameter_of('device', …)`
answers for its system: the system's, its participant's, its organisation's, its
pack's; null when nobody says it.

A yield estimate reads it for each array at the start of the first year asked
and puts it in place of the profile's own `soiling` loss, at its rank: it
replaces the 2 % of `pvsyst_like` and fills the null of `pvsol_like`. A
profile that folds soiling into one aggregate loss (`system` of
`pvgis_like` and `pvwatts`) keeps that loss whole, so that soiling is never
counted twice; the estimate records, per array, the soiling found, where it was
found, and `applied: false` with the reason. An engine request carries one
list of losses: arrays whose soiling differs throw a named error
(`losses_differ_between_arrays`); say the soiling on the system or the participant
for an engine estimate. A fraction outside [0, 1) throws `soiling_out_of_range`.

## The parameters of a study, and where they live here

What a PVsyst, PV\*SOL or PVWatts study declares about the place and its
losses, and where it is held in this module:

| Parameter | Here | Read by |
|---|---|---|
| tilt, azimuth | `solar.pv_arrays` (degrees clockwise from north) | every estimate |
| mounting | `solar.pv_arrays.mounting` | PVGIS (`building` / `free`), engines (temperature parameters) |
| far horizon | `solar.horizons` | not yet in the hourly shape (PVGIS's own reaches the annual through anchoring) |
| ground albedo | `solar.pv_arrays.albedo` | engines (ground-reflected irradiance); `pvwatts` reads a plane-of-array irradiance the weather source transposed with its own ground reflection, and its estimate says the array's albedo is not applied |
| bifacial modules | `solar.pv_arrays.bifacial` | recorded `not modelled` by every estimate: no rear-side gain is applied |
| soiling | `soiling_loss` on the array, the system or the participant | every estimate, in place of the profile's `soiling` loss |
| mismatch, wiring, LID, module quality, availability | the profile's ordered losses | every estimate |
| temperature coefficient γ | the module product (`gamma_pdc`), else the request | `pvwatts`, engines on the PVWatts DC model |
| degradation | `solar.devices.degradation_pct_per_year`, `first_year_loss_pct` | not yet applied to an estimate |

## Yield profiles shipped

| Code | Imitates | Choices |
|---|---|---|
| `pvgis_like` | PVGIS PVcalc | SARAH / ERA5 components, Muneer, DEM horizon, Faiman 26.9 / 6.2, `system` 14 %, no clipping |
| `pvwatts` | PVWatts v8, as `estimateYield` computes it | transposition by the weather source (Open-Meteo's `global_tilted_irradiance`), Faiman 25 / 6.84, PVWatts DC model, `system` 14 %; no inverter model, no clipping |
| `pvsyst_like` | PVsyst 8 | transposition not verified (null), Uc 29 / Uv 0, losses in the loss-diagram order: iam, soiling 2, lid 2, module_quality −0.75, mismatch 2, dc_wiring 1.5, ac_wiring 1, availability 0 (usual starting values, not verified defaults) |
| `pvsol_like` | PV\*SOL premium 2026 | Hofmann, Hay-Davies, ΔT per mounting (22 / 29 / 32 / 43 / 20 K), losses without values (PV\*SOL's defaults not verified) |

Each row's `description` says which values are published defaults and
which were not verified; a column naming a model nobody runs or nobody
verified is null.

## Yield estimates

`estimateYield(db, request, clients)` (`yield.ts`) computes two of the profiles. Both
store the hourly energy as a `simulated` `production_energy` series on the
PV system (kWh per hour, dated at the start of the hour, UTC), the air
temperature at its participant's place, and an estimate (`solar.estimates`) whose inputs
say which weather, which period, which arrays, which models and losses, and
which conventions it was computed with. Two estimates on the same roof are
compared by reading their `solar.estimates.inputs` side by side.

The request: `deviceId`, `years` (`from`, `to`, whole calendar years),
`profileCode` (`pvgis_like` unless given). The arrays are the system's
(`solar.pv_arrays` of reality, by name), each with an azimuth, a tilt and a
power; a system without arrays has no orientation and is refused
(`array_without_orientation`).

| Profile | Computed by | Weather | What else the request may give |
|---|---|---|---|
| `pvgis_like` | PVGIS `seriescalc`, one call per array | PVGIS's radiation database for the place (SARAH3, or ERA5 outside its coverage), the years asked | `raddatabase` to force one |
| `pvwatts` | this module (`pvwatts.ts`) | Open-Meteo's ERA5 archive (`history()`), hourly plane-of-array irradiance transposed by Open-Meteo, air temperature at 2 m, wind at 10 m, the years asked in the participant's local calendar | `gammaPdc`, `typicalYear`, `anchor` |

`pvwatts` needs the participant's time zone (`participants.time_zone`, IANA); without
it, it throws a named error (`time_zone_required`). Days, months and years
are cut in the participant's local standard time (no daylight-saving shift, as in
TMY files), so that a sunlit day is never split by UTC midnight; every
value stays dated at the start of its hour, in UTC. The years asked are
read with one day more on each side, then cut at the local new year.

`pvwatts`, step by step, each a pure function tested on its own:

1. **Align**: the irradiance of an hour (a mean of the preceding hour at
   Open-Meteo, dated at its start) with the mean of the temperatures and
   winds read at its two ends.
2. **Clean**: irradiance missing or below zero → 0, above 1,400 W/m² (the
   solar constant and a margin) → 1,400; temperature and wind gaps take the
   last value read. A period without any temperature or wind throws a
   named error (`weather_without_temperature`, `weather_without_wind`).
3. **Convert**: Faiman cell temperature with the profile's `u0` and `u1`,
   the PVWatts DC model with γ (`gamma_pdc` of the array's module product
   when it is a `pvwatts` one, else the request's `gammaPdc`, else a named
   error, `gamma_unknown`; γ outside [−0.01, 0] throws `gamma_out_of_range`,
   a positive value being a sign error), then the fraction that remains
   after the profile's losses, in their order (`remainingAfterLosses`).
4. **Add up** the arrays hour by hour.
5. **Typical year** (default): for each calendar month, the real month
   whose daily energies (local days) are distributed most like those of
   every year (Finkelstein-Schafer statistic on daily energy; a year
   covering less than 95 % of the month is no candidate; the most recent
   year wins a tie). The months are chosen once for the system, so every
   array reads the same days. The year is laid on the local calendar of
   `years.to` (the estimate's `calendar_year`), 29 February left out, 8,760
   values: an hour the chosen month lacks takes the multi-year mean of that
   hour (`hours_from_mean` in the estimate), and an hour no year has throws a
   named error (`period_not_covered`). The year is then scaled to the mean
   annual total over the years used. It is stored in a series of its own,
   named `typical year <from>-<to>`, apart from the real years.
   **Real years** (`typicalYear: false`): the series as it is; the annual
   is the mean over the years covered, a year counting when at least 95 %
   of its hours have a value. The estimate records `years_covered`; when no
   year is covered, a named error (`period_not_covered`).
6. **Anchor** (`anchor: 'pvgis'`): each array's annual is brought to PVGIS's
   `PVcalc` yearly yield for the same array (same orientation, mounting and
   total loss) by one factor applied to every hour. The factors, PVGIS's
   radiation database and the system's factor are in the estimate.

What `pvwatts` does not model, and says so in the estimate: inverter efficiency
and clipping, incidence angle and spectral losses, the far horizon in the
hourly shape (PVGIS's horizon only reaches the annual, through the
anchoring), and the rear side of a bifacial array: no gain is applied, and
the estimate records `bifacial: 'not modelled'` for each bifacial array.

## Yield estimates computed by an engine

A profile and an engine are two axes. The profile chooses the weather,
the models and the losses; the engine computes them. With `engine: { name:
'pvlib', command? }` (decision [0013](../../docs/decisions/0013-a-program-connector-reads-one-request.md),
[`packages/connectors/pvlib`](../../packages/connectors/pvlib/README.md)), `estimateYield` computes any
profile whose models the engine has, and needs `profileCode`
(`profile_required` otherwise) and the participant's time zone:

| Read from | Sent to the engine |
|---|---|
| the system, its arrays and their products (the same rows as the other estimates) | each array's orientation, mounting and albedo; its module product's model and parameters with `modules_per_string` and `strings` (`array_without_layout` when a `cec`, `pvsyst` or `sapm` product has no count), or the PVWatts DC model on the array's power and γ (as `pvwatts`); the arrays' one inverter product, or `no_loss` when none is named (`inverters_differ` when they name several); an `ond` product as the Sandia model fitted on its efficiency curves as pvlib's `fit_sandia` does ([`inverter.ts`](src/inverter.ts)), recorded in the estimate's inputs with `fitted_from: 'ond'`; a Sandia, ADR or OND inverter needs module products whose model gives the DC voltage (`inverter_needs_voltage` on the PVWatts DC model) |
| the profile | decomposition, transposition, incidence (`iam_model`, `no_loss` when null), spectral, temperature model and parameters, the ordered losses as fractions |
| the weather connector (Open-Meteo's ERA5 archive), the years in the participant's local calendar | a profile with a transposition: `ghi`, `dni`, `dhi` once for the participant (`ghi` alone when it names a decomposition); without one: each array's `poa_irradiance`, as `pvwatts` reads it; temperature and wind speed |

What the engine answers is stored as it comes, in series named
`<engine> <from>-<to>`: `production_energy` on the system,
`poa_irradiance` and `module_temperature` on each array (on the system for
a system without arrays). The estimate's `provenance` is the engine's string
from `describe` (`pvlib 0.16.1`); its inputs keep the profile, the engine
with its dependencies, the weather read and the models as the engine
resolved them (`model`); its results the annual (the mean over the years
covered, as for real years), the specific yield and the series. The typical
year and the anchoring on PVGIS belong to `pvwatts` and are not applied to
an engine's estimate.

## P50 and P90 of a yield estimate

`exceedance(db, { yieldEstimateId, uncertainties?, probabilities?, horizonYears? })`
([`exceedance.ts`](src/exceedance.ts)) reads a yield estimate on real years — an
engine estimate or `pvwatts` with `typicalYear: false` — and gives the energy a
year exceeds with each probability asked (75, 90 and 99 % by default):

- the yearly totals of the estimate's `production_energy`, in the participant's local
  standard time, a year counting with 95 % of its hours (as the estimates count
  them); their mean is the P50;
- the interannual variability, their sample standard deviation relative to
  the P50, divided by √`horizonYears` (1: any one year; 10: the mean of ten);
- the components the years do not measure (irradiance dataset,
  transposition, models, soiling, availability), named by the caller as
  standard deviations in percent and added in quadrature;
- `P_x = P50 · (1 − z_x · σ)`, the annual energy taken as normal.

The result is an estimate of `solar` (`solar-exceedance-0.3.0`) naming the yield
estimate, the yearly totals, the components and the horizon; P50 and every level
asked for (P75, P90, P95, P99 on request) are rows of `solar.estimate_levels`. Named errors:
`estimate_not_found`, `real_years_required` (a typical year, or fewer than two
complete years), `time_zone_required`, `probability_invalid`,
`uncertainty_invalid`, `horizon_invalid`.

## Quantities

`ghi`, `dni`, `dhi`, `poa_irradiance` (W/m², mean), `module_temperature`
(°C, mean) and `wind_speed` (m/s, mean; the cell temperature depends on it).
Production power and energy and the generic `irradiance` are the core's.

## Performance against the measurement

`performanceIndicators(db, { deviceId, from, to, yieldEstimateId? })`
([`performance.ts`](src/performance.ts)) gives the indicators of IEC 61724-1
for whole days in the participant's time zone, in total and by month:

| Indicator | |
|---|---|
| final yield `final_yield_h` | measured `production_energy` of the system ÷ its `kwp_dc` |
| reference yield `reference_yield_h` | in-plane irradiation ÷ 1 kW/m² |
| performance ratio | final ÷ reference yield |
| energy performance index | measured ÷ expected energy, the expected energy being the yield estimate's `production_energy` (with `yieldEstimateId`) |

Only the hours where every series read has a value count, and their number
is given: a missing reading is never a dark hour. The in-plane irradiance is
a `measured` `poa_irradiance` on the system, or on its one array; without
a sensor, the yield estimate's simulated irradiance of each array, weighted by
power, and the answer says `irradiance: 'simulated'`. The result is an estimate
of `solar` (`solar-iec61724-0.3.0`) whose inputs name each series read with
its number of hours and its total: it says which readings it rests on, and a
new computation that names it (`replaces`) replaces it. Named errors: `device_not_found`,
`time_zone_required`, `series_not_found`, `irradiance_required`,
`estimate_not_of_system`, `period_not_covered`.

## Not here yet

- The `pvsyst_like` and `pvsol_like` profiles, and the readers of PVsyst
  and PV\*SOL result files. Weather files (EPW, TMY3) are read and written
  by [`packages/formats/weather-files`](../../packages/formats/weather-files/README.md),
  PAN and OND product files by
  [`packages/formats/panond`](../../packages/formats/panond/README.md).
