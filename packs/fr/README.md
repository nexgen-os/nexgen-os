# Pack `fr` — France

The values France decides that a function of the model reads, compiled by
`nexgen-os pack build fr` into
[`core/seed/10_pack_fr.sql`](../../core/seed/10_pack_fr.sql).
Version 0.3.0, certification `community`: checked by the toolchain, read by
no French professional yet. Installing it needs the `grid` module. Nothing
here is code or law in words; the national address register answers in
[`packages/connectors/ban`](../../packages/connectors/ban/README.md).

| File | Holds |
|---|---|
| `pack.json` | France, the euro, French, six time zones (`Europe/Paris` first, then Guadeloupe, Martinique, French Guiana, Réunion and Mayotte), five-digit postal codes, municipalities numbered by `insee`; 116 regions of ISO 3166-2: the 13 metropolitan regions, and at the region level `department` the 101 departments with the collectivities ISO lists beside them (`FR-6AE` Alsace above `FR-67` and `FR-68`, `FR-69M` Métropole de Lyon, `FR-75C` Paris), each with its parent; the five overseas departments carry their own time zone |
| `identifiers.json` | `prm` (the 14-digit metering point), `insee` (the municipality code, Corsica's `2A`/`2B` included), `ban_address`, `siren`, `siret`, `parcelle`, `rnb_id`, each with a pattern and an example that matches it |
| `sources.json` | ten registers and services: `ban`, `geo_api_gouv`, `insee_cog`, `cadastre`, `bd_topo`, `rnb`, `sirene`, `enedis_open_data`, `enedis_data_connect` (a customer's meter data, under mandate, never passed on), `odre`; and the ten published texts (`kind` `text`, code `fr_…`) a value of the pack cites, nothing else |
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
| Municipality | the `insee` identifier of the participant's place | the distribution operator (a local distribution company, or the national one); the local urban plan (PLU); the urban or rural density class that sets the distance allowed between the participants of a collective self-consumption operation |

A municipality is not a region of this pack: what it decides would be read
through its INSEE code, by the module that needs it.

## The defaults

| Property | Value | Source |
|---|---|---|
| `metering_step` | `PT30M` (a meter below 36 kVA) | Enedis, collection of load curves |
| `bidding_zone` | `10YFR-RTE------C`; null in Corsica and the overseas departments, which are not interconnected | ENTSO-E list of EIC codes; CRE, non-interconnected zones |
| `grid_co2_factor` | 0.020 kg CO2eq/kWh consumed, 2025, direct emissions | RTE, Bilan électrique 2025 |
| `energy_price_household` | 152.3 €/MWh (2024), 108.8 €/MWh (2025), band 2 500–4 999 kWh, energy and supply | Eurostat `nrg_pc_204_c` |
| `energy_price_business` | 111.0 €/MWh (2024), 88.2 €/MWh (2025), band 2 000–19 999 MWh | Eurostat `nrg_pc_205_c` |
| `grid_fees_and_taxes` | 136.3 €/MWh (2024), 153.2 €/MWh (2025): network costs and taxes of the household band, VAT excluded | Eurostat `nrg_pc_204_c` |
| `injection_price_reference` | 58 €/MWh (2024), 61.1 €/MWh (2025): yearly mean day-ahead price | RTE, Bilan électrique 2024 and 2025 |
| `vat_rate_electricity` | 0.20 from 1 August 2025, subscription and energy alike | BOFiP BOI-RES-TVA-000209 |
| `offpeak_hours` | null: eight hours a day placed by the distribution operator per local area | CRE, questions and answers on peak and off-peak hours |
| `voltage_levels` | TBT ≤ 50 V, BT ≤ 1 kV, HTA ≤ 50 kV, HTB above | Code du travail, R. 4226-2 |

A yearly statistic holds from the first day of its year; the latest one
stays open until the next is published, which closes it. A value whose
document gives no date (the metering step, the bidding zone) starts on the
day it was read, 20 October 2026.

## What the pack does not hold

The law is not part of the model: no legal text and no rule on the grid,
energy sharing, planning, support schemes or meter data is in the pack,
and the steps of a project are the generic templates of the
[`planning`](../../modules/planning/README.md) module.

## What to check next

- **Specific yield of PV** (`pv_specific_yield_fallback`) and full-load
  hours of wind: no official page gives a national mean in kWh/kWp; RTE
  publishes load factors (solar 12.8 % in 2024 and 13.6 % in 2025, onshore
  wind 21.8 % and 21.4 %), which are not the property's quantity.
- **Energy sharing** (`sharing_max_distance_m`, `sharing_max_power_kw`): 2 km
  and 5 MW since the order of 21 February 2025 amending the order of
  21 November 2019 (0.5 MW in the non-interconnected zones), to be read on
  the consolidated text on Légifrance, which could not be opened when this
  pack was written; the day the 5 MW ceiling starts with it.
- The day from which the 30-minute step and the bidding zone hold, from a
  dated text.
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
