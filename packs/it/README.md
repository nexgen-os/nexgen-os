# Pack `it` — Italy

The values Italy decides that a function of the model reads, compiled by
`nexgen-os pack build it` into
[`supabase/seed/14_pack_it.sql`](../../supabase/seed/14_pack_it.sql).
Version 0.1.0, certification `community`: checked by the toolchain, read by
no Italian professional yet. Installing it needs the `grid` module. Nothing
here is code or law in words; no connector of this repository reads an
Italian register yet, and an address is found by the open geocoders of the
core's chain.

| File | Holds |
|---|---|
| `pack.json` | Italy, the euro, Italian and the three languages with official standing in their regions (German in Trentino-Alto Adige, French in Valle d'Aosta, Slovene in Friuli Venezia Giulia), one time zone (`Europe/Rome`), five-digit postal codes (CAP), municipalities numbered by `istat`; the 20 regions of ISO 3166-2 at the region level `region` |
| `identifiers.json` | `pod` (the withdrawal point: IT, three digits of the distribution operator, E, eight or nine digits), `istat` (the six-digit statistical code of a municipality), `partita_iva` (the VAT number, eleven digits, ISO 6523 code 0211), `codice_catastale_comune` (the cadastral code of a municipality, a letter and three digits), each with a pattern and an example that matches it |
| `sources.json` | the statistics office's list of municipalities (`istat_municipalities`), the cadastre (`agenzia_entrate_catasto`), the energy services manager's page on shared self-consumption (`gse_cacer_portal`), and the published texts (`kind` `text`, code `it_…`) a value, a frame or an operator of the pack cites |
| `project_kinds.json` | the frames of Decreto legislativo 199/2021: `it_autoconsumatore_a_distanza` (article 30, paragraph 1), refining `individual_self_consumption`; `it_gruppo_autoconsumatori` (article 30, paragraph 2), refining `collective_self_consumption`; `it_cer` (article 31), refining `energy_community` |
| `municipalities.json` | ten municipalities of the ISTAT list, each under its region: the capitals of the regions the golden cases and the bidding zones use (Roma, Milano, Torino, Bologna, Firenze, Napoli, Bari, Reggio di Calabria, Palermo, Cagliari). A representative subset: the full list is the same file at full length, built from the ISTAT file of the statistical codes, or a connector writing the same `regions` rows. Italy's density grid is not read by any value of the pack |
| `grid.json` | six operators: Terna (transmission and dispatching) and five distribution operators, each with the three-digit code its POD carries (`IT001` e-distribuzione, `IT002` Areti, `IT011` Inrete, `IT012` Unareti, `IT020` Ireti) |
| `defaults.json` | the values below, each with its source, its reference and its period |

## Which level decides what

In Italy `region` is the region of ISO 3166-2 (`IT-25`, `IT-82`); the
provinces and metropolitan cities are not declared, as no value of the pack
follows them. `parameter_of()` reads a region's value first, then the
country's ([0021](../../docs/decisions/0021-one-cascade-of-defaults.md)).

| Level | Carried as | Decides |
|---|---|---|
| Region | `region` of the participant's place | the market zone the place belongs to; regional planning and landscape rules, regional support |
| Municipality | `municipality` of the participant's place (its ISTAT code), a `regions` row `IT-<istat>` when the pack lists it | building works, the size of the municipality the capital grant of the decree 414/2023 reads |
| Primary substation | a `grid.substations` row the meter is downstream of | the perimeter of the incentivised shared energy |

## The defaults

| Attribute type | Value | Source |
|---|---|---|
| `bidding_zone` | by region, from 1 January 2021: NORD `10Y1001A1001A73I` (Piemonte, Valle d'Aosta, Lombardia, Trentino-Alto Adige, Veneto, Friuli Venezia Giulia, Liguria, Emilia-Romagna), CNOR `10Y1001A1001A70O` (Toscana, Marche), CSUD `10Y1001A1001A71M` (Umbria, Lazio, Abruzzo, Campania), SUD `10Y1001A1001A788` (Molise, Puglia, Basilicata), CALA `10Y1001C--00096J` (Calabria), SICI `10Y1001A1001A75E`, SARD `10Y1001A1001A74G`; null for the country, which has seven | GME list of the market zones; ARERA deliberation 103/2019/R/eel; ENTSO-E area list for the codes |
| `control_area` | `10YIT-GRTN-----B` for the whole country | ENTSO-E area list |
| `vat_rate_electricity` | 0.22, the ordinary rate, from 1 October 2013, which the common parts of a condominium (`coproperty`) bear too; 0.10 for an `individual` participant (domestic use) | DPR 633/1972, article 16 and table A, part III, number 103; Agenzia delle Entrate, answer 142 of 3 March 2021 |
| `sharing_perimeter` | `["same_substation"]` for a project `it_cer` or `it_autoconsumatore_a_distanza`, from 24 January 2024 | the incentive of the decree 414/2023 on the energy shared under one primary substation, as the Chamber of Deputies' note states it |
| `sharing_settlement_period` | `PT1H` for the three frames, from 1 March 2023 | TIAD, the shared energy as the hourly minimum of injection and withdrawal |

A value whose document gives no date (the control area) starts on the day it
was read, 7 November 2026. A rule of a text starts on the day the wording
loaded came into force.

## Shared self-consumption

Decreto legislativo 199/2021 knows three configurations sharing renewable
energy through the grid, the CACER of the decree 414/2023:

| Frame | In the model |
|---|---|
| individual self-consumer at a distance (article 30, paragraph 1) | `it_autoconsumatore_a_distanza`, perimeter `same_substation` |
| group of self-consumers acting jointly, in the same building or condominium (article 30, paragraph 2) | `it_gruppo_autoconsumatori`; the building is the perimeter, and no criterion of the model holds it yet: no `sharing_perimeter` is loaded, `parameter_missing` says so |
| renewable energy community (article 31) | `it_cer`, perimeter `same_substation` |

The act lets the members share energy within one market zone (article 31,
as amended by the decree-law 19/2025, article 1-bis), and the incentive of
the decree 414/2023 and the self-consumed energy of the TIAD count only the
energy shared under the same primary substation (cabina primaria). The pack
loads the perimeter that gives the value a study computes, the primary
substation; a market-zone criterion is a gap of the core, written below.
The primary substation of a point is published by the energy services
manager's maps; it is a `grid.substations` row, which the meter names.

## What the pack does not hold

The law is not part of the model: no legal text and no rule on the grid,
self-consumption, support schemes or meter data is in the pack, and the
steps of a project are the generic templates of the
[`actions`](../../modules/actions/README.md) module. The Italian steps —
the connection request and the single model (Modello Unico) of a small roof
plant, the regime of the testo unico FER (free activity, PAS or single
authorisation, Decreto legislativo 190/2024, annexes A to C), the
declaration of conformity of the installer, the registration in Terna's
register of production plants (GAUDÌ), the constitution of the community
before its request to the energy services manager, the request for the
incentive within 120 days of the plant's entry into operation — belong to
an installation's own templates, each citing its text.

## Golden cases

`golden/` holds one case per kind of project, each a scenario and the
figures an installation must find from it (`tests/golden.test.ts`,
[0034](../../docs/decisions/0034-a-pack-upgrade-is-never-silent.md)):

| Case | Kind | What it checks |
|---|---|---|
| `cer_bologna` | `it_cer` in Bologna | a flat in by its primary substation, a shop out on another; the perimeter refused before 24 January 2024; the hourly settlement period; the zone NORD; the domestic VAT of a household; the shares of a proportional key and the shared rate |
| `household_roma` | `pv_roof` in Roma | the operator of a meter found by its POD prefix (Areti), the zone CSUD, the control area, the domestic VAT, no household price loaded, self-consumption of a house |
| `sme_palermo` | `pv_roof` in Palermo | the zone SICI and its refusal before 2021, the ordinary VAT of a business, the operator by POD prefix (e-distribuzione), self-consumption of a workshop |

## What to check next

- **The consolidated texts**: the figures were read on 7 November 2026
  through the publishers' pages and the notes of the Chamber of Deputies,
  the regulator and the energy services manager, not article by article on
  the consolidated text of Normattiva. The articles of Decreto legislativo
  199/2021 (30, 31 and 8) and the wording after the decree-law 19/2025 are
  to be read there, with the TIAD in its version after the deliberation
  15/2024/R/eel and the definition of the shared energy in its article 1.
- **The market-zone criterion**: the act lets a community share within a
  market zone; the core has no `same_bidding_zone` criterion, so the pack
  loads the primary substation of the incentive only. A gap of the core.
- **The building criterion**: a group of self-consumers shares within one
  building or condominium; the core has no `same_building` criterion, so no
  perimeter is loaded for `it_gruppo_autoconsumatori`.
- **The power of a plant**: 1 MW per plant (or expansion) for the incentive
  of the decree 414/2023; `sharing_max_power_kw` is the power of an
  operation, not of one plant, and no condition reads the power of a
  device: not loaded.
- **The incentive of the decree 414/2023**: a premium tariff on the shared
  energy for twenty years, with a fixed part by power band and a variable
  part read on the hourly zonal price, and a capital grant of up to 40 % in
  municipalities below 5 000 inhabitants, raised to 50 000 by a later
  decree whose number and date were not confirmed. The kinds of
  `support_schemes` (feed-in tariff, contract for difference, green
  certificates, net metering) hold no premium on shared energy: not
  loaded. Neither is the auction scheme FER X, nor the closing of the net
  metering (scambio sul posto), whose texts were not read.
- **Imbalance settlement period**: the TIDE (deliberation 345/2023/R/eel)
  applies from 1 January 2025; the day the 15-minute period applies in
  Italy, and the derogation of the deliberation 539/2024/R/eel, were not
  confirmed, so `grid.market_of()` gives none for an Italian place.
- **Metering step**: the step of the readings of the second-generation
  meters was not read on the regulator's text: not loaded.
- **Prices, network costs and taxes**: the Eurostat figures for Italy
  (`nrg_pc_204_c`, `nrg_pc_205_c`) could not be read on the dataset itself:
  `energy_price_household`, `energy_price_business` and
  `grid_fees_and_taxes` are not loaded, and the cases show the refusal.
  The excise on electricity (accisa), whose amounts depend on the use and
  the monthly consumption, is not loaded either; nor are the time bands
  F1, F2 and F3 of the regulator (`offpeak_hours`).
- **VAT**: the 10 % of number 103 also covers the electricity of
  extractive, agricultural and manufacturing enterprises, which no segment
  of the core tells apart; such a business gets 22 % from the pack. No
  `vat_code_electricity` is loaded, as Ekwo OS's list of taxes holds no
  Italian code yet.
- **Bidding zones**: the configuration before 2021 is not loaded; the
  zones are the regions' as the market operator lists them, without the
  limited production poles or the foreign virtual zones.
- **Who runs a meter**: the distribution operators are found by the code
  of their POD; the codes were read on the operators' and retailers' bill
  guides, not on a register of the regulator, and the other local
  operators (more than a hundred) are not loaded, nor are the municipalities
  each serves. No operator carries `meter_data` or its EIC code: the
  regulator's consumption portal and the integrated information system
  (SII) of Acquirente Unico were not read.
- **Municipalities**: Roma's code was read on the statistics office's
  page; the nine others are the codes of the ISTAT list as commonly
  printed, to be checked line by line on its current file. The provinces
  (ISO 3166-2 `IT-MI`, `IT-PA`…), whose list in Sardinia changed in 2016
  and again since, are not declared.
- **Identifiers**: the ISO 6523 code 0211 of the VAT number, the length
  of the POD (eight or nine digits after the E), and a scheme for a
  cadastral parcel (municipality, sheet, parcel, unit) are to be confirmed.
- **Planning and buildings**: the regimes of the testo unico FER and their
  thresholds, the energy certificate (APE) and its classes, the solar
  obligations of new buildings (Decreto legislativo 199/2021, annex III)
  have no attribute type in the model.
- **Licences**: those marked "not verified" in `sources.json`, and "Terms
  not stated" for the published texts.

## Checked by

Nobody yet: the pack is `community`. A professional of the Italian energy
sector who reads every value against its text is named here, with the day,
and the pack becomes `reviewed`.

Figures verified on 7 November 2026 against the publishers' pages: the
ENTSO-E area list, the market operator's list of zones, the regulator's
deliberations 103/2019/R/eel and 727/2022/R/eel (TIAD), the energy services
manager's page on shared self-consumption, the Chamber of Deputies' note on
shared self-consumption of 13 June 2025, the statistics office's pages, and
the tax agency's answers on number 103 of table A.
