# `solar` — photovoltaic systems and what a yield is computed from

Decision [0012](../../docs/decisions/0012-solar-module.md); research:
[docs/research/solar-tools.md](../../docs/research/solar-tools.md).

A PV yield is comparable with a PVsyst, PV\*SOL or PVGIS result only when it
says which weather, which period, which time convention, which models and
which losses it was computed with. This module holds those inputs as data.
Engines (pvlib, PVGIS, SAM) run outside Postgres and hand their results back
through `record_run()`.

## Conventions

- Azimuth: degrees clockwise from true north (180 = facing south). Tilt:
  degrees from horizontal. Readers of PVGIS, Open-Meteo and PVsyst, which
  count from south, convert on the way in.
- Product parameters use pvlib's key names.
- Losses are an ordered list; each percentage applies to what the previous
  ones left, a negative one is a gain.

## Tables

| Table | What it is |
|---|---|
| `solar.pv_systems` | a device of type `solar`, same id (`derive_devices`): `kwp_dc`, `kva_ac`, `grid_connection` (`injection`, `self_consumption`, `off_grid`), `commissioned_on`, `degradation_pct_per_year`, `first_year_loss_pct` |
| `solar.pv_arrays` | an object (`pv_array`): one group of modules with one orientation, on a surface of the system's site (`array_outside_system_site` otherwise). Azimuth and tilt come from the surface unless given; `kwp_dc` from the module product's unit power × count unless given; `module_count = modules_per_string × strings` when all three are given |
| `solar.module_products`, `solar.inverter_products` | the physics of a `device_directory` product, same id: `model` and `parameters` (one JSON object). The keys pvlib infers each model from are required — modules: `pvwatts` `pdc0, gamma_pdc`; `cec` `a_ref, I_L_ref, I_o_ref, R_sh_ref, R_s, Adjust`; `pvsyst` `gamma_ref, mu_gamma, R_sh_0, R_sh_exp`; `sapm` `A0, A1, C3`. Inverters: `pvwatts` `pdc0, eta_inv_nom`; `sandia` `C0, C1, C2`; `adr` `ADRCoefficients`; `ond` free. Shared rows are read by everyone signed in, like `device_directory`. A PAN or OND file fills them through [`formats/panond`](../../formats/panond/README.md) |
| `solar.horizons` | the far horizon of a site or a surface, `[azimuth_deg, elevation_deg]` pairs, one per object and scenario, with its source |
| `solar.yield_profiles` | named modelling choices: decomposition, transposition, incidence, temperature model and parameters, spectral, ordered losses, clipping. A vocabulary, read by everyone signed in |

`solar.system_kwp(system, scenario?)` gives the DC power of a system: the sum
of its arrays, or its own `kwp_dc` when it has none.

## Yield profiles shipped

