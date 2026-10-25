# Pack `es` — Spain

The values Spain decides that a function of the model reads, compiled by
`nexgen-os pack build es` into
[`supabase/seed/12_pack_es.sql`](../../supabase/seed/12_pack_es.sql).
Version 0.4.0, certification `community`: checked by the toolchain, read by
no Spanish professional yet. Installing it needs the `grid` module. Nothing
here is code or law in words; no connector of this repository reads a
Spanish register yet, and an address is found by the open geocoders of the
core's chain.

| File | Holds |
|---|---|
| `pack.json` | Spain, the euro, Spanish, Catalan, Basque and Galician (official in their communities), two time zones (`Europe/Madrid` first, `Atlantic/Canary` for the Canary Islands, `ES-CN` and its provinces `ES-GC` and `ES-TF`), five-digit postal codes starting with a province number from 01 to 52, municipalities numbered by `ine`; 69 regions of ISO 3166-2: at the region level `province` the 50 provinces, each under its autonomous community, the 17 communities, and the autonomous cities of Ceuta (`ES-CE`) and Melilla (`ES-ML`), which have no province |
| `identifiers.json` | `cups` (the supply point, with its control letters and the optional boundary or measuring point suffix), `ine` (the municipality code), `nif` (the tax number of a legal entity), `referencia_catastral` (a parcel in 14 characters, a property in 20), each with a pattern and an example that matches it |
| `sources.json` | five registers and services: `ine_municipalities`, `catastro`, `cartociudad`, `datadis` (the distributors' platform of a customer's meter data, under the customer's authorisation, never passed on), `ree_esios`; and the published texts (`kind` `text`, code `es_…`) a value, a frame, a scheme or an operator of the pack cites |
| `project_kinds.json` | the frames of Spanish law: `es_autoconsumo_individual` and `es_autoconsumo_colectivo` (Real Decreto 244/2019, articles 3 m) and 4.3), refining `individual_self_consumption` and `collective_self_consumption`; `es_comunidad_energias_renovables` and `es_comunidad_ciudadana_energia` (Ley 24/2013, article 6.1 j) and k), articles 12 bis and 12 ter), refining `energy_community` |
| `municipalities.json` | seventeen municipalities of the INE register of 1 January 2026, each under its province: the largest cities, Palma and Las Palmas de Gran Canaria, Ceuta and Melilla, and Soria, Ólvega and Teruel. A representative subset: the full list (8 132 municipalities in the 2026 file) is the same file at full length, built from the INE's yearly file by joining the province code and the municipality code (`CPRO` + `CMUN`, without the control digit `DC`), or a connector writing the same `regions` rows. Spain publishes no density class a rule of the pack reads |
| `grid.json` | twelve operators: Red Eléctrica (transmission and system operation), the five largest distribution operators and five local ones, each with the CUPS prefix the transmission operator's list gives it, and the operators of Ceuta and Melilla with their city; the voltage categories of Real Decreto 223/2008 |
| `defaults.json` | the values below, each with its source, its reference and its period |

## Which level decides what

In Spain `region` is the province; its autonomous community is its parent.
`parameter_of()` reads a province's value first, then its community's, then
the country's ([0021](../../docs/decisions/0021-one-cascade-of-defaults.md)),
so a value a community decides is written once, on the community (the VAT
of the Canary Islands is written on `ES-CN`).

| Level | Carried as | Decides |
|---|---|---|
| Province | `region` of the participant's place (`ES-SO`, `ES-GC`) | little the pack reads; the provinces carry the postal codes and the INE codes |
| Autonomous community or city | `parent` of the province (`ES-CL`, `ES-CN`), or the region itself for Ceuta and Melilla | the register of self-consumption installations, the authorisation of installations, regional support; the indirect tax of the Canary Islands |
| Municipality | `municipality` of the participant's place (its INE code), a `regions` row `ES-<ine>` when the pack lists it | building and works permits |

## The defaults

| Attribute type | Value | Source |
|---|---|---|
| `bidding_zone`, `control_area` | `10YES-REE------0` for the whole country, the one area code the list gives both functions | ENTSO-E list of EIC codes |
| `energy_price_household` | 110.8 €/MWh (2024), 110.8 €/MWh (2025), band 2 500–4 999 kWh, energy and supply | Eurostat `nrg_pc_204_c` |
| `energy_price_business` | 93.5 €/MWh (2024), 90.9 €/MWh (2025), band 2 000–19 999 MWh | Eurostat `nrg_pc_205_c` |
| `grid_fees_and_taxes` | 127.5 €/MWh (2024), 153.0 €/MWh (2025): network costs and taxes of the household band, VAT excluded | Eurostat `nrg_pc_204_c` |
| `vat_rate_electricity` | 0.21 from 1 January 2025 to 21 March 2026; null in the Canary Islands, Ceuta and Melilla, outside the territory of VAT | Ley 37/1992, articles 90 and 3 |
| `offpeak_hours` | null for the country (the periods follow the access tariff); `[["00:00", "08:00"]]` for a `residential` participant: period 3 of the 2.0 TD tariff on working days, every hour of weekends, 6 January and fixed national holidays being period 3 too | CNMC Circular 3/2020, article 7.3 |
| `voltage_levels` | low voltage up to 1 kV; high voltage of the third category up to 30 kV, second up to 66 kV, first below 220 kV, special from 220 kV | Real Decreto 223/2008, article 3 |
| `sharing_perimeter` | for a project `es_autoconsumo_colectivo`: `["same_substation", "radius_around_producer"]`, from 22 March 2026 — connected to a low-voltage network of the same transformer station, or within the radius of the producer | Real Decreto 244/2019, article 3 g), ii) and iii), as amended by the Real Decreto-ley 7/2026 |
| `sharing_radius_m` | for a project `es_autoconsumo_colectivo`: 500 m between the metering equipment; 5 000 m asked from a `solar` or `wind` device of the project, for an installation of up to 5 MW connected through the grid | the same article, iii), both paragraphs |
| `sharing_settlement_period` | `PT1H` for a project `es_autoconsumo_colectivo`: the allocation coefficients are hourly | Real Decreto 244/2019, annex I.1 |

