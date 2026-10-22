# `packs/` — one folder per country

A pack is the few values a country decides that a function of the model reads:
who the country is, how it numbers things, where its data is, who runs its
grid, and the defaults a study starts from. Every row has a reader in the core
or in a module, and every value carries its unit and the source it was read
from. A pack never holds code, law in words, action lists, prices that change
within a year, or anything of one installation; the commentary on a country's
law is not part of the open model. No country is the default.

```
packs/xa/
├── pack.json         version, certification, checksum, sections, identity (countries, regions)
├── identifiers.json  identifier_schemes: each scheme with a pattern and an example that matches
├── sources.json      sources: registers, geocoders, hubs, statistics, published texts
├── project_kinds.json  project_kinds: the frames of projects the country's law defines
├── municipalities.json regions of kind municipality, with their density class as defaults
├── grid.json         grid.operators (regions, municipalities, identifier prefixes, EIC code,
│                     how its hub publishes meter data: `meter_data`);
│                     voltage levels and connection thresholds as defaults;
│                     grid.support_schemes (eligibility, duration, negative-price rules)
├── defaults.json     defaults: attribute type, value, unit, region or municipality, condition,
│                     validity, source, reference
├── golden/<case>/    scenario.json and expectations.json: one case per kind of project
│                     and the figures an installation must find from it
└── README.md         what is decided, what is null and why, who checked it
supabase/seed/10_pack_xa.sql   compiled by `nexgen-os pack build xa`, committed
```

| Section | Fills | Required |
|---|---|---|
| identity (in `pack.json`) | `countries`, `regions` | yes |
| `identifiers` | `identifier_schemes` | when the country has schemes of its own |
| `sources` | `sources` | yes: at least the texts its values cite |
| `project_kinds` | `project_kinds` | when the country's law defines frames of projects (a collective self-consumption, an energy community) |
| `municipalities` | `regions` (kind `municipality`), `defaults` (`density_class`) | when a value or an operator follows a municipality |
| `grid` | `grid.operators`, `grid.support_schemes`, `defaults` | when the pack describes energy (and names the `grid` module) |
| `defaults` | `defaults` | yes |

Every file is described by the published schema
[`schema/pack.1.json`](schema/pack.1.json). A pack cannot execute: no
expression, no script, no hook — a value, a unit, a reference. A row that
holds in part of the country names its regions (ISO 3166-2), declared in the
identity, or a municipality (`FR-75056`), declared in `municipalities.json`.
A value names its attribute type (`attribute_type`), and one that holds for
some objects only names its `condition`, in the one shape of a condition of
the core — `{"project_kind", "segment", "device_type", "density_class",
"attribute": {"attribute_type", "op", "value"}}`, every key optional, the
same shape as an action template of `actions` — and `parameter_of()` takes
the most specific row the object meets
([0021](../docs/decisions/0021-one-cascade-of-defaults.md),
[0044](../docs/decisions/0044-a-condition-has-one-shape.md)):

```json
{ "attribute_type": "sharing_max_distance_m", "condition": { "project_kind": "fr_acc", "density_class": "rural_town" },
  "value": 20000, "unit": "M", "source_code": "fr_arrete_acc_perimeter", "reference": "Article 1", "valid_from": "2023-10-08" }
```

Every value says what kind of value it is (`status`, [0048](../docs/decisions/0048-a-value-says-what-kind-of-value-it-is.md)):
`published` when its source decides it — the default — `estimated` for a
statistic or a model, `default` for a conventional assumption;
`parameter_of()` returns it with the value.

The market of the country is its defaults, by region or municipality when
the country has several zones: `bidding_zone`, `control_area` (EIC codes),
`imbalance_settlement_period`, read by `grid.market_of()`; the transmission
operator is an operator of kind `tso` with its `eic_code`; the residual mix
of the country is `market_co2_factor`. A support scheme of the country is a
row of `support_schemes` in `grid.json` — its kind, its allocation (open
window or tender), the device types and power range eligible, the duration
of a contract and the dated rules of the obligation to stop at negative
prices (`threshold_kw`, `valid_from`, the text that sets it) — and never its
tariff, which is each contract's
([0049](../docs/decisions/0049-the-market-follows-the-place-a-scheme-is-the-countrys-its-contract-the-devices.md)).

