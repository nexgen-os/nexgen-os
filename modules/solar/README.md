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
| `solar.module_products`, `solar.inverter_products` | the physics of a `device_directory` product, same id: `model` and `parameters` (one JSON object). The keys pvlib infers each model from are required — modules: `pvwatts` `pdc0, gamma_pdc`; `cec` `a_ref, I_L_ref, I_o_ref, R_sh_ref, R_s, Adjust`; `pvsyst` `gamma_ref, mu_gamma, R_sh_0, R_sh_exp`; `sapm` `A0, A1, C3`. Inverters: `pvwatts` `pdc0, eta_inv_nom`; `sandia` `C0, C1, C2`; `adr` `ADRCoefficients`; `ond` free. Shared rows are read by everyone signed in, like `device_directory` |
| `solar.horizons` | the far horizon of a site or a surface, `[azimuth_deg, elevation_deg]` pairs, one per object and scenario, with its source |
| `solar.yield_profiles` | named modelling choices: decomposition, transposition, incidence, temperature model and parameters, spectral, ordered losses, clipping. A vocabulary, read by everyone signed in |

`solar.system_kwp(system, scenario?)` gives the DC power of a system: the sum
of its arrays, or its own `kwp_dc` when it has none.

## Yield profiles shipped

| Code | Imitates | Choices |
|---|---|---|
| `pvgis_like` | PVGIS PVcalc | SARAH / ERA5 components, Muneer, DEM horizon, Faiman 26.9 / 6.2, `system` 14 %, no clipping |
| `pvwatts` | PVWatts v8 | Perez, Faiman 25 / 6.84, PVWatts DC and AC models, `system` 14 % |
| `pvsyst_like` | PVsyst 8 | Hay-Davies, Uc 29 / Uv 0, losses in the loss-diagram order: iam, soiling 2, lid 2, module_quality −0.75, mismatch 2, dc_wiring 1.5, ac_wiring 1, availability 0 |
| `pvsol_like` | PV\*SOL premium 2026 | Hofmann, Hay-Davies, ΔT per mounting (22 / 29 / 32 / 43 / 20 K), losses without values (PV\*SOL's defaults not verified) |

Each row's `description` says what was not verified.

## Quantities

`ghi`, `dni`, `dhi`, `poa_irradiance` (W/m², mean) and `module_temperature`
(°C, mean). Production power and energy and the generic `irradiance` are
the core's.

## Not here yet

- Yield runs and their summary (annual yield, specific yield, performance
  ratio, P50 / P90), the IEC 61724-1 indicators, and the format readers
  (PVGIS, EPW, PAN / OND, PVsyst and PV\*SOL CSV).
- `site_of()` does not know `pv_array` yet: modules extend it by replacing
  the whole function, which would drop another module's kinds. An array's
  site is its system's (`devices.site_id`).
