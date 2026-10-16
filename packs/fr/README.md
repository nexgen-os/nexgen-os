# Pack `fr` — France

What the law of France says about places, grids, self-consumption, solar
and buildings, as rows: each rule in plain words and in numbers, with the
text it comes from and the consolidated text online. Nothing here is code;
the national address register answers in
[`formats/geocoding/ban.ts`](../../formats/geocoding/ban.ts).

| Section | What it says | Sources |
|---|---|---|
| identifiers | `prm` (the 14-digit metering point), `insee` (the municipality code: operator, planning rules and most datasets are decided there), `ban_address`, `siren`, `siret`, `parcelle` (14-character cadastral parcel), `rnb_id` (the national building identifier) | Enedis; INSEE; BAN; DGFiP; RNB |
| sources | `ban`, `geo_api_gouv`, `cadastre`, `bd_topo`, `rnb`, `sirene`, `legifrance`, `enedis_open_data`, `enedis_data_connect` (a customer's meter data, under mandate, never passed on), `odre`, `operat` | Licence Ouverte 2.0 unless said |
| addresses | street line, optional extra line, five-digit postal code, municipality; regions keyed by department (`FR-01` to `FR-976`), municipalities by INSEE code | NF Z 10-011 |
| legal | 15 texts: Code de l'énergie, Code de l'urbanisme, Code de la construction et de l'habitation, Code de l'environnement, loi APER (2023), loi Climat et Résilience (2021), the order of 21 November 2019 on collective self-consumption as amended in 2020 and 2025, the S21 order of 6 October 2021 as amended, the decrees of 1 July 2022 (environmental assessment) and 23 July 2019 (tertiary), the order of 31 March 2021 (energy label), the CRE deliberation on TURPE 7, Enedis' note NOI-CF_110E and convention for collective self-consumption, Enedis Data Connect terms, ENTSO-E bidding zones | Légifrance, CRE, Enedis, ENTSO-E |
| grid | 8 operators: Enedis (about 95 % of the mainland), RTE, EDF SEI (Corsica and overseas), five local distribution companies with their departments; rules: one bidding zone `FR` outside the islands, the 30-minute metering step, the components of TURPE 7 from 1 August 2025, the conformity attestation (Consuel) before energising, the connection request to the operator of the municipality | Code de l'énergie D. 342-16 and following, L. 342-1; CRE 2025-13; Enedis |
| energy_sharing | individual and collective self-consumption (L. 315-1, L. 315-2), the organising entity and its legal forms, the perimeter of an extended operation (2 km; 10 km rural or peri-urban and 20 km rural on derogation; the territory of a public inter-municipal body since 2025), the power ceiling (3 MW until 21 February 2025, 5 MW since; 0.5 MW in the islands), the three allocation keys on the 30-minute step, the convention with the operator, the monthly settlement | Code de l'énergie; arrêté du 21 novembre 2019 modifié; Enedis NOI-CF_110E and convention |
| compliance | ground photovoltaics: nothing under 3 kWc and 1.80 m, prior declaration up to 3 MWc (1 MWc before 1 December 2024), building permit above; roof photovoltaics: prior declaration (R. 421-17); environmental assessment at 1 MWc, case by case from 300 kWc; solar or vegetation on new commercial buildings of 500 m² (30 % in 2023, 40 % in 2026, 50 % in 2027) and on car parks of 1 500 m² (half the surface, 2026 and 2028) and new car parks of 500 m²; tertiary buildings of 1 000 m² cut final energy by 40 / 50 / 60 % in 2030 / 2040 / 2050 and declare on OPERAT; the energy classes A to G and the rental ban of G (2025), F (2028), E (2034) | Code de l'urbanisme R. 421-1, R. 421-2, R. 421-9, R. 421-17, L. 111-19-1; Code de l'environnement R. 122-2 item 30; CCH L. 171-4; loi APER art. 40; décret 2019-771; arrêté du 31 mars 2021; loi Climat art. 160 |
| support | the S21 purchase obligation on request up to 500 kWc until 21 September 2025 and up to 100 kWc since, the simplified tender from 100 to 500 kWc, the self-consumption premium; tariffs are read from the quarter's sheet, never from a rule | arrêté du 6 octobre 2021 modifié |
| data | a third party reads a customer's meter data per PRM with explicit, revocable consent; the 30-minute load curve only when asked | Enedis Data Connect terms |
| tasks | 21 templates `tasks.plan()` instantiates when the `tasks` module is installed: a roof installation (`pv_roof`, 11 steps from the feasibility study to the handover, the purchase contract or the tender depending on `installed_power`) and an energy community (`energy_community`, 10 steps from the perimeter check to the monthly settlement, one more when the production reaches 5 MW) | the rules above |

A rule that holds for a time says so (`valid_from`, `valid_to`): the 1 MWc
permit threshold and the 3 MW community ceiling stay, closed, next to the
rules that replaced them, and `rules_on('FR', section, day)` gives the ones
of a day. A rule whose reading is to be confirmed says so in `notes`.

## What to check next

- The power ceiling of operations on the territory of a public
  inter-municipal body (5 MW or 10 MW), on the consolidated order.
- The 2026 decree reported to raise the systematic environmental
  assessment of ground photovoltaics to 3 MWc.
- The shares of L. 171-4 CCH from 2026 and 2027, and the depth of history a
  Data Connect consent opens.

Checked by: nobody yet. Figures verified on 16/10/2026 against the
publishers' pages and photovoltaique.info; the consolidated texts on
Légifrance are the reference.