A price is written in the unit of the country's currency
(`EUR-PER-MegaW-HR`), which the core derives from the currency the identity
declares; a currency the core's ISO 4217 list does not hold is added by the
identity's `currency_details` (name, symbol, decimal places), never
updated. The identity may give the `bbox` a map opens on, and each region
its `names` by language, `aliases` and `postal_prefixes`. The perimeter of an
energy sharing operation is a value like any other: `sharing_perimeter`
(the criteria any one of which suffices) with the values the criteria read
(`sharing_max_distance_m`, `sharing_radius_m`,
`sharing_municipality_extension_m`), each for the frame of projects that
decides it; `community.check_perimeter()` reads them. A value that depends on the company, a contract or an option is
`null` with its reference. Nothing is deleted: a value that changes gets a
`valid_to`, and the new value is a new row starting that day.

## Build and check

`nexgen-os pack build <cc>` validates the pack, compiles it into
`supabase/seed/<seed_sequence>_pack_<cc>.sql` and writes its checksum into
`pack.json`. The seed upserts every row by its natural key, so applying it
again changes nothing and a new version reaches an installation that holds an
older one; `countries` records the version, the checksum and the
certification. The database refuses, by name, a value edited in place
(`value_edited`), an unknown attribute type (`attribute_type_unknown`) and a unit that is
not the attribute type's (`unit_mismatch`).

`nexgen-os pack check --all`, run by the CI, refuses:

- a file that fails the schema, a section listed and absent, a JSON file not listed;
- executable content anywhere (`pack_executable`);
- a default without a unit or without a reference;
- a region a row names and the identity does not declare;
- an identifier pattern that does not compile or does not match its example;
- a support scheme or one of its negative-price rules citing a source the pack
  does not declare, a power range that ends below its start, a rule whose
  period ends before it starts;
- a value, a frame or a municipality list citing a source the pack does not
  declare, two values of one attribute type, place and condition at once, a
  period that ends before it starts;
- a municipality under an undeclared region or not matching the
  municipality scheme, a density class the pack does not list;
- a committed seed or a checksum that is not the exact output of its pack;
- two packs on one seed number, or one code (a source, a scheme, an
  operator, a frame of projects, a support scheme) published by two packs;
- a pack without a golden case and without the reason it has none, a case
  whose objects, country, frame, sources or tolerances do not hold.

A pack may list a subset of its municipalities, the ones its values and
operators follow; the full list of a country loads the same way, from a
larger `municipalities.json` or by a connector writing the same `regions`
and `defaults` rows from the statistics office's file.

## Golden cases

A pack carries complete cases, one per kind of project its country knows
([0034](../docs/decisions/0034-a-pack-upgrade-is-never-silent.md)). A case
is a small scenario — an organisation, a project of a kind, its
participants with their segment, municipality and place, their meters and
devices, a few hours of series, the attributes a study would set — and,
beside it, the figures a correct installation must find:

| Section of `expectations.json` | Compared with |
|---|---|
| `defaults` | `parameter_of()`: the value, its level, region or country, its condition and its source; or the refusal (`parameter_missing`) |
| `batteries` | `storage.battery_of()`: each figure of a battery and where it came from |
| `perimeter` | `community.check_perimeter()`: the rule and the verdict of each participant, distances within `tolerance_m` |
| `operators` | `grid.operator_of()`: the operator of a meter and the level that found it, or the refusal |
| `settlement` | `settleSharing()` with the example engine: the energy shared and each participant's share, within `tolerance_kwh` |
| `solar` | the PVWatts model of `solar` on the case's hours, within `tolerance_pct` |
| `kpis` | `kpis.measure()`: the figure within its `tolerance`, how its variables were read, or the refusal |

Every expectation says where its figure comes from (`source`): the row of
the pack, the text, the hand computation. A figure the case shows to be
wrong is reported, never adjusted until the test passes. `tests/golden.test.ts`
replays every case of every pack and names no country; `pack check` reads
the cases without a database and refuses a pack that has none
(`golden_missing`) unless its `pack.json` says why (`"golden": {"exempt": "…"}`).
Start from a case of [`fr`](fr/golden), [`be`](be/golden) or [`es`](es/golden).

## Proposing a pack

Start from the fixture pack
[`tests/fixtures/pack-checkout/packs/xa`](../tests/fixtures/pack-checkout/packs/xa),
which uses every section; fill the identity and the defaults first, cite every
value, run `nexgen-os pack build <cc>` and `nexgen-os pack check --all`, and
open a pull request with the DCO sign-off. A new pack is `community`;
`maintained` when the maintainers keep it; `reviewed` when a named
professional of the country read it, written with the day in `pack.json`.

## Packs

| Pack | State |
|---|---|
| [`be`](be/README.md) | 0.3.0, `community`: compiled into `supabase/seed/11_pack_be.sql` |
| [`es`](es/README.md) | 0.3.0, `community`: compiled into `supabase/seed/12_pack_es.sql` |
| [`fr`](fr/README.md) | 0.3.0, `community`: compiled into `supabase/seed/10_pack_fr.sql` |
