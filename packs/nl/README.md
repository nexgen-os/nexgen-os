# Pack `nl` — Netherlands

The values the Netherlands decide that a function of the model reads,
compiled by `nexgen-os pack build nl` into
[`supabase/seed/13_pack_nl.sql`](../../supabase/seed/13_pack_nl.sql).
Version 0.1.0, certification `community`: checked by the toolchain, read by
no Dutch professional yet. Installing it needs the `grid` module. Nothing
here is code or law in words.

The pack covers the European part of the Kingdom: its twelve provinces
(ISO 3166-2 `NL-DR` … `NL-ZH`) and their municipalities. Bonaire, Sint
Eustatius and Saba have their own electricity act (Wet elektriciteit en
drinkwater BES) and are not in it.

Most of what a study reads is decided nationally, in the Energiewet and in
the codes the regulator, the Autoriteit Consument en Markt (ACM), sets for
the grid operators. What follows a place is the grid operator: six
distribution operators share the country by province, municipality and
district, and the pack names each one where the ACM's
Gebiedsindelingscode elektriciteit puts it.

| File | Holds |
|---|---|
| `pack.json` | the Netherlands, the euro, Dutch and West Frisian (see below), `Europe/Amsterdam`, postal codes of four digits and two letters, municipalities numbered by `cbs_gemeentecode`; the twelve provinces at the region level `province` |
| `identifiers.json` | `cbs_gemeentecode` (the 4-digit municipality code of Statistics Netherlands), `bag_nummeraanduiding` and `bag_pand` (the address and the building of the BAG, 16 digits, object types 20 and 10), `kvk_number` (the Business Register of the Chamber of Commerce, ISO 6523 code `0106`), each with a pattern and an example that matches it. A Dutch metering point, the 18-digit EAN code of an energy bill, is a GS1 Global Service Relation Number: it uses the core scheme `gs1_gsrn`, and the pack adds none of its own |
| `sources.json` | five registers and services: `pdok_locatieserver` (the national geocoder), `bag` (Public Domain Mark 1.0, as the BAG API of PDOK states), `threedbag` (CC BY 4.0), `cbs` (CC BY 4.0), `kvk_handelsregister`; and the ten published texts (`kind` `text`, code `nl_…`) a value, a frame or a scheme of the pack cites |
| `project_kinds.json` | `nl_energiegemeenschap`, the one energy community of the Energiewet (article 1.1), refining `energy_community`; `nl_energie_delen`, energy sharing by an active customer or within an energy community (article 2.30), refining `collective_self_consumption` |
| `municipalities.json` | 26 municipalities of the CBS division of 2026 under their province: the six largest cities and the twenty municipalities a distribution operator other than its province's serves. A subset: the full list is the same file at full length, or a connector writing the same `regions` rows from the CBS table. The Netherlands publish no density class the pack reads |
| `grid.json` | seven operators — TenneT (transmission, the whole country) and Liander, Stedin, Enexis, Westland Infra, Coteq and Rendo (distribution) by province and municipality; the four voltage levels of the Netcode; the netting scheme (`salderingsregeling`) until 31 December 2026 |
| `defaults.json` | the values below, each with its source, its reference and its period |

## The languages

`nl`, then `fy`: Dutch, the language of the whole country, and West Frisian,
official beside Dutch in the province of Fryslân, whose name the pack gives
in both. The order is an order, not a choice made for the user: the
language a page or an agent speaks is the application's.

## The defaults