A yearly statistic holds from the first day of its year; the latest one
stays open until the next is published, which closes it. A value whose
document gives no date (the bidding zone) starts on the day it was read,
22 October 2026. A rule of a text starts on the day the wording loaded came
into force.

## Collective self-consumption

Real Decreto 244/2019 lets a production installation serve consumers
through the grid when one of four conditions holds (article 3 g), in the
wording of the Real Decreto-ley 7/2026, convalidated by the Congress on
26 March 2026):

| Condition of the text | In the model |
|---|---|
| i. connected to the consumers' internal network or by a direct line | not a sharing through the grid: no criterion |
| ii. connected to a low-voltage network fed from the same transformer station | `same_substation`: the transformer station is a `grid.substations` row, the meter says which one it is downstream of (`grid.connect_to_operator`) |
| iii. within 500 m of the associated consumers, between the metering equipment in orthogonal projection | `radius_around_producer` with `sharing_radius_m` = 500 |
| iii, second paragraph. a photovoltaic or wind installation of up to 5 MW through the transmission or distribution lines, within 5 000 m | `sharing_radius_m` = 5 000 for a project `es_autoconsumo_colectivo` and a `solar` or `wind` device: said, not decided (below) |
| iv. generation and consumption on the same cadastral reference (its first 14 characters) | no criterion of the model yet |

`community.check_perimeter()` reads the radius from the places of the
participants, and a participant has no technology: it applies the 500 m.
The 5 000 m is a value of the device, which `parameter_of('device', …)`
gives with its condition, as Wallonia's 9 km of a wind turbine is in the
`be` pack; the 5 MW bound is in its reference, as no condition reads the
power of a device yet. The golden case `autoconsumo_colectivo_rural` shows a
participant 2.5 km from a 900 kW field, out by the rule the function applies
and in by the text.

## What the pack does not hold

The law is not part of the model: no legal text and no rule on the grid,
self-consumption, support schemes or meter data is in the pack, and the
steps of a project are the generic templates of the
[`actions`](../../modules/actions/README.md) module (a Spanish roof
installation plans its nine generic steps). The Spanish steps — the
certificate of the installation (CIE) and its legalisation with the
community, the inscription in the community's register of self-consumption
(Real Decreto 244/2019, article 19 and annex II), the access contract, the
allocation agreement signed by every participant and notified to the
distribution operator (article 4.3 and annex I) — belong to an
installation's own templates, each citing its community's procedure.

## Golden cases

`golden/` holds one case per kind of project, each a scenario and the
figures an installation must find from it (`tests/golden.test.ts`,
[0034](../../docs/decisions/0034-a-pack-upgrade-is-never-silent.md)):

| Case | Kind | What it checks |
|---|---|---|
| `autoconsumo_colectivo_madrid` | `es_autoconsumo_colectivo` in Madrid | a flat in by its transformer station at 700 m, a bakery in by the 500 m on another station, an office out by both; the 5 000 m of the PV device; the 2.0 TD off-peak window of a household and none for a business; VAT in 2025 and refused after 21 March 2026; the shares of a proportional key, the shared rate and the savings |
| `autoconsumo_colectivo_rural` | `es_autoconsumo_colectivo` in Ólvega (Soria) | a cooperative in at 450 m, a school out at 2.5 km by the 500 m the function applies; the rule refused before 22 March 2026 |
| `household_surplus` | `es_autoconsumo_individual` in València | the operator of a meter found by its CUPS prefix, the household price, the off-peak window, self-consumption of a house with surplus |
| `sme_canarias` | `pv_roof` in Las Palmas de Gran Canaria | VAT not decided in the Canary Islands, the business price, the operator by CUPS prefix, the savings of a workshop |

## What to check next

- **VAT from 22 March 2026**: the Real Decreto-ley 7/2026, article 42 (as
  amended by the Real Decreto-ley 10/2026), sets 10 % until 30 June 2026 on
  the electricity of a contract up to 10 kW and of severely vulnerable
  customers, and ends it in June if the electricity CPI of April did not
  exceed that of April 2025 by more than 15 %. Whether that held is
  published by the INE and was not read: `parameter_of()` answers
  `parameter_missing` for VAT after 21 March 2026 until the rows are added.
  The temporary rates of 2021 to 2024 are not loaded either.
