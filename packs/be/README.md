# Pack `be` — Belgium

The values Belgium decides that a function of the model reads, compiled by
`nexgen-os pack build be` into
[`supabase/seed/11_pack_be.sql`](../../supabase/seed/11_pack_be.sql).
Version 0.3.0, certification `community`: checked by the toolchain, read by
no Belgian professional yet. Installing it needs the `grid` module. Nothing
here is code or law in words.

Belgium decides most things per region: Flanders (`BE-VLG`), Brussels
(`BE-BRU`) and Wallonia (`BE-WAL`) each keep their own address register,
building identifiers and distribution operators. A row that holds in part of
the country names its regions, and the geocoders return the region of each
place they find ([decision 0009](../../docs/decisions/0009-what-applies-follows-the-region.md)).
The three regional registers answer as geocoders in the connectors
[`geopunt`](../../packages/connectors/geopunt/README.md) for `BE-VLG`,
[`urbis`](../../packages/connectors/urbis/README.md) for `BE-BRU` and
[`icar`](../../packages/connectors/icar/README.md) for `BE-WAL`, keyed by
region in the `national` choice of `geocoderFor()`.

| File | Holds |
|---|---|
| `pack.json` | Belgium, the euro, Dutch, French and German, `Europe/Brussels`, four-digit postal codes, municipalities numbered by `nis`; the three regions of ISO 3166-2 at the region level `region` |
| `identifiers.json` | `nis` (the 5-digit municipality code of Statbel), `vlaanderen_address` and `vlaanderen_building` (Flanders), `urbis_building` (Brussels), `icar_address` (Wallonia, which keeps no building register), `enterprise_number` (KBO / BCE), each with a pattern and an example that matches it. A Belgian metering point, the 18-digit EAN of an energy bill (prefix `54`), is a GS1 Global Service Relation Number: it uses the core scheme `gs1_gsrn`, and the pack adds none of its own |
| `sources.json` | nine registers and services: `geopunt` (`BE-VLG`, `BE-BRU`), `basisregisters_vlaanderen` (`BE-VLG`), `urbis` (`BE-BRU`), `icar` (`BE-WAL`, `redistributable` false: its terms of use are still being drafted), `rmi_aws`, `statbel`, `kbo_bce`, `fluvius_open_data`, `elia_open_data`; and the seven published texts (`kind` `text`, code `be_…`) a value of the pack cites, nothing else |
| `grid.json` | eight operators: Elia (transmission, the whole country), Fluvius (`BE-VLG`), Sibelga (`BE-BRU`), and in Wallonia, where each municipality is served by the operator it designated, ORES, RESA, AIEG, AIESH and REW. Every distribution operator issues GSRN metering points |
| `defaults.json` | the values below, each with its source, its reference and its period |

## The defaults

| Property | Value | Source |
|---|---|---|
| `metering_step` | `PT15M` in each region (a digital or communicating meter), one row per region | Fluvius, Sibelga and ORES, each on its own page |
| `bidding_zone` | `10YBE----------2` | ENTSO-E list of EIC codes |
| `energy_price_household` | 156.4 €/MWh (2024), 154.1 €/MWh (2025), band 2 500–4 999 kWh, energy and supply | Eurostat `nrg_pc_204_c` |
| `energy_price_business` | 110.8 €/MWh (2024), 102.5 €/MWh (2025), band 2 000–19 999 MWh | Eurostat `nrg_pc_205_c` |
| `grid_fees_and_taxes` | 176.9 €/MWh (2024), 199.5 €/MWh (2025): network costs and taxes of the household band, VAT excluded; a national mean | Eurostat `nrg_pc_204_c` |
| `vat_rate_electricity` | 0.06 from 1 April 2023, for a private customer | FPS Finance, "Uw energiefactuur" |

A yearly statistic holds from the first day of its year; the latest one
stays open until the next is published, which closes it. A value whose
document gives no date (the metering step, the bidding zone) starts on the
day it was read, 20 October 2026.

## What the pack does not hold

The law is not part of the model: no legal text and no rule is in the
pack, and the steps of a project, in any region, are the generic templates
of the [`planning`](../../modules/planning/README.md) module. Regional steps
(a planning exemption, the authorisation of an energy community by a
regional regulator) belong to an installation's own templates.

## What to check next

- **Voltage levels** (`voltage_levels`) and the connection thresholds
  (`connection_max_power_lv`, `connection_max_power_mv`): the consolidated
  text of the electrical regulation (AREI, Livre 1) and the Synergrid
  prescription C10/11 could not be read when this pack was written.
- **Energy sharing** (`sharing_max_distance_m`, `sharing_max_power_kw`,
  `sharing_settlement_period`): the perimeter is a regional rule and is not a
  distance. In Wallonia a renewable energy community is limited by proximity
  (downstream of the same high-voltage substation) and a citizen energy
  community can cover the region (CWaPE); Brussels allows sharing in the
  Region; Flanders was not found stated on the pages read. To be read on the
  decrees and the regulators' pages.
- **`injection_price_reference`** (yearly mean day-ahead price of the Belgian
  bidding zone) and **`grid_co2_factor`**: no complete official yearly figure
  could be read. Elia's open dataset `ods192` holds the CO2 intensity of
  consumption but was incomplete for 2024 and 2025 when read; third-party
  sites give about 70 €/MWh (2024) and 83 €/MWh (2025) for the price.
- **`pv_specific_yield_fallback`**: no official page gives a national mean in
  kWh/kWp.
- **`offpeak_hours`**: it depends on the supplier and the tariff; no
  single national window.
- **Network costs by region**: Eurostat gives a national mean; the three
  regulators (VREG, Brugel, CWaPE) publish the tariffs of each operator.
- **VAT**: 0.06 is the rate for a private customer; the rate for a business
  is not stated on the page read.
- The metering step of the other Walloon operators (RESA, AIEG, AIESH, REW),
  and the municipalities each Walloon operator serves (the pack names the
  region, not the municipality list).
- The data hubs of ORES and Sibelga, and the licence of the KBO / BCE data.
- The NIS code of a Flemish or Brussels place: neither Geopunt nor UrbIS
  gives it.
- The licences marked "not verified" (`icar`, `rmi_aws`) and "Terms not
  stated" (the published texts).

Figures read on 20 October 2026 on the publishers' pages.
