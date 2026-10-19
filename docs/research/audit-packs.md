# Audit — the country packs, and a new pack structure

What a country pack is in Ekwo OS, what the `fr` and `be` packs of Nexgen OS
hold today and what reads them, the parameters an application built on the
model actually uses, and a proposal: a smaller pack of structuring values,
the legal material and the country task lists out of it, and one cascade of
defaults from the country down to a participant.

Read at commit `38f4c32` (Nexgen OS, release 0.1.0 of 17/10/2026). Every count
below was taken with `grep`, `wc` or a short `node` script on the files named
beside it.

## 1. What a pack is in Ekwo OS

**Principle** (decision 0025, `docs/decisions/0025-a-country-is-a-pack-of-data.md` of Ekwo OS):
the truth of a country lives in `packs/<cc>/`, as JSON validated by a published
JSON Schema (`packs/schema/pack.1.json`), a CSV for the chart, `i18n/` for the
labels and `golden/` for expected results. `ekwo pack build` compiles a pack into
a committed seed SQL file; `ekwo pack check --all`, in CI, refuses a seed that is
not the exact output of its pack. Three rules: a pack cannot execute (no
expression, no hook; a formula is a list to add and a list to subtract); nothing
in the core carries or falls back on a country, a currency or a language; nothing
is ever deleted from a pack (a tax gets a `valid_to`, a form version a new code).

**Size.** 135 two-letter country folders plus `generic`, `ohada` (a chart shared by
seventeen countries) and `schema` (`ls packs`). The `be` pack is 21 files
(`find packs/be -type f`); its generated seed `supabase/seed/10_pack_be.sql`
(1 587 lines) inserts **1 209 rows** into 15 template tables:

| Table | Rows | Table | Rows |
|---|---:|---|---:|
| `account_templates` | 707 | `tax_report_box_templates` | 32 |
| `statement_line_templates` | 162 | `analysis_rules` | 32 |
| `statement_line_rules` | 121 | `tax_templates` | 23 |
| `tax_posting_templates` | 89 | `analysis_templates` | 17 |
| `legal_mention_templates` | 7 | `journal_templates` | 6 |
| `statement_templates` | 4 | `chart_templates` | 3 |
| `country_packs`, `country_defaults`, `tax_report_templates` | 2 each | | |

Five sixths of the rows are the chart of accounts and the statements: the
regulation an accounting engine *executes*. The pack is large because every row
is read by a posting, a return or a statement.

**The core tables that receive a pack.**

| Table | Role | Source |
|---|---|---|
| `country_packs` | what the installation holds: country, version (semver), `released_at`, `schema_min`, certification status, reviewer and date, sha256 `checksum` | `supabase/migrations/20260912074712_country_packs.sql:49` |
| `company_packs` | which version of which pack each company copied | same file, `:72` |
| `country_defaults` | one row per country: currency, language, rounding, closing style, the accounts and journals playing each role, and the document rules of 0033 (numbering, payment term, tax point, e-invoicing, bank formats, filing cadence); 14 columns at creation, about 50 added since, among them six `*_legal_reference` / `*_source_key` pairs | `20260911121100_country_templates.sql:77`, then `alter table` in later migrations |
| `territories` | ISO 3166 codes and the window each territory was inside the common VAT system; 256 rows, seeded once for every pack | `20260915181000_territories.sql:152`, `supabase/seed/00_territories.sql` |
| `*_templates` | the template rows a company copies through `install_country_template()` | `20260914143915_accounts_in_use.sql` |

**How a pack lives.**

| Concern | Rule | Decision |
|---|---|---|
| Loaded | generated seed upserts on template tables only; a company copies them at install | 0025 |
| Sources | a register in the manifest: key, title, publisher, absolute `https` URL, day consulted, kind among six (`law`, `regulation`, `form`, `standard`, `portal`, `guidance`); every rule names the key of its text and its article; **no sentence of the law is copied**; the `be` manifest lists 24 texts | 0027 |
| Certified | `community` → `maintained` → `reviewed` (a named professional); one sentence printed by every command; `legal_reference` required on every tax and box | 0026 |
| Upgraded | the difference is computed by natural key: additions copied, closing validities applied, everything else listed and left unless accepted; `pack_upgrade_diff()` and `pack_upgrade()` live in the schema; adding anything bumps the version | 0028 |
| Tested | a golden year (`golden/scenario.json`, ten documents and payments or more) replayed by one country-less runner; expected figures generated; a pack without golden is refused unless it says why; a CI guard refuses a country code inside `expect(…)` | 0029 |
| Country rules as data | what a document must carry (0033), labels with a translation column and complete declared languages (0034), filing cadence as an enum with no column default (0036), deadlines as two shapes or a null that means "no rule of this shape" (0038) | 0033–0038 |

