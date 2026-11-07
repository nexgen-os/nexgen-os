# Pack `de` — Germany

The values Germany decides that a function of the model reads, compiled by
`nexgen-os pack build de` into
[`supabase/seed/13_pack_de.sql`](../../supabase/seed/13_pack_de.sql).
Version 0.1.0, certification `community`: checked by the toolchain, read by
no German professional yet. Installing it needs the `grid` module. Nothing
here is code or law in words; no connector of this repository reads a
German register yet, and an address is found by the open geocoders of the
core's chain.

| File | Holds |
|---|---|
| `pack.json` | Germany, the euro, German, one time zone (`Europe/Berlin`), five-digit postal codes, municipalities numbered by `ags`; the 16 states (Länder) of ISO 3166-2 at the region level `state`, the city states of Berlin, Hamburg and Bremen among them |
| `identifiers.json` | `malo_id` (the eleven-digit market location of the electricity and gas markets), `ags` (the official municipality key), `mastr` (the numbers of the core energy market data register: units, locations, market actors), each with a pattern and an example that matches it |
| `sources.json` | four registers and services: `destatis_gv_isys` (the municipality register), `mastr` (the register of every grid-connected unit), `smard` (the federal network agency's market data), `netztransparenz` (the transmission operators' joint publications); and the published texts (`kind` `text`, code `de_…`) a value, a frame, a scheme or an identifier of the pack cites |
| `project_kinds.json` | the frames of German law: `de_mieterstrom` (EEG 2023, § 21 (3); EnWG § 42a), `de_gemeinschaftliche_gebaeudeversorgung` (EnWG § 42b) and `de_gemeinsame_nutzung` (energy sharing, EnWG § 42c), refining `collective_self_consumption`; `de_buergerenergiegesellschaft` (EEG 2023, § 3 number 15), refining `energy_community` |
| `municipalities.json` | twelve municipalities of the register, each under its state: the three city states, Munich, Cologne, Düsseldorf, Frankfurt am Main, Stuttgart, Freiburg im Breisgau, Leipzig, Dresden and Hanover. A representative subset: the full list (about 10 800 municipalities) is the same file at full length, or a connector writing the same `regions` rows from the statistics office's file. No value of the pack follows a municipality yet |
| `grid.json` | twelve operators: the four transmission operators (50Hertz, Amprion, TenneT, TransnetBW) with their EIC party codes, Stromnetz Berlin with its state, and seven regional distribution operators without a region; three support schemes of the EEG, each with its negative-price rule |
| `defaults.json` | the values below, each with its source, its reference and its period |

## Which level decides what

In Germany `region` is the state (Land). `parameter_of()` reads a state's
value first, then the country's
([0021](../../docs/decisions/0021-one-cascade-of-defaults.md)).

| Level | Carried as | Decides |
|---|---|---|
| Country | `country` of the participant's place | the energy act (EnWG), the renewable energy act (EEG), metering (MsbG), taxes, the bidding zone, the registration of units (MaStR) |
| State | `region` of the participant's place (`DE-BE`, `DE-BW`) | the building code, and with it any obligation to install solar on roofs; the control area follows the grid, and matches a state only where one transmission operator covers it whole |
| Municipality | `municipality` of the participant's place (its AGS), a `regions` row when the pack lists it | the concession, and with it the distribution operator; building permits |

## The defaults

| Attribute type | Value | Source |
|---|---|---|
| `bidding_zone` | `10Y1001A1001A82H`, DE-LU, one zone for Germany and Luxembourg | ENTSO-E list of Y EIC codes |
| `control_area` | `10YDE-VE-------2` (50Hertz) in Berlin, Brandenburg, Hamburg, Mecklenburg-Vorpommern, Saxony, Saxony-Anhalt and Thuringia; none elsewhere (below) | 50Hertz, the company page; ENTSO-E list of Y EIC codes |
| `metering_step` | `PT15M`: a metered load profile for a consumer above 100 000 kWh a year or with a smart metering system; any other meter gives index readings only | MsbG § 55 (1) |
| `energy_price_household` | 165.4 €/MWh (2024), 148.1 €/MWh (2025), band 2 500–4 999 kWh, energy and supply | Eurostat `nrg_pc_204_c` |
| `energy_price_business` | 123.5 €/MWh (2024), 105.2 €/MWh (2025), band 2 000–19 999 MWh | Eurostat `nrg_pc_205_c` |
| `grid_fees_and_taxes` | 229.4 €/MWh (2024), 237.1 €/MWh (2025): network costs and taxes of the household band, VAT excluded | Eurostat `nrg_pc_204_c` |
| `injection_price_reference` | 78.51 €/MWh (2024), 89.32 €/MWh (2025): mean day-ahead wholesale price | Bundesnetzagentur, SMARD data 2025 (press release of 4 January 2026) |
| `grid_co2_factor` | 0.363 kg CO2/kWh consumed, 2024 | Umweltbundesamt |
| `market_co2_factor` | 0.72456 kg CO2/kWh, the residual mix of 2024 (direct emissions, for electricity disclosure) | Association of Issuing Bodies, European Residual Mixes 2024, Table 2, page 7 (final version of 11 August 2025) |
| `vat_rate_electricity` | 0.19, the standard rate | UStG § 12 (1) |
| `electricity_excise` | 20.50 €/MWh | StromStG § 3 |
| `offpeak_hours` | null: no national window; reduced network charges for controllable devices are each distribution operator's, under the regulator's determination | EnWG § 14a (1) |
| `sharing_settlement_period` | `PT15M` for a project `de_gemeinschaftliche_gebaeudeversorgung`: the allocation is per 15-minute interval | EnWG § 42b (5) |

