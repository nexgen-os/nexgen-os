# Pack `be` — Belgium

The values Belgium decides that a function of the model reads, compiled by
`nexgen-os pack build be` into
[`supabase/seed/11_pack_be.sql`](../../supabase/seed/11_pack_be.sql).
Version 0.3.1, certification `community`: checked by the toolchain, read by
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
| `pack.json` | Belgium, the euro, French, Dutch and German (see below), `Europe/Brussels`, four-digit postal codes, municipalities numbered by `nis`; the three regions of ISO 3166-2 at the region level `region` |
| `identifiers.json` | `nis` (the 5-digit municipality code of Statbel), `vlaanderen_address` and `vlaanderen_building` (Flanders), `urbis_building` (Brussels), `icar_address` (Wallonia, which keeps no building register), `enterprise_number` (KBO / BCE, ISO 6523 code `0208`, the party scheme of Ekwo OS's pack for Belgium), each with a pattern and an example that matches it. A Belgian metering point, the 18-digit EAN of an energy bill (prefix `54`), is a GS1 Global Service Relation Number: it uses the core scheme `gs1_gsrn`, and the pack adds none of its own |
| `sources.json` | nine registers and services: `geopunt` (`BE-VLG`, `BE-BRU`), `basisregisters_vlaanderen` (`BE-VLG`), `urbis` (`BE-BRU`), `icar` (`BE-WAL`, `redistributable` false: its terms of use are still being drafted), `rmi_aws`, `statbel`, `kbo_bce`, `fluvius_open_data`, `elia_open_data`; and the eleven published texts (`kind` `text`, code `be_…`) a value or a frame of the pack cites, nothing else |
| `grid.json` | eight operators: Elia (transmission, the whole country), Fluvius (`BE-VLG`), Sibelga (`BE-BRU`), and in Wallonia, where each municipality is served by the operator it designated, ORES, RESA, AIEG, AIESH and REW. Every distribution operator issues GSRN metering points |
| `project_kinds.json` | the frames of the regional laws: `be_cer` (communauté d'énergie renouvelable) and `be_cec` (communauté d'énergie citoyenne) of the Walloon electricity decree, `be_cel` (communauté d'énergie locale) of the Brussels ordinance, each refining `energy_community`; `be_energy_sharing` (energiedelen, partage d'énergie) of the Flemish energy decree, refining `collective_self_consumption`. Each cites the definitions article of its text |
| `municipalities.json` | six municipalities of Statbel's REFNIS list under their region: Bruxelles, Antwerpen, Gent, Liège, Namur, Charleroi. A representative subset: the full list (565 municipalities) is the same file at full length, or a connector writing the same `regions` rows from Statbel's file. Belgium publishes no density class the pack reads |
| `defaults.json` | the values below, each with its source, its reference and its period |

## The languages

The three official languages are listed in the order of the four linguistic
regions of the Constitution (art. 4: the French-speaking region, the
Dutch-speaking region, bilingual Brussels-Capital, the German-speaking
region): `fr`, `nl`, `de` — the order Ekwo OS's pack for Belgium uses too, so
that both cores read the country alike on a shared database. Two things
differ, on purpose. Ekwo OS adds `en`, a language its invoices may be
written in; the energy pack lists the official languages only, and the
language a page or an agent speaks is the application's. And Ekwo OS names
`fr` its default language; Nexgen OS has none
([CONTRIBUTING](../../CONTRIBUTING.md)): the first of the list is an order,
not a choice made for the user, and a geocoder asks a register in the
language of the request first.

## The defaults

| Attribute type | Value | Source |
|---|---|---|
| `metering_step` | `PT15M` in each region (a digital or communicating meter), one row per region | Fluvius, Sibelga and ORES, each on its own page |
| `bidding_zone` | `10YBE----------2` | ENTSO-E list of EIC codes |
| `control_area` | `10YBE----------2` | ENTSO-E list of EIC codes |
| `imbalance_settlement_period` | `PT15M` | Elia open data, imbalance prices per quarter-hour |
| `energy_price_household` | 156.4 €/MWh (2024), 154.1 €/MWh (2025), band 2 500–4 999 kWh, energy and supply | Eurostat `nrg_pc_204_c` |
| `energy_price_business` | 110.8 €/MWh (2024), 102.5 €/MWh (2025), band 2 000–19 999 MWh | Eurostat `nrg_pc_205_c` |
| `grid_fees_and_taxes` | 176.9 €/MWh (2024), 199.5 €/MWh (2025): network costs and taxes of the household band, VAT excluded; a national mean | Eurostat `nrg_pc_204_c` |
| `vat_rate_electricity` | 0.06 from 1 April 2023, for a private customer, a ratio kept for simulation | FPS Finance, "Uw energiefactuur" |
| `vat_rate_electricity`, `vat_code_electricity` (`segment` `professional`) | 0.21 and `BE-S-21` from 1 April 2023: a contract with a company number is presumed professional unless the customer declares a mainly non-professional consumption, and keeps the normal rate | FPS Finance, circular 2023/C/64 |
| `vat_code_electricity` | `BE-S-06` over the same period: the sale tax of Ekwo OS's pack for Belgium (`taxes.json`) the rate above mirrors, which an invoice takes ([with Ekwo OS](../../docs/with-ekwo-os.md#one-source-on-a-shared-database)) | FPS Finance, "Uw energiefactuur" |
| `market_co2_factor` | 0.13173 kg CO2/kWh, the residual mix of 2024 (direct emissions, for electricity disclosure) | Association of Issuing Bodies, European Residual Mixes 2024, Table 2, page 7 (final version of 11 August 2025) |
| `injection_price_reference` | 70.2 €/MWh from 2024, the mean day-ahead price of the Belgian bidding zone, one zone for the three regions | CREG, annual report 2024 |

A yearly statistic holds from the first day of its year; the latest one
stays open until the next is published, which closes it. A value whose
document gives no date (the metering step, the bidding zone) starts on the
day it was read, 20 October 2026.

## What the pack does not hold

The law is not part of the model: no legal text and no rule is in the
pack, and the steps of a project, in any region, are the generic templates
of the [`actions`](../../modules/actions/README.md) module. Regional steps
(a planning exemption, the authorisation of an energy community by a
regional regulator) belong to an installation's own templates.

## Energy sharing in Wallonia

| Default | Value | Source |
|---|---|---|
| `sharing_perimeter` (`BE-WAL`, `be_cer`) | `["same_municipality", "same_substation"]`: the installations and the participants in one municipality, or all their connection points downstream of the same high-voltage substation of the local transmission operator | Arrêté du Gouvernement wallon du 17 mars 2023 relatif aux communautés d'énergie et au partage d'énergie, article 24 (`be_wal_energy_sharing_order`) |
| `sharing_municipality_extension_m` (`BE-WAL`, `be_cer`, `wind`) | 9 000 m: a wind turbine less than nine kilometres from the limit of its municipality extends the perimeter to the adjacent municipality | the same order, article 24, 1°, b) |