**What Ekwo deliberately keeps out of a pack** (0025): rates that change monthly
across many jurisdictions (a feed), payroll, inventory, analytics, the
translation of the application. And the text of the law itself (0027): the pack
holds the *register* of the texts — a title and a link per text — never their
content. Commentary and summaries live outside the open repository.

**The lesson for Nexgen OS.** An Ekwo pack is large because each of its rows is
executed by a function of the core. A pack is justified row by row by a reader;
the register of sources stays small and points to texts, it does not transcribe
them.

## 2. The current Nexgen OS packs

### 2.1 Files and rows

| Pack | File | Lines | Rows |
|---|---|---:|---|
| `be` | `seed/0001_be.sql` | 25 | `sources` 5, `id_schemes` 5 |
| | `seed/0002_legal_sources.sql` | 19 | `legal_sources` 11 |
| | `seed/0003_tasks.sql` | 43 | `tasks.templates` 23 (12 regional) |
| | `seed/0004_grid.sql` | 22 | `grid_operators` 8 |
| | **total** | **109** | **52** |
| `fr` | `seed/0001_identifiers_sources.sql` | 24 | `sources` 11, `id_schemes` 7 |
| | `seed/0002_legal_sources.sql` | 20 | `legal_sources` 15 |
| | `seed/0003_grid.sql` | 37 | `legal_sources` 1, `grid_operators` 8, `rules` 5 (grid) |
| | `seed/0004_energy_sharing.sql` | 52 | `rules` 12 |
| | `seed/0005_compliance.sql` | 67 | `rules` 14 |
| | `seed/0006_support_data_addresses.sql` | 30 | `legal_sources` 1, `rules` 5 (support 3, data 1, addresses 1) |
| | `seed/0007_tasks.sql` | 38 | `tasks.templates` 21 |
| | **total** | **268** | **100** |

Lines: `wc -l packs/*/seed/*.sql`. Rows: tuples counted per `insert into`, and
`grep -o "'pack:[a-z]*'"` gives the same 52 and 100. The lines are long: the
eleven seed files weigh 81 kB (`wc -c`). Manifests: `packs/fr/pack.json` (17
lines, nine sections), `packs/be/pack.json` (18 lines, five sections and three
regions). READMEs: 38 lines (`fr`), 86 lines (`be`).

### 2.2 The core tables they fill

| Table | Columns | Defined in | Written by |
|---|---:|---|---|
| `legal_sources` | 10 | `supabase/migrations/20261012200950_core_regulation.sql:30` | packs |
| `rules` (+ `rules_on(country, section, day)`) | 15 | same, `:62` and `:104` | packs |
| `grid_operators` | 11 | same, `:127` | packs |
| `id_schemes` | 7 | `20261012200100_core_vocabularies.sql` | core seed, packs |
| `sources` | 15 | same | core seed, packs, modules |
| `tasks.templates` | 16 after `0002` | `modules/tasks/migrations/0001_tasks.sql:95`, `0002_template_regions.sql:13` | packs only ("the module ships none") |

`packs/README.md` announces thirteen sections (`identifiers`, `sources`,
`addresses`, `legal`, `grid`, `energy_sharing`, `compliance`, `support`, `data`,
`tasks`, `mappings`, `series`, `examples`); the two packs use ten of them, and
`mappings`, `series` and `examples` are filled by no pack.

### 2.3 Classification and readers

