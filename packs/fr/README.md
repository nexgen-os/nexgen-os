# Pack `fr` — France

The values France decides that a function of the model reads, compiled by
`nexgen-os pack build fr` into
[`supabase/seed/10_pack_fr.sql`](../../supabase/seed/10_pack_fr.sql).
Version 0.4.0, certification `community`: checked by the toolchain, read by
no French professional yet. Installing it needs the `grid` module. Nothing
here is code or law in words; the national address register answers in
[`packages/connectors/ban`](../../packages/connectors/ban/README.md).

| File | Holds |
|---|---|
| `pack.json` | France, the euro, French, six time zones (`Europe/Paris` first, then Guadeloupe, Martinique, French Guiana, Réunion and Mayotte), five-digit postal codes, municipalities numbered by `insee`; 116 regions of ISO 3166-2: the 13 metropolitan regions, and at the region level `department` the 101 departments with the collectivities ISO lists beside them (`FR-6AE` Alsace above `FR-67` and `FR-68`, `FR-69M` Métropole de Lyon, `FR-75C` Paris), each with its parent; the five overseas departments carry their own time zone |
| `identifiers.json` | `prm` (the 14-digit metering point), `insee` (the municipality code, Corsica's `2A`/`2B` included), `ban_address`, `siren` (ISO 6523 code `0002`), `siret` (`0009`, the party scheme of Ekwo OS's pack for France), `parcelle`, `rnb_id`, each with a pattern and an example that matches it |
| `sources.json` | ten registers and services: `ban`, `geo_api_gouv`, `insee_cog`, `cadastre`, `bd_topo`, `rnb`, `sirene`, `enedis_open_data`, `enedis_data_connect` (a customer's meter data, under mandate, never passed on), `odre`; the INSEE density grid `fr_insee_density_grid`; and the published texts (`kind` `text`, code `fr_…`) a value or a frame of the pack cites, nothing else |
| `project_kinds.json` | the two frames of the Code de l'énergie: `fr_acc`, autoconsommation collective (L315-2, refining `collective_self_consumption`), and `fr_aci`, autoconsommation individuelle (L315-1, refining `individual_self_consumption`) |
| `municipalities.json` | eighteen municipalities of the Code officiel géographique, each under its department, with its class of the INSEE density grid (seven classes, `large_urban_centre` to `rural_very_dispersed`): Paris, Lyon, Marseille, Lille, Grenoble, and in the Ain, Lozère and Puy-de-Dôme two or three of every class. A representative subset: the full list (about 35 000 municipalities) is the same file at full length, or a connector writing the same `regions` and `density_class` rows from INSEE's grid |
| `grid.json` | nine operators: RTE, Enedis (about 95 % of the mainland), five local distribution companies with their department, EDF SEI (Corsica and four overseas departments) and Électricité de Mayotte; the voltage domains TBT, BT, HTA, HTB of the Code du travail |
| `defaults.json` | the values below, each with its source, its reference and its period |

## Which level decides what

In France `region` is the department; its ISO region is its parent.
`parameter_of()` reads a department's value first, then its region's, then
the country's ([0021](../../docs/decisions/0021-one-cascade-of-defaults.md)),
so a value a region decides is written once, on the region. Every default
below is national today. The table says at which level each kind of
decision is taken in France, for the values this pack may hold later; it
holds no value.

| Level | Carried as | Decides |
|---|---|---|
| Department | `region` of the participant's place (`FR-29`, `FR-75C`) | the RE2020 climate zone (H1a to H3); the procedures of the prefecture |
| Region | `parent` of the department (`FR-BRE`, `FR-IDF`) | regional support schemes; the regional plan (SRADDET, the regional scheme for planning, sustainable development and equality of territories); calls for projects |
| Municipality | `municipality` of the participant's place (its INSEE code), a `regions` row `FR-<insee>` when the pack lists it | the distribution operator (a local distribution company, or the national one); the local urban plan (PLU); the density class that sets the distance allowed between the participants of a collective self-consumption operation |

A municipality the pack lists is a region of kind `municipality` under its
department; its density class is a default of that row, and the perimeter
of a collective self-consumption reads it as a condition. A municipality
the pack does not list has no class, and the general rule (2 km) holds.

## The defaults

| Attribute type | Value | Source |
|---|---|---|
| `metering_step` | `PT30M` (a meter below 36 kVA) | Enedis, collection of load curves |
| `bidding_zone` | `10YFR-RTE------C`; null in Corsica and the overseas departments, which are not interconnected | ENTSO-E list of EIC codes; CRE, non-interconnected zones |
| `control_area` | `10YFR-RTE------C`; null in Corsica and the overseas departments, balanced by their own system operator | ENTSO-E list of EIC codes; CRE, non-interconnected zones |
| `imbalance_settlement_period` | `PT30M` until 31 December 2024, `PT15M` from 1 January 2025; null in the non-interconnected zones | CRE, délibération n° 2018-229 du 14 novembre 2018 (derogation until 1 January 2025) |
| `grid_co2_factor` | 0.020 kg CO2eq/kWh consumed, 2025, direct emissions | RTE, Bilan électrique 2025 |
| `market_co2_factor` | 0.02352 kg CO2/kWh, the residual mix of 2024 (direct emissions, for electricity disclosure) | Association of Issuing Bodies, European Residual Mixes 2024, Table 2, page 7 (final version of 11 August 2025) |
| `energy_price_household` | 152.3 €/MWh (2024), 108.8 €/MWh (2025), band 2 500–4 999 kWh, energy and supply | Eurostat `nrg_pc_204_c` |
| `energy_price_business` | 111.0 €/MWh (2024), 88.2 €/MWh (2025), band 2 000–19 999 MWh | Eurostat `nrg_pc_205_c` |
| `grid_fees_and_taxes` | 136.3 €/MWh (2024), 153.2 €/MWh (2025): network costs and taxes of the household band, VAT excluded | Eurostat `nrg_pc_204_c` |
| `injection_price_reference` | 58 €/MWh (2024), 61.1 €/MWh (2025): yearly mean day-ahead price | RTE, Bilan électrique 2024 and 2025 |
| `vat_rate_electricity` | 0.20 from 1 August 2025, subscription and energy alike, a ratio kept for simulation | BOFiP BOI-RES-TVA-000209 |
| `vat_code_electricity` | `FR-S-20` over the same period: the sale tax of Ekwo OS's pack for France (`taxes.json`) the rate above mirrors, which an invoice takes ([with Ekwo OS](../../docs/with-ekwo-os.md#one-source-on-a-shared-database)) | BOFiP BOI-RES-TVA-000209 |
| `offpeak_hours` | null: eight hours a day placed by the distribution operator per local area | CRE, questions and answers on peak and off-peak hours |
| `voltage_levels` | TBT ≤ 50 V, BT ≤ 1 kV, HTA ≤ 50 kV, HTB above | Code du travail, R. 4226-2 |
| `sharing_perimeter` | for a project `fr_acc`: `["max_distance_between_members"]`, the distance between the two participants furthest apart, read by `community.check_perimeter()` | Arrêté du 21 novembre 2019 as amended by the arrêté du 19 septembre 2023, article 1 |
| `sharing_max_distance_m` | for a project `fr_acc`: 2 000 m; 10 000 m by derogation when every participant is in a périurban municipality (`urban_belt`, `small_town`), 20 000 m in a rural one (`rural_town`, `rural_dispersed`, `rural_very_dispersed`), from 8 October 2023 | Arrêté du 21 novembre 2019 as amended by the arrêté du 19 septembre 2023 |
| `density_class` | the class of each listed municipality in the seven-level grid, 2025 edition | INSEE, grille communale de densité |
| `electricity_excise` | 30.85 €/MWh for a `residential` participant (category «ménages et assimilés»), 26.58 €/MWh for a `professional` one (category «PME»), from 1 February to 31 July 2026 | BOFiP BOI-RES-EAT-000240 |

A yearly statistic holds from the first day of its year; the latest one
stays open until the next is published, which closes it. A value whose
document gives no date (the metering step, the bidding zone) starts on the
day it was read, 20 October 2026.

## The market and support schemes (`grid.json`)

- **Transmission operator**: `rte`, kind `tso`, EIC `10XFR-RTE------Q`; `grid.market_of()` gives it with the zone, the control area and the settlement period.
- **Support scheme** `fr_purchase_obligation` (`feed_in_tariff`, open window), Code de l'énergie, articles L314-1 to L314-13: its negative-price rule from 16 February 2025 — an installation of 10 MW or more may be asked to stop or limit its production while prices are negative — under article 175 of loi n° 2025-127 du 14 février 2025, cited from the regulator's opinion (CRE, délibération n° 2025-186). The tariff is each contract's.

## Meter data (`grid.json`, `meter_data` of `enedis`)

How the hub of the main distribution operator publishes meter data, as data
its connectors read (`meterDataHub()` of `@nexgen-os/core`), from the
operator's R6X guide (source `fr_enedis_r6x_guide`):

- **who reads it**: `enedis_sge` (the operator's own web services, for a third
  party under contract), `switchgrid` (an intermediary, whose `sources` row
  ships with `@nexgen-os/switchgrid`), `enedis_data_connect`; each under the
  customer's mandate (`auth = 'mandate'`), not redistributable, kept only as
  long as the authorisation holds;
- **its time**: `Europe/Paris`, the legal time an R63 dates the start of its
  steps in, without an offset;
- **its quality letters**: B and R measured (0), E estimated (1), C corrected
  (2), D imported (100), H and P reconstructed at a clock change (101, 102),
  S, T, F and G outage (103 to 106), a step absent from a file missing (3),
  an index without a letter measured (0);
- **its limits**: 24 months of history; steps of 5 minutes for the larger
  connections (C1 to C4, P1 to P3), 10 to 60 minutes for the others (C5, P4).

The other operators' hubs (`es_reseaux`, the local distribution companies)
are not described yet: an intermediary serving `es_reseaux` is the first to
add, with its own time and letters once its files are read.

## What the pack does not hold

The law is not part of the model: no legal text is in the pack, and no rule
on the grid, energy sharing, town planning or meter data beyond the values a
function reads (a support scheme is the eligibility, the duration and the
dated negative-price threshold `grid.support_of()` reads, never its text),
and the steps of a project are the generic templates of the
[`actions`](../../modules/actions/README.md) module.

The time-of-use bands and seasons a bill of the country prints — peak and off-peak hours (`peak`, `offpeak`), with the seasons of the tariffs that name them (`winter`, `summer`) —
and the names of its taxes are not published yet: the
[`energy-bill`](../../packages/formats/energy-bill/README.md) library reads
them as codes its caller gives, and a pack section listing them, with their
hours, is the next step for a bill to be read with the country's own words.

## Golden cases

`golden/` holds one case per kind of project, each a scenario and the
figures an installation must find from it (`tests/golden.test.ts`,
[0034](../../docs/decisions/0034-a-pack-upgrade-is-never-silent.md)):

| Case | Kind | What it checks |
|---|---|---|
| `acc_dense` | `fr_acc` in Lyon | the 2 km of a large urban centre, the shares of a proportional key, the shared rate, savings and CO2 of the project at the country's values |
| `acc_rural` | `fr_acc` in Ain | the 20 km of rural municipalities by density class, a participant 23 km away out of the perimeter with the one it is furthest from |
| `aci_household_battery` | `fr_aci` | the excise of a residential segment, a battery's power at the generic C-rate of the `battery` module, self-consumption through a battery |
| `school_pv` | `pv_roof` in Grenoble | the excise of a public entity, the operator of FR-38 by region, a PVWatts yield within 0.1 %, specific yield and savings |
| `pv_farm_injection` | `other` | the reference price of injection, and the value of the energy injected hour by hour at a price series |

## What to check next

- **Who runs a meter**: a French PRM is a 14-digit number whose digits
  name no operator in any public text read (the operators' and the
  regulator's pages describe its length, not a prefix per operator), so no
  `identifier_prefixes` is loaded; `grid.json` lists no region for `enedis`, so a meter not connected to its operator is not
  resolved (`grid_operator_not_found`, case `acc_dense`); the territories of
  the local distribution companies are their departments, not their
  municipalities.
- **Specific yield of PV** (`pv_specific_yield_fallback`) and full-load
  hours of wind: no official page gives a national mean in kWh/kWp; RTE
  publishes load factors (solar 12.8 % in 2024 and 13.6 % in 2025, onshore
  wind 21.8 % and 21.4 %), which are not the attribute type's quantity.
- **Energy sharing**: the 5 MW ceiling (`sharing_max_power_kw`) since the
  order of 21 February 2025 amending the order of 21 November 2019 (0.5 MW
  in the non-interconnected zones), and whether that order also moved the
  distances, to be read on the consolidated text on Légifrance, which could
  not be opened when this pack was written; the distances are those of the
  2023 amendment, as the professional guide of the photovoltaic sector
  states them, and the Légifrance identifier of the order is to be confirmed.
- **Excise on electricity** (`electricity_excise`): the categories of the
  law follow the subscribed power (up to 36 kVA, up to 250 kVA, above), which
  the pack approximates by the segment; the rate of a household before the
  increase of February 2026 (25.19 €/MWh, the figure the platform this core
  was taken from uses) differs from the rate after it (30.85 €/MWh, kept
  here); the rates from 1 August 2026 differ between the sources read and
  are not loaded: `parameter_of()` answers `parameter_missing` after
  31 July 2026 until they are.
- The day from which the 30-minute step and the bidding zone hold, from a
  dated text.
- **Support schemes**: the per-technology thresholds the orders applying article 175 set (orders of 8 September 2025 and of 22 December 2025, as amended), read on Légifrance before they are loaded; the article itself, whose 10 MW floor is cited here from the regulator's opinion (Légifrance refused an automated reading of the law of finances for 2025 when this pack was revised, on 22 October 2026: the primary text is still to be read by a person); the *complément de rémunération* (`contract_for_difference`) and its tenders, with their own negative-price rules.
- `grid_co2_factor` for 2024 at the consumption boundary; ADEME's Base
  Empreinte gives 0.0519 kg CO2e/kWh for 2024, life-cycle and smoothed over
  four years, a different quantity.
- Grid fees and energy prices by consumer band for businesses, and the
  bands themselves as properties, once a module reads them.
- The local distribution companies beyond the five largest, and the
  identifier scheme of Électricité de Mayotte's metering points.
- The licences of the published texts marked "Terms not stated".
- Saint-Barthélemy, Saint-Martin, Saint-Pierre-et-Miquelon, New Caledonia,
  French Polynesia, Wallis and Futuna, the southern lands and Clipperton
  have their own ISO 3166-1 codes and are not regions of this pack.

Figures read on 20 October 2026 on the publishers' pages.