The order sets no distance in metres between participants; the "2 km" of
earlier readings is not in its text. Its `valid_from` is the date of the
order; the consolidated version read is the one in force from 26 February
2026. The limits of municipalities are not in the model, so an extension
is reported by `community.check_perimeter()`, not decided.

The time-of-use bands and seasons a bill of the country prints — day, night and exclusive night (`day`, `night`, `exclusive_night`) —
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
| `cer_wind_wallonia` | `be_cer` around Liège | the Walloon rule and the 9 km of a wind turbine, said and not decided for a participant of Namur |
| `cer_same_substation` | `be_cer` | a participant in by the substation it shares with the producer, another out |
| `sharing_brussels_building` | `be_energy_sharing` in Brussels | no perimeter decided for Brussels (`parameter_missing`), the operator of BE-BRU by region, the shares within a building |
| `household_pv_battery` | `individual_self_consumption` in Gent | the battery's figures from the generic level of the `storage` module, the household price and fees, self-consumption through a battery |
| `sme_pv` | `pv_roof` in Antwerpen | the business price, a PVWatts yield within 0.1 %, specific yield and savings |

## What to check next

- **Who runs a meter**: Sibelga publishes that every EAN code of the
  Brussels-Capital Region starts with `5414489` (its page "EAN code"), its
  `identifier_prefixes` in `grid.json`, and the case
  `sharing_brussels_building` finds it by prefix. No public page of Fluvius,
  ORES, RESA, AIEG, AIESH or REW, of Atrias or of a regulator gives the
  prefix of their codes: they are left out. Wallonia has five distribution
  operators listed by region only: a Walloon meter is resolved when it is
  connected to its operator.