| Group | Rows `fr` | Rows `be` | Class | What reads it today |
|---|---:|---:|---|---|
| `id_schemes` | 7 | 5 | identifiers | the pattern check of `external_ids` and `meters` (`core_attachments.sql:215`, `core_grid.sql:59`); `formats/geojson`; `nexgen-os doctor` |
| `sources` (registers, geocoders, data hubs, weather) | 11 | 5 | sources and geocoders | `attributes.source_code`, `sites.location_source_code`, `weather.models` (FK) and `weather.source_for()` step (d); the licence filter of `formats/geojson` |
| `rules` addresses | 1 | — | identity | nothing: `formats/geocoding` hard-codes the chain in TypeScript (`ban.ts`, `belgium.ts`) |
| `grid_operators` | 8 | 8 | grid | **tests only** (`tests/packs-fr.test.ts`, `tests/packs-be.test.ts`); `meters.grid_operator_id` points to `contacts`, not to this table (`core_grid.sql:31`) |
| `rules` grid | 5 | — | grid / legal | **tests only** |
| `legal_sources` | 17 | 11 | legal | the foreign key of `rules` and of `tasks.templates.legal_source_code`; tests |
| `rules` energy_sharing | 12 | — | legal | **tests only**; the `sharing` module that would read them does not exist (`modules/README.md:40`) |
| `rules` compliance | 14 | — | legal | **tests only**; the `compliance` module is planned (`modules/README.md:48`) |
| `rules` support, data | 4 | — | legal | **tests only** |
| `tasks.templates` | 21 | 23 | tasks | `tasks.plan()` (`modules/tasks/migrations/0002_template_regions.sql:18`); `tests/tasks.test.ts` |

`rules_on()` is called by one file outside its migration: `tests/packs-fr.test.ts`
(`grep -rln rules_on`). No module, example or engine reads `rules`,
`legal_sources` or `grid_operators`.

**Of 152 pack rows, 28 are read by a function of the model (identifiers and
sources), 44 by `tasks.plan()`, and 80 by tests only.**

### 2.4 Findings on the way

| # | Finding | Where |
|---|---|---|
| F1 | A leftover merge marker (`\|\|\|\|\|\|\| parent of 968669a`) and three `be` rows in the table of packs | `packs/README.md:53-56` |
| F2 | The `fr` README counts 15 legal texts; the pack inserts 17 (the ENTSO-E page and NF Z 10-011 sit in `0003` and `0006`) | `packs/fr/README.md`, `packs/fr/seed/` |
| F3 | No pack seed has an `on conflict`: a seed loads once. The installer records file names in `schema_migrations` (scope `pack:<cc>`), so a changed seed file is never re-applied and a new pack version reaches nobody | `grep -c "on conflict" packs/*/seed/*.sql` → 0; `supabase/migrations/20261013000000_schema_version_0_1_0.sql:31` |
| F4 | `version`, `sections`, `regions` and `requires_core_min` of `pack.json` are read by nothing; the installer reads only `modules`, which no manifest sets (the `tasks` seeds skip themselves when the module is absent) | `packages/cli/src/catalogue.ts:72-78` |
| F5 | The installation records no pack version, checksum or certification status | no `country_packs` table in `supabase/migrations/` |
| F6 | Five roof templates are the same task in both packs (`feasibility`, design, `procurement`, `installation`, `handover`), with the same names | `packs/fr/seed/0007_tasks.sql`, `packs/be/seed/0003_tasks.sql` |
| F7 | Structuring numbers sit inside legal `rules.parameters` where no reader finds them: the 30-minute metering step and the time zone (`fr_grid_metering_step`), the bidding zone and its EIC code (`fr_grid_bidding_zone`), the sharing perimeter of 2 000 m and the 5 MW ceiling, the postal code pattern and the region level (`fr_address_format`) | `packs/fr/seed/0003_grid.sql`, `0004_energy_sharing.sql`, `0006_support_data_addresses.sql` |

## 3. The parameters of the platform built on the model

The commercial platform built on the model keeps its study parameters in its
own schema (read-only reference: `supabase/migrations/` and `src/` of that
repository). Its inventory `docs/economics/PARAMETER_INVENTORY.md` lists **127**
parameter identifiers (`grep -c "^| \(EP\|OD\|UD\|DV\|PM\|K\)-"`); deduplicated across
tables, about 113 economic and default columns, plus 50 device columns.

### 3.1 Where parameters live