| Code | Imitates | Choices |
|---|---|---|
| `pvgis_like` | PVGIS PVcalc | SARAH / ERA5 components, Muneer, DEM horizon, Faiman 26.9 / 6.2, `system` 14 %, no clipping |
| `pvwatts` | PVWatts v8, as `runYield` runs it | transposition by the weather source (Open-Meteo's `global_tilted_irradiance`), Faiman 25 / 6.84, PVWatts DC model, `system` 14 %; no inverter model, no clipping |
| `pvsyst_like` | PVsyst 8 | transposition not verified (null), Uc 29 / Uv 0, losses in the loss-diagram order: iam, soiling 2, lid 2, module_quality −0.75, mismatch 2, dc_wiring 1.5, ac_wiring 1, availability 0 (usual starting values, not verified defaults) |
| `pvsol_like` | PV\*SOL premium 2026 | Hofmann, Hay-Davies, ΔT per mounting (22 / 29 / 32 / 43 / 20 K), losses without values (PV\*SOL's defaults not verified) |

Each row's `description` says which values are published defaults and
which were not verified; a column naming a model nobody runs or nobody
verified is null.

## Yield runs

`runYield(db, request, clients)` (`yield.ts`) runs two of the profiles. Both
store the hourly energy as a `simulated` `production_energy` series on the
PV system (kWh per hour, dated at the start of the hour, UTC), the air
temperature on its site, and a run (`record_run('solar', …)`) whose inputs
say which weather, which period, which arrays, which models and losses, and
which conventions it was computed with. Two runs on the same roof are
compared by reading their `runs.inputs` side by side.

The request: `pvSystemId`, `years` (`from`, `to`, whole calendar years),
`profileCode` (`pvgis_like` unless given). The arrays are the system's
(`solar.pv_arrays`), or one array on the device's surface with the system's
power when it has none; each needs an azimuth, a tilt and a power.

| Profile | Computed by | Weather | What else the request may give |
|---|---|---|---|
| `pvgis_like` | PVGIS `seriescalc`, one call per array | PVGIS's radiation database for the place (SARAH3, or ERA5 outside its coverage), the years asked | `raddatabase` to force one |
| `pvwatts` | this module (`pvwatts.ts`) | Open-Meteo's ERA5 archive (`history()`), hourly plane-of-array irradiance transposed by Open-Meteo, air temperature at 2 m, wind at 10 m, the years asked in the site's local calendar | `gammaPdc`, `typicalYear`, `anchor` |

`pvwatts` needs the site's time zone (`sites.time_zone`, IANA); without
it, it throws a named error (`time_zone_required`). Days, months and years
are cut in the site's local standard time (no daylight-saving shift, as in
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
   `years.to` (the run's `calendar_year`), 29 February left out, 8,760
   values: an hour the chosen month lacks takes the multi-year mean of that
   hour (`hours_from_mean` in the run), and an hour no year has throws a
   named error (`period_not_covered`). The year is then scaled to the mean
   annual total over the years used. It is stored in a series of its own,
   named `typical year <from>-<to>`, apart from the real years.
   **Real years** (`typicalYear: false`): the series as it is; the annual
   is the mean over the years covered, a year counting when at least 95 %
   of its hours have a value. The run records `years_covered`; when no
   year is covered, a named error (`period_not_covered`).
6. **Anchor** (`anchor: 'pvgis'`): each array's annual is brought to PVGIS's
   `PVcalc` yearly yield for the same array (same orientation, mounting and
   total loss) by one factor applied to every hour. The factors, PVGIS's
   radiation database and the system's factor are in the run.

What `pvwatts` does not model, and says so in the run: inverter efficiency
and clipping, incidence angle and spectral losses, the far horizon in the
hourly shape (PVGIS's horizon only reaches the annual, through the
anchoring), and the rear side of a bifacial array: no gain is applied, and
the run records `bifacial: 'not modelled'` for each bifacial array.

## Yield runs computed by an engine

A profile and an engine are two axes. The profile chooses the weather,
the models and the losses; the engine computes them. With `engine: { name:
'pvlib', command? }` (decision [0013](../../docs/decisions/0013-external-engines.md),
[`engines/pvlib`](../../engines/pvlib/README.md)), `runYield` runs any
profile whose models the engine has, and needs `profileCode`
(`profile_required` otherwise) and the site's time zone:

| Read from | Sent to the engine |
|---|---|
| the system, its arrays and their products (the same rows as the other runs) | each array's orientation, mounting and albedo; its module product's model and parameters with `modules_per_string` and `strings` (`array_without_layout` when a `cec`, `pvsyst` or `sapm` product has no count), or the PVWatts DC model on the array's power and γ (as `pvwatts`); the arrays' one inverter product, or `no_loss` when none is named (`inverters_differ` when they name several) |
| the profile | decomposition, transposition, incidence (`iam_model`, `no_loss` when null), spectral, temperature model and parameters, the ordered losses as fractions |
| the weather connector (Open-Meteo's ERA5 archive), the years in the site's local calendar | a profile with a transposition: `ghi`, `dni`, `dhi` once for the site (`ghi` alone when it names a decomposition); without one: each array's `poa_irradiance`, as `pvwatts` reads it; temperature and wind speed |

What the engine answers is stored as it comes, in series named
`<engine> <from>-<to>`: `production_energy` on the system,
`poa_irradiance` and `module_temperature` on each array (on the system for
a system without arrays). The run's `engine_version` is the engine's string
from `describe` (`pvlib 0.16.1`); its inputs keep the profile, the engine
with its dependencies, the weather read and the models as the engine
resolved them (`model`); its results the annual (the mean over the years
covered, as for real years), the specific yield and the series. The typical
year and the anchoring on PVGIS belong to `pvwatts` and are not applied to
an engine's run.

## Quantities

`ghi`, `dni`, `dhi`, `poa_irradiance` (W/m², mean), `module_temperature`
(°C, mean) and `wind_speed` (m/s, mean; the cell temperature depends on it).
Production power and energy and the generic `irradiance` are the core's.

## Not here yet

- The run summary beyond the annual and specific yield (performance ratio,
  P50 / P90), the IEC 61724-1 indicators, the `pvsyst_like` and
  `pvsol_like` engines, and the format readers (PAN / OND, PVsyst and
  PV\*SOL CSV). Weather files (EPW, TMY3) are read and written by
  [`formats/weather-files`](../../formats/weather-files/README.md).
- `site_of()` does not know `pv_array` yet: modules extend it by replacing
  the whole function, which would drop another module's kinds. An array's
  site is its system's (`devices.site_id`).
