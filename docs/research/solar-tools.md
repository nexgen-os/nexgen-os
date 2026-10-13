# Solar design and yield tools — research notes

Research done on 13/10/2026 for the design of a `solar` module (PV systems on `surfaces`, yield runs, weather series). Sources are linked inline; versions are the ones read that day. "Not verified" means the primary page was not reachable or did not say; nothing below is filled in from memory without saying so.

---

## 1. Tools and how they model a project

### 1.1 Overview

| Tool | Version read | Project = | Time step | Weather | Machine interface |
|---|---|---|---|---|---|
| PVsyst | 8.1 (CLI example 8.1.7) | `.PRJ` project + `.VCi` variants (0–9, A–Z) | hourly or sub-hourly (since 8.1.0) | Meteonorm 9.0 built in, ~20 "known formats", custom CSV via `.MEF` | PVsystCLI (`run-simulation`, `convert-meteo`, `create-site`), yearly subscription |
| PV*SOL premium | 2026 Release 8 (22/09/2026) | 3D project, Windows only | hourly or 1-minute | MeteoSyn: Meteonorm 9, PVGIS SARAH3, Solcast, SolarAnywhere, NREL Meteosat; `.epw` import since 2025 R1 | none for simulation; REST APIs for its component and TMY3 databases only |
| NREL/NLR SAM | SAM 2026.7.3, SSC 308; PySAM 7.1.1 (24/04/2026, SSC 306) | case → JSON of compute-module inputs | hourly or sub-hourly (weather-file driven) | SAM CSV, TMY2, TMY3, EPW, SMW; NSRDB PSM v4 download | PySAM, SSC library, "Generate code" JSON |
| PVWatts API | v8.0.0 | 7 required parameters | hourly or monthly output | NSRDB PSM v3/v4 TMY, TMY2, TMY3, `intl` | REST, 1,000 requests/hour |
| pvlib python | 0.16.1 | `Location` + `PVSystem`/`Array`/`Mount` + `ModelChain` | any (pandas index) | readers for PVGIS, NSRDB PSM4, EPW, TMY2/3, Meteonorm, Solcast, Solargis, SolarAnywhere, ERA5, CAMS… | Python library, BSD-3 (knowledge) |
| HelioScope (Aurora) | marketing page ©2026 | web design, 8760 report | hourly, 8760 rows exactly | TMY2/TMY3, SWERA, EPW, Prospector, Meteonorm 7/8, NSRDB PSM v3; upload TMY3 CSV / EPW / TMY2 | not verified (help centre returned 403 to direct reads) |
| OpenSolar | API docs read 13/10/2026 | org → project → systems → module groups | not exposed | not exposed | REST (`api.opensolar.com`), Bearer token, MCP server beta |
| SMA Sunny Design | release notes up to 6.10 | web design | not stated | "high-resolution meteorological data", own data import; source not named | none found; CSV time-series export (PRO) |
| Solargis | Evaluate / Prospect | site + PV config | 15-min, hourly; 1-min in some products | own satellite model, from 1994 | Time Series and TMY API |

### 1.2 PVsyst 8.1