| Attribute type | Value | Source |
|---|---|---|
| `bidding_zone` | `10YNL----------L` | ENTSO-E list of Y EIC codes |
| `control_area` | `10YNL----------L` | ENTSO-E list of Y EIC codes |
| `imbalance_settlement_period` | `PT15M` | Begrippencode elektriciteit (ACM), definition of onbalansverrekeningsperiode: 15 minutes, by clock quarter-hour |
| `metering_step` | `PT15M`: a small connection allocated from its smart meter (`slimme-meter-allocatie`) is read per imbalance settlement period | Netcode elektriciteit (ACM), article 10.17, third and tenth paragraphs |
| `sharing_settlement_period` (`nl_energie_delen`, `nl_energiegemeenschap`) | `PT15M`: electricity is shared per imbalance settlement period | Energiewet, article 2.30, first paragraph, d |
| `energy_price_household` | 170.2 €/MWh (2024), 146.7 €/MWh (2025), band 2 500–4 999 kWh, energy and supply | Eurostat `nrg_pc_204_c` |
| `energy_price_business` | 116.9 €/MWh (2024), 101.0 €/MWh (2025), band 2 000–19 999 MWh | Eurostat `nrg_pc_205_c` |
| `grid_fees_and_taxes` | 64.3 €/MWh (2024), 99.9 €/MWh (2025): network costs and taxes of the household band, VAT excluded | Eurostat `nrg_pc_204_c` |
| `vat_rate_electricity` | 0.21 from 1 January 2023 | Wet op de omzetbelasting 1968, article 9, first paragraph; electricity is not in table I |
| `voltage_levels` | low voltage up to 1 kV, medium voltage up to 35 kV, high voltage up to 150 kV, extra-high voltage 220 and 380 kV | Netcode elektriciteit, article 8.1 |

The taxes component Eurostat gives for a Dutch household is negative in
both years (−0.0372 and −0.0136 €/kWh): the fixed energy tax credit of every
connection (heffingskorting) is spread over the kWh of the band and
outweighs part of the energy tax. `grid_fees_and_taxes` keeps the mean
Eurostat publishes; a kWh a household no longer takes from the grid saves
the marginal energy tax, which is more, and a study that needs it reads
the tax act's own band.

A yearly statistic holds from the first day of its year; the latest stays
open until the next is published, which closes it. A value whose text
gives no date of its own (the bidding zone, the metering step, the voltage
levels) starts on the day it was read, 7 November 2026.

## Netting until 2027

`grid.json` holds the `salderingsregeling` as a support scheme of kind
`net_metering`: for a final customer with a small connection (3 × 80 A or
less) and no feed-back contract with another party than its supplier, the
supplier deducts what is fed in from what is taken, up to what is taken
(Energiewet, article 2.31). The act of 18 December 2024 (Stb. 2025, 17)
repeals that article from 1 January 2027 and gives an active customer, from
then, a reasonable remuneration for what it feeds back, not below 50 % of
its agreed supply price until 1 January 2030 (new article 2.34, sixth to
tenth paragraphs). The scheme is therefore closed on `2027-01-01`; the
remuneration and any feed-back cost (terugleverkosten) are each supplier's
contract, attributes of the participant, never a value of the pack.

## Energy sharing

The Energiewet gives an active customer, and a connected party within an
energy community, the right to share energy (article 2.30) under four
conditions: an energy sharing agreement with a supplier that offers it, a
supply or feed-back contract of each participant with that supplier, a
meter whose communication function is used, and sharing per imbalance
settlement period. Its second paragraph lets an order in council set
where energy may be shared; the Energiebesluit (Stb. 2025, 347, read in
its version of 1 January 2026) sets no such rule. The pack therefore
decides no `sharing_perimeter`, and `community.check_perimeter()` refuses
it by name (`parameter_missing`), as the case `energie_delen_westland`
shows. The Energiewet has one frame of energy community; the renewable and
the citizen communities of the EU directives are not distinguished.

## What the pack does not hold

The law is not part of the model: no legal text and no rule is in the
pack, and the steps of a project are the generic templates of the
[`actions`](../../modules/actions/README.md) module. What a Dutch roof
installation or energy community also meets — the solar panels the
Besluit bouwwerken leefomgeving exempts from a permit (articles 2.29 and
2.30, with their exceptions for monuments and protected townscapes), the
energy label and the label C duty of offices, the registration of a
connection in the central connection register of the grid operators —
belongs to an installation's own templates.