| Table | Keyed by | Country column | Content |
|---|---|---|---|
| `economic_parameters` | project, participant (unique pair) | no | 58 columns: energy prices (purchase, injection, community, peak and off-peak), grid fees and taxes, capex and opex per kWp, battery and charging-point costs, VAT, discount rate, roof densities |
| `organisation_defaults` | organisation | no | 58 columns, 20 sharing a name with the table above: the same economics, plus lifetime, degradation, price increase, loan and leasing terms, weather source and radius, report branding |
| `user_economic_defaults` | user | no | 35 columns, a fifth level between organisation and platform |
| `geo_country_settings` | country | **yes (primary key)** | 4 columns: postal code length, the function that finds the region of a coordinate, a bounding box, the currency (`20260924u_geo_country_settings.sql:29`, `20261001i`) |
| `whitelabel_configs` | partner | no | branding only (colours, logo, contact) |
| `platform_economic_defaults()` | none | no | a constant row of 12 values (`20260910d_platform_economic_defaults_function.sql:26-58`) |

### 3.2 How a value is resolved — twice, in two orders

- **At project creation**, a trigger copies one `economic_parameters` row,
  each value as `coalesce(user, organisation, platform)`
  (`20260910d…sql:75-99`); columns added later are not copied.
- **At read time**, the application resolves participant → project →
  organisation → component default → the caller's fallback
  (`src/utils/economicParamResolver.ts:679-700`); no user level, and a stored
  0 stops the cascade as a value would.

The platform level knows no country: injection 34 €/MWh, household energy
148 €/MWh, capex 1 000 €/kWp, discount rate 0.04, whatever the site.

### 3.3 The parameters that depend on the country

| Parameter | Unit | Values found | Stored in |
|---|---|---|---|
| specific yield of PV ("production hours") | kWh/kWp/yr | BE 900, FR 1100; NL 900 / 850 / 850, LU 900 / 1050 / 900, ES 1500 / 1600 / 1600, DE 1000 / 900 / 900 in three diverging copies | `src/lib/…/services/economics/defaults.ts:492`, `src/utils/productionHours.ts:7`, `20260827_fix_trigger_loop_devices_participants.sql:52` |
| wind and CHP full-load hours | h | per country | `src/utils/productionHours.ts:32-46` |
| CO₂ factor of grid electricity | kg CO₂/kWh | FR 0.052, BE 0.164, LU 0.088, default 0.100 | `src/lib/…/services/environmental/environmentalIndicators.ts:32` |
| flexibility programmes | list | BE, FR, LU | `src/types/flexibility.ts:106` |
| currency, postal code length, region of a coordinate, bounding box | ISO 4217, digits, function, degrees | BE, FR | `geo_country_settings` |
| excise on electricity (4 consumer types), transmission levy share, VAT, grid tariff variable part, five values of the surplus purchase scheme | €/MWh, fraction, €/kWh, kWp, h | one country only, no country key | `defaults.ts:367-440` |
| off-peak hours | h | one hard-coded window, no country key | `default_offpeak_hours()` (`20260923i:92`) |
| participant and project country | ISO 3166-1 | column default `'BE'`, `coalesce(country, 'BE')` in SQL flows | `20250313132225:12` |
| time zone | — | not a parameter; one zone hard-coded in a display | `src/components/activity/activityHeadline.ts:58` |

**Summary.** 9 parameters carry real per-country values, all in code or in one
four-column table; 12 more are constants of one country with no key; the
cascade tables themselves are country-blind. This is the raw material of the
new pack: a dozen values a country decides, each written once, with its unit
and its source, instead of three copies in two languages.

## 4. The new pack structure

### 4.1 The rule

**A pack holds what a function of the model reads, and nothing else.** Every
row has a reader in the core or in a module, every value has a unit and a
source, and the law itself — its statements, its thresholds a computation does
not use, its commentary — lives outside the open repository. This is Ekwo's
rule (a pack is large because each row is executed) applied to a model whose
computations read few national values.

### 4.2 Five sections

| Section | Holds | Core table | Read by |
|---|---|---|---|
| `identity` | country code and name, currency (ISO 4217), languages (BCP 47), time zones (IANA, the first is the default), region level and the regions (ISO 3166-2) with their parent and time zone, municipality code scheme, postal code pattern | `countries`, `regions` (new) | site creation (default time zone, region check), `formats/geocoding`, applications (currency, language) |
| `identifiers` | national identifier schemes and their patterns | `id_schemes` | the pattern checks of `external_ids` and `meters` |
| `sources` | national registers, geocoders, data hubs, weather services, statistics offices — with licence, attribution, retention, regions; the order in which the geocoders of a country are asked | `sources` | provenance, `formats/geojson`, `weather.source_for()`, the geocoder chain |
| `grid` | transmission and distribution operators, what they cover (regions, municipality codes), the metering identifier they issue | `grid_operators` | meters, the future `grid` and `sharing` modules |
| `defaults` | the country values of the cascade, each with property, unit, value, validity, region if partial, source and reference | `defaults` (new) | `parameter_of()` |