- **Excise on electricity** (impuesto especial sobre la electricidad): an
  ad valorem rate (0.5 % from 22 March to 30 June 2026 by the Real
  Decreto-ley 7/2026, article 40, under the same CPI clause; the general
  rate of the Ley 38/1992 was not read), with minimum amounts of 0.5 and
  1 €/MWh. `electricity_excise`
  is a price per MWh: the rate has no attribute type to land in, and is not
  loaded.
- **Simplified compensation of surplus** (article 4.2 a) and article 14 of
  Real Decreto 244/2019): renewable installations up to 100 kW, a
  compensation contract, no specific remuneration, the surplus valued at
  most at the energy taken in the billing period (a month at most). No
  attribute type holds these values, and no module computes the
  compensation yet.
- **The access tariffs' six periods** (P1–P6 of the 3.0 TD and 6.x TD
  tariffs, by season, type of day and electrical system: peninsula, Balearic
  Islands, Canary Islands, Ceuta, Melilla) and the three periods of the
  2.0 TD beyond its off-peak window: article 7 of Circular 3/2020 holds them,
  and the model has no attribute type for a calendar of periods. The
  off-peak window is given for the `residential` segment, which approximates
  the 2.0 TD tariff of most households.
- **Metering step** (`metering_step`): no text read states the step of the
  readings of each type of meter, so it is not loaded; the allocation of a
  collective self-consumption is hourly (`sharing_settlement_period`).
- **Emission factor and price of injection** (`grid_co2_factor`,
  `injection_price_reference`): the transmission operator's yearly report
  and the market operator's yearly mean day-ahead price were not read; the
  cases show the factor refused by name.
- **Imbalance settlement period**: the operator's procedures that set it
  were not read, so `grid.market_of()` gives none for a Spanish place.
- **Bidding zone and control area of the non-peninsular systems**: whether
  a value other than the country's applies in the Balearic and Canary Islands, Ceuta and
  Melilla, which the access tariffs already treat as systems of their own,
  was not read.
- **The perimeter before 22 March 2026**: the earlier wordings of
  article 3 g), iii) — the original text, then the amendments of the Real
  Decreto-ley 29/2021, 18/2022 and 20/2022, and of the Real Decreto-ley
  7/2025, repealed by the Congress on 22 July 2025 — are not loaded; a study of an operation before that day gets `parameter_missing`.
  The cadastral criterion (iv) needs a criterion of the core.
- **Energy communities**: the Real Decreto-ley 7/2026 (final provision 17)
  asks the Government for a decree regulating renewable and citizen energy
  communities; their proximity is not defined in metres by the act. No
  perimeter is loaded for them.
- **Who runs a meter**: the distribution operators are found by the CUPS
  prefix; their municipalities are not listed. A CUPS assigned before a
  merger keeps the code of the company that assigned it (procedure 10.8,
  4.1), and those codes, no longer in the transmission operator's list,
  are not loaded. The other local distribution operators of the list (327
  entries when read) are not loaded.
- **Datadis**: what a third party needs to read a customer's data (the
  authorisation on the platform), and how long the data may be kept
  (`retention_days`), were not read in its terms of use, so no operator
  carries `meter_data` yet: a meter connector has no Spanish hub to read.
- **The operators as market parties**: the list of area codes (Y) was read
  for the bidding zone; the list of party codes (X) was not, so no operator
  carries its `eic_code`.
- **The status of a value**: every value carries the default status,
  `published`, as in the `fr` and `be` packs: each is the figure its
  source publishes. Whether a yearly statistic (the prices of Eurostat)
  should say `estimated` is a question for the three packs at once.
- **Support schemes**: the régimen retributivo específico and the auctions
  of the régimen económico de energías renovables (Real Decreto 960/2020)
  have no attribute type in the model.
- **The Basque Country and Navarre** keep their own cadastres, with their
  own references; `catastro` covers the rest of the country.
- The licences marked "not verified" (`ine_municipalities`, `catastro`,
  `cartociudad`, `datadis`, `ree_esios`, `es_ree_distributor_codes`) and
  "Terms not stated" (the published texts).

## Checked by

Nobody yet: the pack is `community`. A professional of the Spanish energy
sector who reads every value against its text is named here, with the day,
and the pack becomes `reviewed`.

Texts read on 22 October 2026 on the publishers' pages: the consolidated
texts of the BOE (Real Decreto 244/2019 in its version in force from
22 March 2026, Ley 24/2013 in its version of 30 June 2026, Real Decreto-ley
7/2026, Real Decreto-ley 8/2023, Ley 37/1992, Circular 3/2020 of the CNMC,
Real Decreto 223/2008, Orden EHA/451/2008, the resolution of
16 November 2009 approving procedure 10.8), the transmission operator's
list of distributor codes, the INE register of municipalities of
1 January 2026, the ENTSO-E list of EIC codes and Eurostat.