A yearly statistic holds from the first day of its year; the latest one
stays open until the next is published, which closes it. A value whose
document gives no date, or whose earlier wordings were not read (the bidding
zone, the control area, the metering step, VAT, the electricity tax, the
settlement period), starts on the day it was read, 7 November 2026.

## The market and support schemes (`grid.json`)

- **Transmission operators**: `fifty_hertz` (`10XDE-VE-TRANSMK`, control
  area `10YDE-VE-------2`), `amprion` (`10XDE-RWENET---W`,
  `10YDE-RWENET---I`), `tennet_de` (`10XDE-EON-NETZ-C`, `10YDE-EON------1`),
  `transnetbw` (`10XDE-ENBW--TNGX`, `10YDE-ENBW-----N`), all of kind `tso`,
  their codes read on the ENTSO-E lists of X and Y codes. The code of
  50Hertz is `fifty_hertz` because a code starts with a letter.
- **Support schemes** of the EEG 2023, each paid for 20 years (§ 25 (1)):
  `de_eeg_feed_in_tariff` (`feed_in_tariff`, open window, up to 100 kW,
  § 21 (1) number 1); `de_eeg_market_premium` (the sliding market premium
  at the value the law sets, for installations exempt from tenders,
  § 22 (5)); `de_eeg_tender` (the premium awarded by the federal network
  agency's tenders, § 22 (1) to (4)). The premium is never negative, which
  the kind `contract_for_difference` approximates.
- **Negative prices**: § 51 as in force when read sets the value to zero
  for any period in which the spot price is negative, except, for an
  installation below 100 kW, until the end of the year it gets a smart
  metering system, and below 2 kW until the regulator's determination. The
  rule is written with `threshold_kw` 100, from the day it was read.

## Energy sharing

| Frame | What the text says | In the model |
|---|---|---|
| `de_mieterstrom` | solar on a building, supplied to consumers in the building, its ancillary buildings or the same neighbourhood (Quartier), without passing through a grid; the contract also covers the rest of their supply (EnWG § 42a (2)) | no perimeter: the building and the neighbourhood are no criterion of the core |
| `de_gemeinschaftliche_gebaeudeversorgung` | in the same building or its ancillary buildings, without passing through a grid; consumption measured quarter-hourly; allocation by a key per 15-minute interval, equal shares when in doubt, capped by each consumer's use (EnWG § 42b) | `sharing_settlement_period` `PT15M`; no perimeter, refused by name (case `gebaeudeversorgung_berlin`) |
| `de_gemeinsame_nutzung` | through the public distribution grid, within the balancing area of one distribution operator from 1 June 2026, and also in that of a directly adjacent operator of the same control area from 1 June 2028; installation and consumption points metered quarter-hourly; operated by a natural person or a company of final consumers and public bodies; consumers are households, small and medium enterprises and public bodies (EnWG § 42c) | no perimeter: "the same balancing area" is no criterion of the core (below) |
| `de_buergerenergiegesellschaft` | at least 50 natural persons, 75 % of the votes held by persons registered in a postal code area within 50 km of the installation (EEG 2023, § 3 number 15) | a rule on the members of a company, not on a sharing perimeter: not loaded |

## Golden cases

`golden/` holds one case per kind of project, each a scenario and the
figures an installation must find from it (`tests/golden.test.ts`,
[0034](../../docs/decisions/0034-a-pack-upgrade-is-never-silent.md)):

| Case | Kind | What it checks |
|---|---|---|
| `gebaeudeversorgung_berlin` | `de_gemeinschaftliche_gebaeudeversorgung` in Berlin | the 15-minute allocation of § 42b, VAT, the 50Hertz control area of `DE-BE`, the operator of Berlin by its state, the perimeter refused by name, the shares of a proportional key on four quarter-hours, the shared rate |
| `sme_pv_munich` | `pv_roof` in Munich | the business price, the electricity tax, the bidding zone, the control area and the operator of a Bavarian meter refused by name, a PVWatts yield within 0.1 %, self-consumption, savings and the value of injection |

## What the pack does not hold

The law is not part of the model: no legal text and no rule in words is in
the pack, and the steps of a project are the generic templates of the
[`actions`](../../modules/actions/README.md) module. The German steps — the
connection request to the distribution operator, the registration of a
unit in the core energy market data register within one month of its
commissioning (MaStRV § 5 (5)), the building electricity use contract or
the sharing contract and the allocation key notified for market
communication (EnWG § 42b (2) and (5), § 42c (3)), the metering point
operator's smart metering system — belong to an installation's own
templates, each citing its text.

## What to check next

- **Control areas outside the 50Hertz area**: TransnetBW (Baden-Württemberg),
  TenneT and Amprion share the other states along grid borders that do not
  follow the states; no operator's text read gives a state wholly to one of
  them, so `parameter_of()` answers `parameter_missing` for a control area
  there (case `sme_pv_munich`). Whether Baden-Württemberg, Schleswig-Holstein,
  Bremen and Saarland each lie in one control area is to be read on the
  operators' own pages or on netztransparenz.de. A finer place than a state
  (the municipality, or the meter's operator) is what the core would need.
- **Imbalance settlement period**: 15 minutes in the German balancing, set
  by the regulator's determination on balancing (MaBiS) and the European
  balancing guideline, neither read: not loaded, so `grid.market_of()` gives
  none for a German place.
- **Who runs a meter**: a MaLo-ID names no operator (BDEW guide, § 3.2) and
  Germany counts several hundred distribution operators, each holding the
  concessions of its municipalities; only Berlin's is found by its state.
  The metering location identifier (Messlokations-ID, 33 characters, which
  carries the operator's number) was not read on an official text and is
  not loaded; the operators' market partner numbers (BDEW codes) neither.
  The territories of the regional operators, by municipality, are the next
  step, from the regulator's or the operators' lists.
- **Meter data**: there is no central hub; the metering point operator
  sends readings to the parties of the market communication, and a third
  party reads them under the customer's consent through the smart meter
  gateway or the supplier. No operator carries `meter_data` yet.
- **Energy sharing perimeter**: § 42c (4) draws the balancing area of a
  distribution operator, and from 1 June 2028 that of an adjacent operator
  in the same control area. The core's criteria (`same_substation`,
  `same_municipality`, `same_region`, distances) do not read an operator's
  balancing area: a criterion `same_operator_area` is a gap of the core,
  noted here rather than approximated.
- **Power ceilings of energy sharing**: § 42c (7) lifts the supplier
  duties of §§ 5 and 40 to 42 for an installation of a household of up to
  30 kW, and of up to 100 kW in a multi-party house; no attribute type
  holds such a ceiling (`sharing_max_power_kw` is not a type of the core).
- **Negative prices**: the earlier wordings of EEG § 51 (periods of several
  consecutive hours, for larger installations), which still apply to the
  installations commissioned under them, and the switch of § 100 (47) with
  its 0.6 ct/kWh bonus, are not loaded; the day the current wording came
  into force (the "Solarspitzengesetz" amendment of early 2025) is to be
  confirmed on the Federal Law Gazette, so the rule starts on the day it
  was read.
- **The tenant electricity premium** (Mieterstromzuschlag, EEG § 19 (1)
  number 3 and § 21 (3)) and the 40 % residential floor area condition: no
  scheme kind of the core holds a premium on electricity supplied rather
  than fed in.
- **Zero VAT on PV**: UStG § 12 (3) sets 0 % on the supply and installation
  of photovoltaic modules and storage for a system on or near a dwelling;
  no attribute type holds the VAT of equipment.
- **Electricity tax reliefs**: the reduced rates and refunds of StromStG
  § 9 and § 9b (manufacturing and agriculture) are not
  read; 20.50 €/MWh is the general rate of § 3.
- **Solar obligations of the states** (Solarpflicht): several states —
  Baden-Württemberg, Bavaria, Berlin, Hamburg and North Rhine-Westphalia
  among them by the secondary sources read, to be confirmed on each law — oblige solar on new buildings,
  car parks or roof renovations, each by its own law with its own
  thresholds and dates. None was read for this version, and no
  attribute type of the core holds an obligation: they are the next
  section, per state as ISO 3166-2 region, once a module reads them.
- **Energy certificates** (Gebäudeenergiegesetz, GEG): the certificate
  classes and their duties are not read; no module reads them yet.
- **Voltage levels**: the network charges ordinance (StromNEV § 2) names
  extra-high, high, medium and low voltage without their bounds in kV, so
  no `voltage_levels` is loaded.
- **The municipality keys** were written from the register's structure and
  are to be checked against the current GV-ISys file.
- The licences marked "not verified" (`destatis_gv_isys`, `mastr`,
  `smard`) and "Terms not stated" (the published texts and
  `netztransparenz`).

## Checked by

Nobody yet: the pack is `community`. A professional of the German energy
sector who reads every value against its text is named here, with the day,
and the pack becomes `reviewed`.

Figures verified on 7 November 2026 against the consolidated texts of
gesetze-im-internet.de (EnWG §§ 14a, 42a, 42b, 42c; EEG 2023 §§ 3, 21,
22, 25, 51, 100; MsbG § 55; MaStRV § 5; StromStG § 3; UStG § 12; StromNEV
§ 2), the ENTSO-E lists of X and Y EIC codes, Eurostat (`nrg_pc_204_c` and
`nrg_pc_205_c`, updated 19 October 2026), the Bundesnetzagentur's SMARD
press release of 4 January 2026 and its MaStR numbering note, the BDEW
guide on identifiers (version 1.2), the Umweltbundesamt's page on 2024, the
AIB residual mixes 2024 and the company page of 50Hertz.