Out of a pack: legal texts and rules, task templates, tariffs that change
more often than yearly, anything of one installation, and code.

**What `defaults` holds** — a starting catalogue, drawn from §3.3 and from the
numbers buried in the `fr` rules (F7). Each is a `property_defs` row with its
quantity, so its unit is checked.

| Property | Unit | `fr` | `be` | Reader |
|---|---|---|---|---|
| `metering_step` | ISO 8601 duration | PT30M | PT15M | series, `sharing` |
| `bidding_zone` (+ EIC code) | code | FR | BE | price series, `sharing` |
| `grid_co2_factor` | kg CO₂e/kWh | from the transmission operator's yearly balance | same | environmental indicators |
| `pv_specific_yield_fallback` | kWh/kWp/yr | national mean, cited | same | `solar` when no run exists, marked as a fallback |
| `vat_rate_electricity` | fraction | standard rate, cited | same | economics |
| `energy_price_household`, `energy_price_business`, `grid_fees_and_taxes` | currency/MWh | yearly, from a public statistic (half-year electricity prices of the national statistics office or the European one) | same | economics, `sharing` |
| `injection_price_reference` | currency/MWh | yearly, cited | same | economics |
| `offpeak_hours` | list of hours | null where it depends on the contract | null | economics |
| `sharing_max_distance_m`, `sharing_max_power_kw`, `sharing_settlement_period` | m, kW, duration | 2000, 5000, P1M | per region, or null | `sharing` |