## Golden cases

`golden/` holds one case per kind of project, each a scenario and the
figures an installation must find from it (`tests/golden.test.ts`,
[0034](../../docs/decisions/0034-a-pack-upgrade-is-never-silent.md)):

| Case | Kind | What it checks |
|---|---|---|
| `household_heemstede` | `individual_self_consumption` in Heemstede | Stedin found by the municipality inside Liander's province, the household price, fees and VAT, the savings, no residual mix and no injection price (`parameter_missing`) |
| `energie_delen_westland` | `nl_energie_delen` in Westland | the quarter-hour sharing period, no perimeter decided (`parameter_missing`), Westland Infra by municipality, the shares of a proportional key worked by hand |
| `sme_pv_eindhoven` | `pv_roof` in Eindhoven | Enexis by province, the business price, the metering step, a PVWatts yield within 0.1 %, specific yield and savings |

## What to check next

- **Who runs a meter by its EAN code**: no page of the ACM, of the grid
  operators or of their joint data service read for this pack gives the
  prefix of each operator's codes; `identifier_prefixes` are left out, and
  a meter is resolved by its municipality, then its province. The parts of
  municipalities the Gebiedsindelingscode gives to another operator than
  the pack's (districts of Amersfoort, Veenendaal, Deventer, Delft, Den
  Haag, Rotterdam, Maassluis, Vlaardingen; villages of Almelo, Oldenzaal,
  Steenwijkerland and West Betuwe; the former Zevenhuizen-Moerkapelle) are
  said in each operator's `coverage`: a meter there names its operator
  itself (`grid.meters.grid_operator`). The Gebiedsindelingscode read is
  the version in force from 13 December 2023, which still cites the
  Elektriciteitswet 1998; its update under the Energiewet is to be read.
- **Meter data access**: the central connection register and the consent
  through which a third party reads a customer's quarter-hour data are run
  by the grid operators' joint data service; its terms were not read, and
  no operator carries a `data_hub_url` or `meter_data` yet.
- **Emission factors** (`market_co2_factor`, `grid_co2_factor`): the
  Netherlands have full consumption disclosure, so the Association of
  Issuing Bodies publishes no residual mix for them (European Residual
  Mixes 2024, final version of 11 August 2025: `NA`); no yearly grid
  intensity was found on a publisher's page.
- **Price of injection** (`injection_price_reference`): no publisher's
  yearly mean of the Dutch day-ahead price was read. What a household is
  paid for its injection is its supplier's contract.
- **Energy tax** (`electricity_excise`): the bands and rates of the
  Wet belastingen op milieugrondslag (article 59) and the yearly
  indexation were not read to the 2026 figure.
- **Support schemes**: the SDE++ (Besluit stimulering duurzame
  energieproductie en klimaattransitie) and its rule for hours of negative
  prices are to be read on the consolidated decree and the yearly
  regulation before they become a row of `support_schemes`. The netting of
  the Elektriciteitswet 1998 before 2026 was not read either.
- **Geocoder**: the PDOK Locatieserver answers with BAG identifiers, the
  CBS municipality code and the province, but no connector of this
  repository reads it yet; a `pdok` connector keyed `NL` in `geocoderFor()`
  is the next step for a Dutch address.
- **Connection thresholds** (`connection_max_power_lv`,
  `connection_max_power_mv`): the Begrippencode defines a small connection
  as 3 × 80 A or less, a current and not a power; the Netcode's tables by
  voltage level were not read.
- **`pv_specific_yield_fallback`** and **`offpeak_hours`**: no official
  national figure; off-peak windows are each supplier's.
- The licences of the PDOK Locatieserver itself and of the KvK
  Handelsregister (`Terms not stated`), and of the ENTSO-E code lists.

Figures read on 7 November 2026 on the consolidated texts of
wetten.overheid.nl and officielebekendmakingen.nl, the ENTSO-E code lists,
Eurostat's dissemination API and the PDOK services. Checked by: nobody yet.
