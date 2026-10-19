# `pvlib` — the PV yield engine

A Python package, `nexgen_pvlib`, that answers `pv_yield` requests (engine
contract 1, [`../README.md`](../README.md)) with
[pvlib python](https://pvlib-python.readthedocs.io/)'s `ModelChain`.
Requires Python 3.9 or later.

```bash
python3 -m venv .venv-pvlib
.venv-pvlib/bin/pip install -e engines/pvlib           # or `-e 'engines/pvlib[tested]'` for the pinned versions
export NEXGEN_ENGINE_PVLIB=".venv-pvlib/bin/python -m nexgen_pvlib"
```

## Versions tested

| Python | pvlib | pandas | numpy | scipy | Where |
|---|---|---|---|---|---|
| 3.14.7 | 0.16.1 | 3.0.6 | 2.5.4 | 1.18.1 | macOS, the `tested` extra of `pyproject.toml` |
| 3.9.6 | 0.13.0 | 2.3.3 | 2.0.2 | 1.13.1 | macOS; 0.13.0 is the newest pvlib pip installs on Python 3.9 |
| 3.12 | newest | newest | newest | newest | the `engine-pvlib` job of CI |

The engine string a run records is pvlib's: `pvlib 0.16.1`. `describe`
answers the rest (`nexgen_pvlib`, Python, pandas, numpy, scipy).

## `pv_yield`

```jsonc
{ "kind": "pv_yield",
  "site": { "lat": 50.85, "lon": 4.35, "altitude_m": 30, "time_zone": "Europe/Brussels" },
  "arrays": [{ "name": "South", "azimuth_deg": 180, "tilt_deg": 35, "mounting": "roof_parallel",
               "module": { "model": "pvwatts", "parameters": { "pdc0": 1000, "gamma_pdc": -0.0035 } },
               "modules_per_string": 1, "strings": 1, "albedo": 0.2 }],
  "inverter": { "model": "pvwatts", "parameters": { "pdc0": 1000, "eta_inv_nom": 0.96 } },
  "losses": [{ "code": "soiling", "fraction": 0.02 }, { "code": "dc_wiring", "fraction": 0.015 }],
  "models": { "decomposition": null, "transposition": "haydavies", "temperature": "faiman",
              "temperature_parameters": { "u0": 25, "u1": 6.84 }, "aoi": "physical", "spectral": "no_loss" },
  "weather": [ /* CollectedSeries: ghi (dni, dhi) or poa_irradiance, temperature, wind_speed */ ],
  "albedo": 0.2 }
```

| Field | What it is |
|---|---|
| `site` | position in degrees; `altitude_m` in metres (pvlib looks it up when absent, and `meta` says so); `time_zone` is carried for the caller, every computation is in UTC |
| `arrays[]` | one orientation each, names unique. `mounting`: `open_rack`, `roof_parallel`, `semi_integrated`, `insulated`, `floating` (the values of `solar.pv_arrays`). `module.parameters` in pvlib's key names; `pvwatts` `pdc0` is in W per module. One module model for all the arrays of a request |
| `inverter` | `pvwatts` (`pdc0`, `eta_inv_nom`), `sandia` (`Paco`, `Pdco`, `C0`…), `adr`, or `no_loss`: AC equals DC, no inverter modelled, which is what the `pvwatts` profile of `modules/solar/src/pvwatts.ts` assumes |
| `losses` | the yield profile's ordered losses, as fractions; each applies to what the previous ones left, a negative one is a gain. They multiply the DC power before the inverter. A loss without a value is refused (`loss_without_value`) |
| `models.transposition` | `haydavies`, `perez`, `isotropic`, `klucher`, `reindl`; required with horizontal weather, ignored with `poa_irradiance` |
| `models.decomposition` | `erbs` or null: with `ghi` alone, pvlib's `irradiance.erbs` gives `dni` and `dhi`, and `meta` says so |
| `models.temperature` | `faiman`, `pvsyst`, `sapm`; `temperature_parameters` from the yield profile, else pvlib's published set for each array's mounting (below) |
| `models.aoi` | `physical`, `ashrae`, `martin_ruiz`, `sapm`, `no_loss`; anything but `no_loss` needs horizontal weather (the beam on the plane) |
| `models.spectral` | `no_loss`, `sapm`, `first_solar` |
| `weather` | `temperature` and `wind_speed` (instants or interval means); irradiance as `ghi` (with or without `dni` and `dhi`) for the site, or `poa_irradiance` for the site or for each array (`"array": "<name>"`), as interval means. The irradiance series sets the intervals; they must be regular |

**Temperature per mounting** (`pvlib.temperature.TEMPERATURE_MODEL_PARAMETERS`).
PVsyst's U-values are the ones [`docs/research/solar-tools.md`](../../docs/research/solar-tools.md)
§ 1.2 reads from PVsyst's help: free-standing 29, semi-integrated 20,
insulated back 15, all with Uv 0; a roof-parallel array is ventilated from
below like PVsyst's semi-integrated case. SAPM uses Sandia's open rack,
close mount and insulated back sets. Faiman has no published values per
mounting: U0 and U1 come from the yield profile, as `modules/solar/src/pvwatts.ts`
reads them (pvlib's defaults 25 / 6.84 in `pvwatts`, PVGIS's 26.9 / 6.2 in
`pvgis_like`).

| Mounting | `pvsyst` | `sapm` |
|---|---|---|
| `open_rack`, `floating` | `freestanding` (29, 0) | `open_rack_glass_polymer` |
| `roof_parallel`, `semi_integrated` | `semi_integrated` (20, 0) | `close_mount_glass_glass` |
| `insulated` | `insulated` (15, 0) | `insulated_back_glass_polymer` |

**Time.** Irradiance is a mean over its interval: the sun is placed at the
middle of each interval, and every result is dated at the interval's
start. An `instant` temperature or wind is averaged over the interval from
its readings at both ends, as `modules/solar/src/pvwatts.ts` does.

## Result

```jsonc
{ "series": [
    { "quantity_code": "production_energy", "value_kind": "interval", "step": "1 hour", "unit": "kWh", "values": [...] },
    { "quantity_code": "poa_irradiance", "unit": "W/m²", "array": "South", ... },
    { "quantity_code": "module_temperature", "unit": "°C", "array": "South", ... } ],
  "meta": { "pvlib": "0.16.1", "engine": "nexgen_pvlib 0.1.0",
            "models": { "dc": "pvwatts", "ac": "pvwatts", "decomposition": "none: dni and dhi given", "transposition": "haydavies",
                        "aoi": "physical", "spectral": "no_loss", "temperature": "faiman",
                        "losses": { "remaining_fraction": 0.9653, "applied_to": "dc, in order", "list": [...] } },
            "arrays": [ { "name": "South", "albedo": 0.2, "temperature": { "model": "faiman", "parameters": {...}, "from": "request" }, ... } ],
            "sun_position": "middle of each interval; ...", "not_modelled": [...] } }
```

`production_energy` is the AC energy of the system, kWh per interval, never
below zero (a Sandia inverter's night consumption is cut, and `meta` counts
the intervals). The cell temperature pvlib computes is the core's
`module_temperature` (`solar` module: "cell temperature when modelled").

Refusals: `weather_incomplete`, `array_invalid`, `site_invalid`,
`model_unknown`, `model_parameters_missing`, `model_invalid` (pvlib refused
the chain), `loss_without_value`, `kind_unknown`, `request_invalid`,
`engine_contract_mismatch`.

## Not covered yet

- Trackers: `pvlib.pvsystem.SingleAxisTrackerMount` (with `pvlib.tracking`) would.
- Bifacial rear side: `pvlib.bifacial.infinite_sheds` would.
- Horizon and near shading: `pvlib.shading` (`projected_solar_zenith_angle`, `shaded_fraction1d`) and a horizon profile applied to the beam would.
- Snow: `pvlib.snow` (`coverage_nrel`, `loss_townsend`) would.
- Soiling beyond the losses given: `pvlib.soiling` (`hsu`, `kimber`) would.
- Several inverters or module models in one system: one request per inverter.

## Licence

MIT ([`LICENSE`](LICENSE)). pvlib python is BSD-3-Clause.