About fifteen properties; a value that depends on the company, the contract or
an option is **null with its reference**, as Ekwo's filing cadence (0036): one
lawful answer offered as the default is how the other ends up installed.
Market values (capex per kWp, a supplier's price) stay at organisation and
project level.

**Estimated size** (identity row + regions + identifiers + sources + operators
+ about fifteen defaults): `be` about 40 rows (3 regions); `fr` about 140, of
which about 100 are the departments its region level uses. Today: 52 and 100
rows, most of them read by tests only.

### 4.3 The legal material

**Where it goes.** The texts, the rules in plain words, the thresholds a
computation does not read, and the commentary go to the private `intel` schema
and to the website, summarised, as Ekwo does with its own commentary. What
stays in the pack is **one reference per value**: the `source_code` of the
`sources` row it was read from (a law, a statistic, an operator's page) and a
`reference` (the article, the table, the page). That is Ekwo's register (0027)
reduced to the values the pack holds, without a second register: `sources`
gains a kind for a published text, so a value read from a law and a value read
from an API are cited the same way.

**What happens to `legal_sources` and `rules`.**

| Option | Cost | Consequence |
|---|---|---|
| A. Leave the public repository | one migration in 0.2 drops `rules`, `rules_on()`, `legal_sources` and the foreign key of `tasks.templates`; the 64 rows of the two tables move to `intel`; the pack tests lose their rule and legal cases | the core has two tables and one function fewer; nothing that computes is lost (no reader today) |
| B. A module `regulation` (schema `regulation`) | the same two tables moved, a module README, a pack or an overlay filling them | the open repository keeps maintaining law it does not compute with; the `compliance` module, when it comes, has its tables ready |
| C. Stay in the core | none now | the core keeps a catch-all its owner wants removed; every new country adds law to review |

0.1.0 is published (`CHANGELOG.md`), so A and B are a new migration, never an
edit of `20261012200950_core_regulation.sql`; before 1.0 a minor release may
break and says how.

### 4.4 Country tasks

| Option | Cost | Consequence |
|---|---|---|
| A. Generic templates in `modules/tasks`, none in packs | the module ships about a dozen country-less templates (`country` null) for a roof installation and an energy community: study, design, authorisation checked, connection request, procurement, installation, conformity inspection, energised, handover; perimeter checked, entity founded, key chosen, consents, registration, settlement; `legal_source_code` becomes a free `reference` | one list everywhere; the five templates F6 duplicates are written once; a step's name says what is done, not under which article |
| B. A. plus a country overlay outside the pack | the country-specific steps (a named inspection body, a regional authorisation, a purchase-contract or tender branch) are published by an installation or a private package, with `published_by` | a step only one country has stays possible, never in the open pack |
| C. Keep templates in packs | none now | the pack keeps 44 rows of law-derived steps the owner wants out |

A template's condition already reads an attribute (`applies_when`); with
defaults it reads a pack value too (for example a power threshold), so a
generic step can still apply only above a national limit.

### 4.5 The defaults cascade

**Levels.** country (and region) → organisation → project → site →
participant or device. No global level in the core: Ekwo's second rule (nothing
falls back on a country, a currency or a language) extends to numbers; a
generic constant of a method — a degradation rate, a lifetime — belongs to the
module's named profile (decision 0016), which the run records.

**Storage.**

| Level | Where | Written by |
|---|---|---|
| country, region | `defaults` with `country`, optional `region`, `published_by = 'pack:<cc>'` | the pack |
| organisation | `defaults` with `organisation_id`, under row level security | owners of the organisation |
| project, site, participant, device | `attributes` (already temporal, sourced and scenario-aware) | users, imports, modules |

```
defaults (
  id               uuid primary key,
  property_code    text not null references property_defs(code),
  country          char(2),            -- set for a pack row
  region           text,               -- ISO 3166-2, when partial
  organisation_id  uuid references organisations(id),  -- set for an organisation row
  value            jsonb,              -- null: the country gives no single answer
  valid_from       date,
  valid_to         date,
  source_code      text references sources(code),
  reference        text,               -- article, table, page
  published_by     text not null,
  check ((country is null) <> (organisation_id is null))
)
```

**One function resolves a parameter.**
`parameter_of(object_id, property_code, at, scenario) returns jsonb` —
`{value, level, source_code, reference, valid_from}`:

1. the attribute of the object (`attributes_of`);
2. the attribute of its parents, nearest first (participant → site → project;
   device → site);
3. the row of its organisation;
4. the row of its region (`sites.region`), then of its country (`country_of`);
5. else the named refusal `parameter_missing: <property> for <country>`; a
   pack row whose value is null answers with its reference and
   `parameter_not_decided`.

| | Platform (`platform_economic_defaults` + resolver) | `weather.source_for()` | Proposed `parameter_of()` |
|---|---|---|---|
| When | copied at project creation, then resolved again in the application | at read time | at read time; a run records what it read (0004) |
| Order | two different orders | site → organisation → region → country → coverage | one order, the same for every property |
| Country | none | yes, region before country | yes, region before country |
| Missing | a constant | `weather_source_unknown` | `parameter_missing`, `parameter_not_decided` |
| Says where it came from | partly (`…WithLevel`) | no | `level`, `source_code`, `reference` |

Resolving at read time replaces Ekwo's copy-at-install: a company copies its
chart because it books on it for years; a value is read by a run, which keeps
it. A new value is a new row with `valid_from` and a `valid_to` on the old one
(Ekwo 0028), so a run replayed at its date reads what it read. `weather.rules`
becomes a case of the same cascade (the property `weather_source` already
exists, `modules/weather/migrations/0001_weather.sql:189`), with the purpose as
part of the property code.

### 4.6 Draft of the new `packs/README.md`

````markdown
# `packs/` — one folder per country

A pack is the few values a country decides that a function of the model reads:
who the country is, how it names things, where its data is, who runs its grid,
and the defaults a study starts from. Each value carries its unit and the
source it was read from. A pack never holds code, law in words, task lists or
prices that change within a year; the commentary on a country's law is not
part of the open model.

packs/be/
├── pack.json        identity, version, certification, the sections below
├── identifiers.json id_schemes rows, each with an example that matches
├── sources.json     sources rows: registers, geocoders, hubs, statistics, texts
├── grid.json        operators and what they cover
├── defaults.json    property, value, unit, validity, region, source, reference
├── golden.json      sample places, one per region, and what parameter_of returns
└── README.md        what is decided, what is null and why, who checked it
supabase/seed/pack_be.sql  generated by `nexgen-os pack build be`, committed

| Section | Fills | Required |
|---|---|---|
| identity (in pack.json) | countries, regions | yes |
| identifiers | id_schemes | when the country has its own |
| sources | sources | yes: at least the texts its defaults cite |
| grid | grid_operators | when the pack describes energy |
| defaults | defaults | yes |

A row that holds in part of the country names its regions (ISO 3166-2). A
value that depends on the company, a contract or an option is null with its
reference. Nothing is deleted: a value gets a valid_to and a new row.

## The check a pack must pass — `nexgen-os pack check <cc>`

- pack.json validates against `packs/schema/pack.1.json`; every section listed
  exists and every file present is listed;
- every default names an existing property, its value has the property's
  datatype and stays within its bounds, and it cites a source with an https URL;
- every region named exists in the pack's identity;
- every identifier pattern compiles and matches its example;
- the committed seed is the exact output of the pack (checksum);
- `golden.json`: for each sample place, `parameter_of()` returns the expected
  value, level and source; one country-less runner plays every pack.

## Proposing a pack

Copy `packs/_template`, fill identity and defaults first, cite every value,
run `nexgen-os pack check`, open a pull request with the DCO sign-off. A new
pack is `community`; `maintained` when the maintainers keep it; `reviewed`
when a named professional of the country read it, written in pack.json.
````

### 4.7 Mapping of the current rows

| Pack | Row group | Rows | Destination | New home |
|---|---|---:|---|---|
| `fr` | `id_schemes` (prm, insee, ban_address, siren, siret, parcelle, rnb_id) | 7 | keep | identifiers |
| `fr` | `sources` registers and hubs (ban, geo_api_gouv, cadastre, bd_topo, rnb, sirene, enedis_open_data, enedis_data_connect, odre) | 9 | keep | sources |
| `fr` | `sources` legifrance (legal portal), operat (tertiary declarations) | 2 | move to intel | — |
| `fr` | `rules` addresses (`fr_address_format`) | 1 | keep, reshaped | identity: postal pattern, region level, municipality scheme |
| `fr` | `legal_sources` | 17 | move to intel; the texts a default cites return as `sources` rows | — |
| `fr` | `grid_operators` | 8 | keep | grid |
| `fr` | `rules` grid: bidding zone, metering step | 2 | keep, reshaped | defaults |
| `fr` | `rules` grid: tariff components, conformity attestation, connection request | 3 | move to intel | — |
| `fr` | `rules` energy_sharing: perimeter (standard), power ceilings (3 and 5 MW), settlement | 4 | keep, reshaped | defaults (`sharing_*`, with validity) |
| `fr` | `rules` energy_sharing: definitions, entity, derogations, keys, convention | 8 | move to intel | — |
| `fr` | `rules` compliance | 14 | move to intel | — |
| `fr` | `rules` support, data | 4 | move to intel | — |
| `fr` | `tasks.templates` | 21 | drop from the pack | generic steps in `modules/tasks`; country steps to the overlay |
| `be` | `id_schemes` (nis, vlaanderen_address, vlaanderen_building, urbis_building, icar_address) | 5 | keep | identifiers |
| `be` | `sources` (geopunt, basisregisters_vlaanderen, urbis, icar, rmi_aws) | 5 | keep | sources |
| `be` | `legal_sources` | 11 | move to intel | — |
| `be` | `grid_operators` | 8 | keep | grid |
| `be` | `tasks.templates` (12 regional) | 23 | drop from the pack | as for `fr` |
| both | identity, regions, defaults | 0 | new | identity, defaults |

Kept or reshaped: 49 of 152 rows. Moved to intel: 59. Dropped from the packs:
44 task templates.

## Decisions for the owner

1. **What becomes of the core tables `legal_sources` and `rules`?**
   - A. Leave the public repository (one 0.2 migration drops them and `rules_on()`; 64 rows to `intel`): two tables fewer, nothing computed is lost.
   - B. Move to a module `regulation`: the tables survive for a future `compliance` module, and the open repository keeps maintaining law.
   - C. Keep them in the core: no work now, the catch-all stays.
   - **Recommendation: A** — no function, module or example reads them today (§2.3); a `compliance` module can define its own tables when it exists.

2. **What reference stays in a pack?**
   - A. One per value: `source_code` (a `sources` row, with a new kind for a published text) and `reference` (article, table, page): Ekwo's register, limited to what the pack holds.
   - B. Nothing: values without a cited origin, review impossible from the pack.
   - C. Keep `legal_sources` as a separate register: two registers for one question.
   - **Recommendation: A** — every value stays checkable, and one register cites a law and an API alike.

3. **Where do country tasks go?**
   - A. Generic templates in `modules/tasks` (about a dozen, country null), none in packs, `legal_source_code` replaced by a free `reference`.
   - B. A plus an optional country overlay outside the pack (installation or private package).
   - C. Keep per-country templates in packs (44 rows today).
   - **Recommendation: B** — a study or a sizing is the same everywhere, the five duplicated templates (F6) are written once, and a step only one country has stays possible without entering the open pack.

4. **Where is a country default stored?**
   - A. One `defaults` table (pack rows by country and region, organisation rows), `attributes` for projects, sites, participants and devices.
   - B. Columns on `countries` and `organisations`, as Ekwo's `country_defaults`: a migration for every new parameter.
   - C. A `jsonb` settings column per level: no unit, no source, no validity.
   - **Recommendation: A** — one table and the existing attributes cover every level; a new parameter is a `property_defs` row, not a migration.

5. **One resolution function, and is there a global level?**
   - A. `parameter_of()` resolves object → parents → organisation → region → country, else `parameter_missing`; method constants live in module profiles.
   - B. Same, with a core row (`country` null) as last fallback: a number the model chose for every country.
   - C. Keep each module resolving its own parameters (as `weather.source_for()`): one order per module.
   - **Recommendation: A** — one order, a named refusal and the level it came from, and no silent fallback, as Ekwo's second rule.

6. **Which file format for a pack?**
   - A. JSON with a published JSON Schema, compiled into a committed seed by `nexgen-os pack build`, checked by `pack check` (Ekwo 0025): a compiler to write in `packages/cli`.
   - B. Keep hand-written SQL seeds, made idempotent with `on conflict`: no tool, no schema check, no checksum.
   - **Recommendation: A** — the check of §4.6 needs a parsed pack anyway, and contributors read JSON more easily than SQL.

7. **How is a pack versioned and upgraded?**
   - A. `countries` records version, checksum and certification; the seed upserts by natural key; a value is never edited (new row with `valid_from`, `valid_to` on the old).
   - B. Keep loading each seed file once (F3): a new pack version reaches no installation.
   - **Recommendation: A** — the installation knows what it holds, and a run replayed at its date reads the value it read.

8. **Do packs carry market values (energy prices, grid fees)?**
   - A. Yearly reference values from a public statistic, dated and cited; organisations and projects override them.
   - B. None: every organisation enters its own, and a first study in a new country has no price.
   - C. A connector feed: fresher, but a dependency for a default.
   - **Recommendation: A** — a dated, cited yearly value is a fair starting point, and capex and supplier prices stay at organisation level.

9. **Who lists the regions of a country?**
   - A. The pack lists the subdivisions at its region level (3 for Belgium, about 100 departments for France).
   - B. A core seed of every ISO 3166-2 code (a few thousand rows), most of them unused.
   - **Recommendation: A** — a pack only names the regions its rows and its sites use.

## Hand-offs

| To | Point | Why it is theirs |
|---|---|---|
| `audit-core` | the count of `nexgen` tables after this proposal: −`legal_sources`, −`rules`, +`countries`, +`regions`, +`defaults`; `grid_operators` in the core or in a future `grid` module (`modules/README.md:46`) | the shape of the core |
| `audit-core` | `meters.grid_operator_id` references `contacts` (`core_grid.sql:31`) while packs fill `grid_operators`: one notion, two tables | factoring of the key objects |
| `audit-core` | `organisations` is not an object, so an organisation cannot hold attributes; this proposal gives it rows in `defaults` instead | whether organisations join `objects` |
| `audit-core` | `projects.kind` is free text (0017, "Open"), and generic task templates match on it | vocabulary of the core |
| `audit-layout-doctrine` | decisions to write: "a pack holds what a function reads", "one cascade of defaults", and the parts of 0009 and 0017 they supersede; the `pack build` / `pack check` commands of `packages/cli` | doctrine and layout |
| `audit-layout-doctrine` | `formats/geocoding/ban.ts` and `belgium.ts` carry a country in their names and hard-code the chain a pack could order; F1 (merge marker in `packs/README.md`) | the formats folder and the README |
| `audit-series` | `metering_step` and the default time zone of a country feed the series package (`time_zone_required`, `core_series.sql:253`); `bidding_zone` keys price series | storage and API of series |