- **Project files.** `.PRJ` project, `.VCi` simulation variant ("the last letter of the extension determines the version number (running from 0..9 and A..Z)"), `.CMi` measured-data comparison, `.SIT` site (monthly), `.MET` hourly or sub-hourly weather, `.MEF` custom-CSV mapping, `.HOR` horizon (binary), `.SHD` near shading, `.PAN` module, `.OND` inverter, `.BTR` battery ([workspace](https://www.pvsyst.com/help/getting-started/file-organisation/user-data/workspace/index.html)). All files are text since 6.40, UTF-8 since 6.80, `key=value` lines of nested `PVObject_=…` / `End of PVObject` blocks; the format is "intended for internal use only" with "no support" ([format of PVsyst files](https://www.pvsyst.com/help/getting-started/file-organisation/user-data/format-of-pvsyst-files.html)).
- **Module model.** One-diode, five parameters (Iph, I0, Rs, Rsh, Gamma) at STC, with Rsh exponential in irradiance (`RshExp` default 5.5), `muGamma`, `muIsc`, `muVoc`, `muPmpp`, IAM profile, LID, bypass diodes ([one-diode model](https://www.pvsyst.com/help/physical-models-used/pv-module-standard-one-diode-model/index.html), [module dialog](https://www.pvsyst.com/help/component-database/photovoltaics-modules/pv-modules-main-interface/index.html)). Database ~12,500 modules.
- **Inverter model.** OND: `PNomAC` ("the crucial parameter"), `PMaxAC`, `VmppMin/Max`, `VAbsMax`, `Pthresh`, `IMax`, night consumption; efficiency = up to 8 points per curve, up to 3 input voltages, linear interpolation on power, quadratic between voltages; clipping losses `IL_Pmax`, `IL_Vmin`… ([OND parameters](https://www.pvsyst.com/help/component-database/grid-inverters/grid-inverters-main-interface/grid-inverters-main-parameters/index.html), [efficiency model](https://www.pvsyst.com/help/physical-models-used/grid-inverter/inverter-model-efficiency.html)). Database ~4,500 inverters.
- **Thermal model.** αG(1−η) = (Uc + Uv·WS)(T − Tamb), α = 0.9; free-standing Uc 29, fully insulated back 15, semi-integrated default 20, all Uv = 0; "PVsyst does not provide a default Uv value" ([U-values](https://www.pvsyst.com/help/project-design/array-and-system-losses/array-thermal-losses/u-value-measurement.html)).
- **Losses.** Diagram order: IAM, soiling, irradiance level, thermal, LID, light soaking, module quality, mismatch, degradation, optimisers, DC ohmic, inverter (`IL_*`), AC ohmic, transformer, auxiliaries, unavailability; each percentage is relative to the previous energy, so they are multiplicative, not additive ([loss diagram](https://www.pvsyst.com/help/project-design/results/loss-diagram.html), [losses](https://www.pvsyst.com/help/project-design/array-and-system-losses/index.html)). Degradation: 0.3 %/year cited as measured average, year N simulated at mid-year ([ageing](https://www.pvsyst.com/help/project-design/array-and-system-losses/ageing-pv-modules-degradation/index.html)).
- **Outputs.** Hourly/daily/monthly CSV with chosen variables: `GlobHor`, `DiffHor`, `T_Amb`, `GlobInc`, `GlobEff`, `TArray`, `EArray`, `InvLoss`, `IL_Pmax`, `E_Grid`, `Yr`, `Ya`, `Yf`, `PR = E_Grid / (GlobInc × PNomArray)` ([variables](https://www.pvsyst.com/help/project-design/results/simulation-variables-grid-system.html), [CSV export](https://www.pvsyst.com/help/project-design/simulation/create-a-csv-file-of-hourly-daily-values.html)).
- **P50/P90.** Normal distribution around the simulated yield; uncertainties (weather variability, module model, inverter, soiling, degradation…) added in quadrature; "P90 lies 1.28 σ below the mean"; typical year-to-year variability 3–4 %; meaningful on annual values only ([P50-P90](https://www.pvsyst.com/help/project-design/p50-p90-evaluations.html)).
- **CLI.** `PVsystCLI.exe run-simulation --workspace --project --variant VC0 [--time-step hour|subhour] [--input-met-file] [--batch-params-file] [--output-csv-file] [--report-pdf-file]`; 60-day / 250-call trial, then yearly subscription bound to one machine ([CLI reference](https://www.pvsyst.com/help-cli/reference/index.html), [licensing](https://www.pvsyst.com/help-cli/licensing/index.html)).
- **Borrow:** the loss vocabulary and order, the variable names as an export target, Uc/Uv per mounting. **Avoid:** writing `.PRJ`/`.VCi` (unsupported internal format). **Lesson:** PVsyst is reproducible only with its variant file + `.MET` + `.PAN`/`.OND`; a Nexgen run must keep the same four things.

### 1.3 PV*SOL premium 2026

- Climate via MeteoSyn: Germany per km² from DWD, worldwide Meteonorm 9 (2001–2020), PVGIS SARAH3 (2025 R9), Solcast, SolarAnywhere, NREL Meteosat (2025 R1); own data as DWD, Meteonorm or `.epw` files ([product page](https://valentin-software.com/en/products/pvsol-premium/)).
- Irradiance: decomposition Hofmann (2017) by default (also Erbs, Reindl, Perez-Ineichen, Skartveit…), transposition **Hay & Davies by default** (also Perez 1987, Klucher, Reindl, Liu & Jordan) ([inclined plane](https://help.valentin-software.com/pvsol/en/calculation/irradiation/irradiation-onto-inclined-plane/), [diffuse](https://help.valentin-software.com/pvsol/en/calculation/irradiation/diffuse-irradiation/)).
- Temperature, hourly: T_module = T_amb + ΔT·E/1000, ΔT 29 K roof-parallel ventilated, 32 K integrated ventilated, 43 K integrated non-ventilated, 28 K on roof, 22 K free-standing, 20 K floating; no wind term. 1-minute mode adds a heat capacity (830 J/kg·K × module mass) ([module temperature](https://help.valentin-software.com/pvsol/en/calculation/pv-modules/module-temperature/)).
- PAN import since 2022 R1 (IAM and low-light improved in 2026 R4), OND import page exists; export `*.csv` time series (hourly always, 1/10/15-min only from a 1-minute run), project overview `*.json` since 2026 R1, PDF/Word report ([PAN import](https://help.valentin-software.com/pvsol/en/databases/import-pan-files/), [export](https://help.valentin-software.com/pvsol/en/pages/presentation/export-simulation-results/)). Project file extension and P50/P90 method not verified.
- **Borrow:** ΔT-per-mounting as the simplest temperature parameter. **Lesson:** a PV*SOL and a PVsyst run of the same roof differ by default in decomposition, transposition and temperature model; reproducing PV*SOL means carrying `transposition = hay_davies`, the ΔT mounting class and the MeteoSyn source, not just kWp and orientation.

### 1.4 SAM, PVWatts, pvlib (the open engines)

- **SAM/PySAM.** `Pvsamv1` (detailed: CEC module database with `module_model = 1`, CEC inverter database with `inverter_model = 0`) and `Pvwattsv8` ("does not do detailed degradation or loss modeling") ([SSC modules](https://nrel-pysam.readthedocs.io/en/main/ssc-modules.html), [helper tools](https://nrel-pysam.readthedocs.io/en/main/helper-tools.html)). The GUI's "Generate code → PySAM JSON" writes one `<case>_<module>.json` per compute module, replayed with `m.value(k, v)` then `execute()` ([inputs from SAM](https://nrel-pysam.readthedocs.io/en/main/inputs-from-sam.html)). NREL is now the National Laboratory of the Rockies: hosts moved to `sam.nlr.gov`, `developer.nlr.gov`, GitHub `natlabrockies` ([download page](https://sam.nlr.gov/download.html), [PySAM releases](https://github.com/natlabrockies/pysam/releases)).
- **PVWatts v8 API.** Required: `system_capacity` kW, `module_type` 0/1/2, `losses` % (no default; example 14), `array_type` 0–4, `tilt`, `azimuth`; optional `dc_ac_ratio` 1.2, `gcr` 0.4, `inv_eff` 96, `bifaciality`, `albedo`, monthly `soiling`; `dataset` `nsrdb|tmy2|tmy3|intl`; `timeframe=hourly` returns `ac`, `dc`, `poa`, `dn`, `df`, `tamb`, `tcell`, `wspd` ([PVWatts v8](https://developer.nlr.gov/docs/solar/pvwatts/v8/)).
- **pvlib 0.16.1.** `ModelChain(system, location, transposition_model='haydavies', aoi_model, spectral_model, temperature_model, dc_model, ac_model, dc_ohmic_model, losses_model)`; the DC model is inferred from the parameter keys: `{A0,A1,C3}` → SAPM, `{a_ref,I_L_ref,I_o_ref,R_sh_ref,R_s,Adjust}` → CEC, without `Adjust` → De Soto, `{gamma_ref,mu_gamma,…,R_sh_0,R_sh_exp}` → PVsyst, `{pdc0,gamma_pdc}` → PVWatts; AC: `{C0,C1,C2}` → Sandia, `ADRCoefficients` → ADR, `{pdc0}` → PVWatts ([ModelChain guide](https://pvlib-python.readthedocs.io/en/stable/user_guide/modeling_topics/modelchain.html), [API](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.modelchain.ModelChain.html)). Entry points `run_model` (ghi/dni/dhi), `run_model_from_poa`, `run_model_from_effective_irradiance`; missing `temp_air`/`wind_speed` default to 20 °C and 0 m/s. `pvlib.iotools.read_panond` reads `.pan` and `.ond` ([iotools](https://pvlib-python.readthedocs.io/en/stable/reference/iotools.html)).
- **RdTools** 3.2.1 (08/07/2026, MIT): year-on-year degradation rate and soiling from measured series, hourly or better ([docs](https://rdtools.readthedocs.io/), [repo](https://github.com/NatLabRockies/rdtools)).
- **Borrow:** pvlib as the reference engine and its parameter key sets as the canonical shape of module/inverter parameters; PVWatts parameters as the minimal "quick estimate" profile. **Lesson:** pvlib's inference-by-keys means a stored parameter set is self-describing — store it as one `jsonb` with a declared `model`, never as flattened columns.

### 1.5 Commercial design platforms

- **HelioScope.** Claims "within 1% of PVsyst" validated by DNV, NREL, CEC; results "in an 8760 production report" ([sim solutions](https://helioscope.aurorasolar.com/sim-solutions/)). Weather library: TMY2/TMY3, SWERA, EPW, Prospector, Meteonorm 7/8, NSRDB PSM v3; uploads must have exactly 8,760 rows ([weather sources](https://help-center.helioscope.com/hc/en-us/articles/19218896242323-Weather-Data-Sources), [upload](https://help-center.helioscope.com/hc/en-us/articles/8316876081299-Weather-File-Upload), via search snippets). Its validation guidance: to match PVsyst, weather, near-shade and horizon profiles, transposition, temperature model, soiling and binning must be aligned ([validation document](https://help-center.helioscope.com/hc/article_attachments/16496660354451), snippet). API not verified.
- **OpenSolar.** `GET /api/orgs/:org_id/projects/:project_id/systems/details/` returns `modules`, `inverters`, `batteries`, `module_groups` (`module_quantity`, `azimuth`, `slope`, `layout`), and with `include_parts=mcs` the UK MCS figures (`mcsSpecificYieldBeforeShading`, `shadingFactor`); systems carry `kw_stc`, `output_annual_kwh`; no hourly output or engine name found ([system details](https://developers.opensolar.com/api/system-details/), [systems](https://developers.opensolar.com/api/system/)).
- **Sunny Design.** Google Solar API roofs (5.90), PV production time-series upload (5.90), 366-day series import (6.00), CSV time-series export (PRO), Polysun and 3D model export; weather source not named on the pages read ([product page](https://www.sma.de/en/products/apps-software/sunny-design), [eManual](https://manuals.sma.de/SDesign/en-US/)).
- **Lesson:** every platform reduces a roof layout to *module groups with one azimuth/slope and a count* (OpenSolar `module_groups`, PVsyst orientations, pvlib `Array`). That is the object Nexgen needs between `surfaces` and the device.

---

## 2. Formats and standards

| Name | Owner / status | What it carries | Use in Nexgen OS |
|---|---|---|---|
| PAN (`.pan`) | PVsyst, text `PVObject_` blocks, undocumented | one-diode module parameters, IAM, LID, sizes | **read** (pvlib `read_panond` shows it is parseable); keep the raw file as a document |
| OND (`.ond`) | PVsyst, same | inverter limits, efficiency curves at up to 3 voltages | **read**; derive a Sandia/ADR or PVWatts set when needed |
| `.PRJ` / `.VCi` / `.MET` / `.HOR` | PVsyst internal | project, variant, weather, horizon (binary) | store as documents, do not write |
| PVsyst hourly CSV | PVsyst | `GlobInc`, `EArray`, `E_Grid`, losses per step | **read** to import a third-party study as a `simulated` run |
| PV*SOL CSV + project `*.json` | Valentin | time series, project overview | **read**; JSON schema not verified |
| SAM / PySAM JSON | NLR, BSD-3 (knowledge) | full `Pvsamv1`/`Pvwattsv8` input set | **write** (export a run so SAM can replay it) and read |
| pvlib parameters | pvlib, BSD-3 | `module_parameters`, `inverter_parameters`, `temperature_model_parameters` dicts | **canonical internal shape** |
| EPW | EnergyPlus 26.1 | hourly, hour 1 = 00:01–01:00, radiation "during the number of minutes preceding the time indicated" (Wh/m²) | **read and write** weather ([Auxiliary Programs](https://bigladdersoftware.com/epx/docs/26-1/auxiliary-programs/auxiliary-programs.html)) |
| TMY3 CSV | NREL TP-581-43156 (2008) | local standard time, values for the preceding 60 min | read ([manual](https://www.nrel.gov/docs/fy08osti/43156.pdf); convention as quoted by [pvlib read_tmy3](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.iotools.read_tmy3.html)) |
| PVGIS JSON/CSV/EPW | JRC, free, no restriction on use | see §3 | **read** (connector) |
| SunSpec information models | SunSpec Alliance, Apache-2.0 | Modbus maps: 1 Common, 101/103 inverter, 160 multiple MPPT, 201/203 meters, 302 irradiance, 701–713 DER (IEEE 1547) | map live device points to quantities ([sunspec/models](https://github.com/sunspec/models), labels read from `json/model_*.json`) |
| Orange Button OpenAPI | SunSpec/XBRL US, `ob-openapi-taxonomy` v1.1.7, no licence file, last update 03/2023 | `Site`, `PVSystem`, `PVArray`, `PVString`, `Orientation` (azimuth clockwise from north), `ProdModule`, `ProdInverter`, `EnergyModel` (`ModelWeatherSource`, `EnergyModelConfigurationFilename`), `WeatherDataRecord`, `PowerMeasurements`, `MonthlyOperatingReport` | **vocabulary mapping** (decision 0002), not a storage model ([repo](https://github.com/SunSpecOrangeButton/ob-openapi-taxonomy)); some schema names read from a summary, not the raw file |
| IEC 61724-1:2021 ed. 2 | IEC TC 82 | monitoring terminology, equipment, classes (class C removed in 2021), bifacial and soiling measurement | quantity names and PR/yield definitions ([webstore](https://webstore.iec.ch/en/publication/65561)) |
| IEC 61724-2 / -3 | IEC | capacity test / energy evaluation, built on part 1 | text not read |
| IEC 61853-1…4 (2011–2018) | IEC | 1: power matrix vs irradiance and temperature; 2: temperature, IAM, spectral response tests (adopts Faiman); 3: annual energy rating at reference climates; 4: standard reference climatic profiles | module parameter sets from datasheets/test reports ([61853-3 preview](https://www.vde-verlag.de/iec-normen/preview-pdf/info_iec61853-3{ed1.0}b.pdf), [61853-4](https://iteh.es/catalog/standards/sist/55a5e159-552f-4450-a7d3-8e2c51059e43/sist-en-iec-61853-4-2018), [pvlib faiman](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.temperature.faiman.html)) |
| IEC 62446-1:2016 + AMD1:2018 | IEC | handover documentation, commissioning tests and inspection of grid-connected PV | checklist for `documents` and commissioning series ([webstore](https://webstore.iec.ch/publication/24057)) |

**Azimuth conventions** — the one trap every import crosses:

| Convention | Used by |
|---|---|
| North = 0, clockwise (south = 180) | Nexgen OS `surfaces.azimuth_deg`, pvlib, PVWatts/SAM, Orange Button, Meteonorm Climate ([what's new](https://docs.meteonorm.com/knowledge/climate/whats-new)) |
| South = 0, west = +90, east = −90 | PVGIS `aspect`, Open-Meteo GTI `azimuth`, PVsyst (northern hemisphere; north = 0 in the southern hemisphere — [plane azimuth](https://www.pvsyst.com/help/glossary/solar-geometry/plane-azimuth.html)), Meteonorm 8 |
| Configurable at import | PVsyst horizon import (direction of rotation + north angle) |

Rule: store north-clockwise only; convert at the connector edge, and test the conversion with a south-facing and an east-facing case.

---

## 3. Weather data: sources, formats, differences

### 3.1 Sources

| Source | Data model | Period / resolution | Step | Licence | Access |
|---|---|---|---|---|---|
| PVGIS 5.3 | SARAH3 satellite (Europe, Africa, part of Asia/S. America), ERA5 reanalysis elsewhere, NSRDB (5.2 only) | SARAH3 2005–2023 at 0.05°; ERA5 2005–2023 at 0.25° | hourly | "completely free to use, with no restrictions" | REST `re.jrc.ec.europa.eu/api/v5_3/`, 30 calls/s/IP, no CORS ([API](https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/getting-started-pvgis/api-non-interactive-service_en), [manual](https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/getting-started-pvgis/pvgis-user-manual_en)) |
| Open-Meteo | NWP forecasts (ICON, IFS, AROME…), ERA5/ERA5-Land/IFS archive, satellite archive (MTG 10-min, MSG 15-min, SARAH3 30-min since 1983, Himawari) | ERA5 from 1940 | hourly; native 15-min (ICON-D2, AROME, HRRR) or 10/15/30-min satellite | data CC BY 4.0; free API non-commercial only (<10,000 calls/day), paid plans for commercial use | REST ([docs](https://open-meteo.com/en/docs), [historical](https://open-meteo.com/en/docs/historical-weather-api), [satellite](https://open-meteo.com/en/docs/satellite-radiation-api), [terms](https://open-meteo.com/en/terms)) |
| Meteonorm Climate (successor of 8, which is withdrawn) | >10,000 stations + 5 satellites + ERA5/MERRA-2, spatial interpolation of monthly means then stochastic hourly/minute generation | radiation 2001–2020 by default; AMY from 2020 | 1-min, 15-min, hourly | commercial: web app from 320 CHF/year, API tokens (TMY 500, AMY 1,000) | API, outputs csv/json/epw/pvsyst/pvsol/tmy3/polysun… ([climate](https://meteonorm.com/climate/), [API](https://docs.meteonorm.com/api/climate), [TMY](https://docs.meteonorm.com/knowledge/climate/tmy-overview)) |
| Solargis | own satellite model, 250 m | from 1994 | 1-min, 15-min, hourly | commercial (Evaluate €12,000/year) | Time Series + TMY API; PVsyst/PV*SOL/SAM files ([TMY](https://kb.solargis.com/docs/time-series-and-tmy-data), [API](https://kb.solargis.com/docs/solargis-time-series-and-tmy-api.md)) |
| NSRDB PSM v4 | GOES / Meteosat / polar satellite | 1998–2024, TMY 2022–2024 | 60-min (finer on request) | free with NLR API key | PySAM `FetchResourceFiles`, pvlib `get_nsrdb_psm4_*` |

### 3.2 Variables and names

| Meaning | pvlib | PVGIS seriescalc | Open-Meteo | PVsyst | EPW |
|---|---|---|---|---|---|
| global horizontal | `ghi` | — (G(h) in MRcalc/tmy) | `shortwave_radiation` | `GlobHor` | N13 |
| direct normal | `dni` | — | `direct_normal_irradiance` | `BeamNor` | N14 |
| diffuse horizontal | `dhi` | — | `diffuse_radiation` | `DiffHor` | N15 |
| plane of array | `poa_global` = `poa_direct` + `poa_diffuse` (+ ground) | `Gb(i)`, `Gd(i)`, `Gr(i)` with `components=1` | `global_tilted_irradiance` (isotropic sky, albedo 0.2) | `GlobInc` | — |
| air temperature | `temp_air` | `T2m` | `temperature_2m` | `T_Amb` | dry bulb |
| wind | `wind_speed` (at module height by convention) | `WS10m` (10 m) | `wind_speed_10m` | `WindVel` | wind speed |
| AC power | `ac` | `P` (W, for `peakpower` kWp) | — | `E_Grid` | — |

Names from the [pvlib nomenclature](https://pvlib-python.readthedocs.io/en/stable/user_guide/extras/nomenclature.html), a live PVGIS 5.3 `seriescalc` call made on 13/10/2026 (Brussels, 2023: `meta.outputs.hourly.variables` = `P`, `Gb(i)`, `Gd(i)`, `Gr(i)`, `H_sun`, `T2m`, `WS10m`, `Int`; `inputs.meteo_data` = `radiation_db: PVGIS-SARAH3`, `meteo_db: ERA5`, `horizon_data: DEM-calculated`), the Open-Meteo docs and PVsyst's [meteo variables](https://www.pvsyst.com/help/project-design/results/simulation-variables-meteo-and-irradiations.html). Wind height differs (10 m vs module height): a temperature model fed with `WS10m` needs its own coefficients or a height correction.

### 3.3 Time-stamp conventions

| Source | Label | Meaning | Zone |
|---|---|---|---|
| PVGIS SARAH | `YYYYMMDD:HHMM`, e.g. `:10` | instantaneous satellite value at that minute (manual §9.3); the JSON `meta` nevertheless says "hourly averages" | UTC — confirmed on 13/10/2026: the 16 June 2023 16:10 record gives `H_sun` 32.29°, which matches 16:10 UTC in Brussels, not local time |
| PVGIS ERA5 | `HH:30` | hourly mean centred | UTC (as above) |
| PVGIS TMY csv/json | `HH:00` | carries the SARAH `HH:MM` or ERA5 `HH:30` values | UTC; EPW variant starts at 01:00 and repeats 00:00 |
| Open-Meteo | `HH:00` | "preceding hour mean" (hour-ending); `*_instant` for point values; 15-min data = preceding 15-min mean | GMT by default; one fixed UTC offset per request, DST ignored |
| EPW | hour 1–24 | hour 1 = 00:01–01:00, totals over preceding minutes | local standard time (`TimeZone` in header) |
| TMY3 | hour 1–24 | preceding 60 min | local standard time |
| PVsyst `.MET` | interval start | 12:00 = 12:00–12:15 (15-min data); simulation in legal winter time; import options `Universal Time`, `interval end`, residual `Time shift` ([time shift](https://www.pvsyst.com/help/meteo-database/custom-meteo-files/time-shift.html)) | site winter time |
| Meteonorm API | `start_times` / `end_times` | averages | local time |
| Solargis | — | not verified ([time reference checks](https://kb.solargis.com/docs/time-reference-checks.md) not read) | UTC or longitudinal time zone |

**Lesson:** the classic error is a one- or two-hour shift of the production curve (local vs UTC, DST, start vs end of interval). The core already stores `value_kind = 'interval'` with `timestamptz`; each connector must state, in its source row, whether its label is interval start, end or centre, and convert to **interval start in UTC** before writing. A sun-position check (irradiance > 0 only when solar elevation > 0, peak near solar noon) belongs in the connector's tests.

### 3.4 Differences between sources, P50/P90

- PVsyst's own provider comparison (8.1 docs): free sources "typically concur within 10% of the mean value" on annual GHI at nine sites ([data source comparison](https://www.pvsyst.com/help/meteo-database/compare-meteo-data/data-source-comparison.html)); the PVsyst 7 note on 12 European sites says old PVGIS ran low, CM SAF satellite high, and Meteonorm 6.1 mostly below the average, so PVsyst defaults "tend to be conservative" ([meteonote 5](https://www.pvsyst.com/help-pvsyst7/meteo_notes_data_source_comparisons.htm), snippet). No independent peer-reviewed European multi-site yield delta was read; figures such as "P50 shifts 5–8 % with the source" seen in blogs are unsourced and not used here.
- PVGIS SARAH-2 hourly GHI bias vs BSRN stations: +0.7 to +10.2 W/m² at European/desert sites (Izaña −68.7, above the clouds), RMSD mostly 56–112 W/m² ([PVGIS methods](https://joint-research-centre.ec.europa.eu/pvgis-photovoltaic-geographical-information-system/getting-started-pvgis/pvgis-data-sources-calculation-methods_en)).
- Structural differences, from the sources above: PVGIS is satellite at ~5 km over 2005–2023; Meteonorm interpolates stations in space and synthesises hours stochastically over 2001–2020; a TMY of either is one "typical" year, not an average year. PVGIS's own PV model also differs (Muneer transposition, Faiman U0 26.9 / U1 6.2 for free-standing c-Si, default system loss 14 % including ~0.5 %/year ageing, "crystSi2025" +2–3 %).
- P50/P90: PVsyst computes P90 = mean − 1.28 σ from combined uncertainties; Meteonorm offers PoE10/PoE90 years (`extreme_setting`); Solargis delivers TMY P90/P75/P99 files built from 15-day chunks; PVGIS offers multi-year series (`startyear`/`endyear`) from which the inter-annual σ can be computed.
- **Lesson:** a gap between a Nexgen figure and a PV*SOL or PVsyst one is first a weather gap (source, period, TMY vs multi-year mean, time shift), then a model gap (transposition, temperature, losses). The module must make both visible: the weather series used is a named, sourced input of every run.

### 3.5 Horizon

PVGIS computes the horizon from a ~90 m DEM (`usehorizon=1`, `printhorizon` tool, `userhorizon` = heights from north clockwise, equidistant) ([API](https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/getting-started-pvgis/api-non-interactive-service_en)); PVsyst imports azimuth/height pairs with a configurable rotation and stores `.HOR` in binary; pvlib has `get_pvgis_horizon`. A horizon is a small array of (azimuth, elevation) pairs: one `jsonb` attribute per site or per surface, north-clockwise.

---

## 4. The modelling chain and the parameters to carry

The PVPMC guide orders the chain as: weather and design (sun position, irradiance, orientation, POA, shading/soiling/reflection) → DC module IV (temperature, effective irradiance, single-diode or point-value models) → DC array IV (mismatch, wiring) → DC to AC (inverter models, clipping) → AC output (wiring, PR, yield, uncertainty) ([PVPMC modeling guide](https://pvpmc.sandia.gov/modeling-guide/)).

| Step | Options in the tools | Parameters to store | Default to reproduce |
|---|---|---|---|
| Sun position | SPA (`nrel_numpy`) | latitude, longitude, altitude; timestamps UTC | — |
| Decomposition (GHI → DNI/DHI) | Erbs, DIRINT, Hofmann (PV*SOL), none if source gives DNI/DHI | `decomposition_model` | Hofmann for PV*SOL |
| Transposition | Perez, Hay-Davies, isotropic, Muneer (PVGIS), Klucher, Reindl | `transposition_model`, `albedo` (scalar or 12 months) | Hay-Davies for PV*SOL and pvlib; PVsyst default not verified on the pages read |
| Horizon / shading | DEM horizon, near-shading factors per hour or per sun position | horizon profile; shading factor series or matrix | PVGIS DEM horizon |
| IAM | physical, ASHRAE (b0), Martin-Ruiz, Sandia, table from PAN | `iam_model`, its parameters | from PAN when imported |
| Soiling | constant, monthly, Kimber, HSU | `soiling_pct` (12 values) | 0–2 % (no source default) |
| Spectral | none, SAPM, First Solar | `spectral_model` | none for c-Si |
| Cell temperature | PVsyst Uc/Uv, Faiman U0/U1, SAPM a/b/ΔT, NOCT, Fuentes, PV*SOL ΔT | `temperature_model` + parameters | PVsyst Uc 29/20/15, Uv 0; Faiman 25/6.84 (pvlib) or 26.9/6.2 (PVGIS); PV*SOL ΔT by mounting |
| DC module | PVsyst one-diode, CEC/De Soto, SAPM, PVWatts (`pdc0`, `gamma_pdc`) | `dc_model` + parameter dict (pvlib key sets, §1.4) | PVWatts when only datasheet Pmax and γ are known |
| DC array | modules per string, strings, mismatch %, DC wiring %, LID %, module quality % | `modules_per_string`, `strings`, `losses.*` | PVsyst order (§1.2) |
| Inverter | Sandia (C0–C3), ADR, PVWatts (`pdc0`, `eta_inv_nom`), OND curves | `ac_model` + parameters, `pac_max` (clipping), night consumption | PVWatts η 96 % |
| AC side | AC wiring %, transformer, availability % | `losses.*` | — |
| Degradation | %/year, first-year LID | `degradation_pct_per_year`, `lid_pct` | 0.3–0.5 %/year |
| Aggregate losses | PVGIS `loss` 14 %, PVWatts `losses` | single `system_loss_pct` for quick profiles | 14 % (PVGIS) |

To reproduce a PV*SOL or PVsyst result within a few percent, the minimum set is: the **same weather series** (source, period, time convention), orientation and horizon, transposition model, temperature model and its coefficients, DC model parameters (or the PAN), inverter parameters (or the OND), the loss list in order, and degradation year. Everything else is second order.

---

## 5. What it means for a `solar` module of Nexgen OS

The core already provides what solar needs as foundations: `surfaces` (azimuth north-clockwise, tilt), `devices` with `derive_devices`, `series` with `kind` `measured|simulated|forecast` and `value_kind`, `sources` with licence and retention, `connections`, and `record_run()` (decision 0004). The `modules/README.md` lists PV systems under `energy`; the tables below can live in that schema or in a `solar` schema split from it — the shape is the same.

### 5.1 Objects

| Table | Key columns | Why |
|---|---|---|
| `solar.pv_systems` (derived from `devices`) | `kwp_dc`, `kva_ac`, `grid_connection`, `commissioned_on`, `degradation_pct_per_year`, `lid_pct` | the device a bank, an owner or a monitoring platform names (Orange Button `PVSystem`) |
| `solar.pv_arrays` | `pv_system_id`, `surface_id`, `azimuth_deg`, `tilt_deg` (copied from the surface, overridable for racks), `mounting` (`open_rack|roof_parallel|semi_integrated|insulated|floating|tracker`), `module_count`, `modules_per_string`, `strings`, `module_product_id`, `inverter_product_id`, `gcr`, `bifaciality`, `layout geometry` | the "module group" every tool has (pvlib `Array`, OpenSolar `module_groups`, PVsyst orientation, OB `PVArray`) |
| `solar.module_products` / `solar.inverter_products` (or rows of the core `device_directory`) | manufacturer, model, `pmax_w`, `gamma_pdc`, `model` (`pvsyst|cec|sapm|pvwatts` / `sandia|adr|pvwatts|ond`), `parameters jsonb` in pvlib key names, `source_document_id` (the PAN/OND/datasheet) | one parameter set per product, self-describing like pvlib's inference |
| `solar.horizons` (or an attribute on site/surface) | `profile jsonb` of (azimuth north-clockwise, elevation), `source` (`pvgis_dem|survey|pvsyst|meteonorm`) | one horizon, many runs |
| `solar.yield_profiles` | `name`, `decomposition_model`, `transposition_model`, `iam_model`, `temperature_model` + params, `spectral_model`, `losses jsonb` (ordered list: `soiling`, `mismatch`, `dc_wiring`, `module_quality`, `lid`, `ac_wiring`, `availability`…), `albedo` | named presets: `pvgis_like`, `pvsol_like`, `pvsyst_like`, `pvwatts`; a run says which it used |

### 5.2 Series and runs

- Weather lands as core `series` on the site (or a shared grid point) with `source_code` = `pvgis_sarah3`, `pvgis_era5`, `open_meteo_era5`, `meteonorm`, `solargis`, `own_station`; quantities `ghi`, `dni`, `dhi`, `poa_global`, `temp_air`, `wind_speed` (+ height attribute), `albedo`; always interval-start UTC. A TMY is a `simulated` series with a reference year flagged as typical, not a real year.
- A yield run (`record_run`) takes: pv_system id, yield profile, weather series ids + period, horizon, engine and version (`pvlib 0.16.1`, `pvgis 5.3 PVcalc`, `sam 2026.7.3`), and returns `simulated` series on the system and arrays: `poa_global`, `temp_cell`, `p_dc`, `p_ac`/energy, plus a summary (annual kWh, specific yield kWh/kWp, PR = E / (H_poa × kWp), loss waterfall in PVsyst order, P50, P90 with σ components).
- Measured production stays `measured` on the meter/inverter; IEC 61724-1 metrics (Yr, Yf, PR, temperature-corrected PR, energy performance index = measured / expected yield) are computed by comparing the two, with RdTools-style degradation and soiling as later engines.

### 5.3 Formats to read and write

| Direction | Formats |
|---|---|
| Read (connectors / format libraries) | PVGIS API (seriescalc, tmy, printhorizon), Open-Meteo, EPW, TMY3, PVsyst hourly CSV and `.MET`-compatible CSV, PV*SOL CSV, PAN, OND (port of pvlib `read_panond` logic), OpenSolar `systems/details`, Google Solar roof segments (already in 0008 as cache), SunSpec models 1/101/103/160/201/203/302 for live data |
| Write | EPW and PVsyst-standard CSV of the weather series used (so a PVsyst/PV*SOL user can rerun the same weather), SAM/PySAM JSON of a run, pvlib-shaped JSON of a system, hourly CSV of results with pvlib variable names, Orange Button-shaped JSON for `Site`/`PVSystem`/`EnergyModel` exchanges |
| Never write | PVsyst `.PRJ`/`.VCi`, PV*SOL project files (proprietary, unsupported) |

### 5.4 What to leave to the tools

- 3D near-shading ray tracing, detailed string layout, cable sizing, bankable reports: PVsyst, PV*SOL, HelioScope remain the reference; Nexgen stores their outputs (PDF report as document, hourly CSV as a `simulated` run with `engine = 'pvsyst 8.1'`) and the inputs needed to explain gaps.
- Licensed weather (Meteonorm, Solargis) is fetched by Nexgen, WeSmart's commercial platform, under its licence; the open core ships only open sources (PVGIS, Open-Meteo under its terms, NSRDB) and the formats.
- Engines run outside Postgres (pvlib in a worker, PVGIS by API); the database holds parameters, series, runs and their lineage.

### Borrow / Avoid / Lesson

- **Borrow:** pvlib variable names and parameter key sets; PVsyst loss order and Uc/Uv table; PVGIS API as the free default weather + quick yield; EPW as the weather exchange file; Orange Button names as a mapping vocabulary.
- **Avoid:** storing azimuth in more than one convention; storing a single "system loss %" as the only loss model; mixing interval-start and interval-end series; treating a TMY as a measured year; reverse-engineering proprietary project files.
- **Lesson:** comparability with PV*SOL and PVsyst comes from carrying the weather source, time convention and model choices as named inputs of every run, not from cloning their engines.

---

### Source list (all read 13/10/2026)

PVsyst 8.1 help (meteo database, import, time shift, provider comparison, one-diode model, module and inverter dialogs, inverter efficiency and limits, thermal U-values, losses, loss diagram, ageing, P50-P90, hourly CSV, variables, horizon import, plane azimuth, workspace, file format) and PVsystCLI reference and licensing · PVsyst 7 meteonote 5 (search snippet) · Valentin PV*SOL premium product page, API page, help (irradiation, diffuse, module temperature, PAN import, export) · PySAM docs (index, versions, SSC modules, helper tools, inputs from SAM, Pvwattsv8) · SAM download page · PySAM releases · PVWatts v8 API · pvlib 0.16.1 (ModelChain guide and API, PVSystem, Array, FixedMount, nomenclature, iotools, pvsyst_cell, faiman, read_tmy3) · PVPMC modeling guide · RdTools docs and repo · HelioScope sim-solutions page and help-centre snippets · OpenSolar developer docs (systems, system details) · SMA Sunny Design product page and eManual · PVGIS API, user manual, data sources and methods, live seriescalc call · Open-Meteo forecast, historical, satellite docs, licence, terms · Meteonorm Climate, mn8 notice, API docs, TMY overview, what's new · Solargis home, KB (TMY, API, PVsyst data, performance indicators) · EnergyPlus 26.1 auxiliary programs (EPW) · NREL TMY3 manual (front matter) · IEC webstore 61724-1, 62446-1; 61853-3/-4 previews · SunSpec models repo (model JSON labels) · Orange Button GitHub org and ob-openapi-taxonomy.