- **Emission factor of grid electricity** (`grid_co2_factor`): no yearly
  figure is published by Elia, the CREG or a regional regulator; Elia's open
  dataset `ods192` gives the CO2 intensity of consumption quarter-hour by
  quarter-hour, and a yearly mean computed from it would be ours, not the
  publisher's. The cases show it refused by name.
- **Price of injection** (`injection_price_reference`): the CREG's yearly
  mean of the day-ahead market, one bidding zone for the whole country. The
  regional regulators (CWaPE, VREG, Brugel) publish no injection reference
  of their own: what a household is paid for its injection is its supplier's
  contract, an attribute of the participant.
- **Voltage levels** (`voltage_levels`) and the connection thresholds
  (`connection_max_power_lv`, `connection_max_power_mv`): the consolidated
  text of the electrical regulation (AREI, Livre 1) and the Synergrid
  prescription C10/11 could not be read when this pack was written.
- **Energy sharing** (`sharing_max_distance_m`, `sharing_max_power_kw`,
  `sharing_settlement_period`): the perimeter is a regional rule. Wallonia
  is loaded (below); Brussels allows sharing in the Region, and Flanders was
  not found stated on the pages read: to be read on the ordinance and the
  decree. No pack text yet says a consent to sharing is required
  (`sharing_consent_required`): the community's statutes may set it as an
  attribute of the project.
- **Transmission operator**: `elia`, kind `tso`, EIC `10X1001A1001A094`, in `grid.json`.
- **Support schemes**: none loaded. The green certificates of each region
  (CWaPE for Wallonia, Brugel for Brussels, VREG for Flanders) and the
  federal offshore support are regional and federal texts with their own
  thresholds, coefficients and dates, changed by many amending decrees; each
  is to be read on its consolidated decree or order before it becomes a row
  of `support_schemes`. Not read in this release: no row is guessed from a
  summary page.
- **`pv_specific_yield_fallback`**: no official page gives a national mean in
  kWh/kWp.
- **`offpeak_hours`**: it depends on the supplier and the tariff; no
  single national window.
- **Grid operator by municipality and by EAN prefix**: in Wallonia each
  municipality is served by the operator it designated; the list per
  municipality (`municipalities` of an operator in `grid.json`) is to be read
  on the regulator's published list. The platform this core was taken from
  holds a preliminary prefix list, marked as such, which the pack does not
  copy: it gives Sibelga `541445`, where Sibelga itself publishes
  `5414489`.
- **Network costs by region**: Eurostat gives a national mean; the three
  regulators (VREG, Brugel, CWaPE) publish the tariffs of each operator.
- The metering step of the other Walloon operators (RESA, AIEG, AIESH, REW),
  and the municipalities each Walloon operator serves (the pack names the
  region, not the municipality list).
- The data hubs of ORES and Sibelga, and the licence of the KBO / BCE data.
- The NIS code of a Flemish or Brussels place: neither Geopunt nor UrbIS
  gives it.
- The licences marked "not verified" (`icar`, `rmi_aws`) and "Terms not
  stated" (the published texts).

Figures read on 20 October 2026 on the publishers' pages.
