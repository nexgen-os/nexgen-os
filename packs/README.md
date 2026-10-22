# `packs/` — one folder per country

A pack is the few values a country decides that a function of the model reads:
who the country is, how it numbers things, where its data is, who runs its
grid, and the defaults a study starts from. Every row has a reader in the core
or in a module, and every value carries its unit and the source it was read
from. A pack never holds code, law in words, task lists, prices that change
within a year, or anything of one installation; the commentary on a country's
law is not part of the open model. No country is the default.

```
packs/xa/
├── pack.json         version, certification, checksum, sections, identity (countries, regions)
├── identifiers.json  id_schemes: each scheme with a pattern and an example that matches
├── sources.json      sources: registers, geocoders, hubs, statistics, published texts
├── grid.json         grid.operators; voltage levels and connection thresholds as defaults
├── defaults.json     defaults: property, value, unit, region, validity, source, reference
└── README.md         what is decided, what is null and why, who checked it
supabase/seed/10_pack_xa.sql   compiled by `nexgen-os pack build xa`, committed
```

| Section | Fills | Required |
|---|---|---|
| identity (in `pack.json`) | `countries`, `regions` | yes |
| `identifiers` | `id_schemes` | when the country has schemes of its own |
| `sources` | `sources` | yes: at least the texts its values cite |
| `grid` | `grid.operators`, `defaults` | when the pack describes energy (and names the `grid` module) |
| `defaults` | `defaults` | yes |

Every file is described by the published schema
[`schema/pack.1.json`](schema/pack.1.json). A pack cannot execute: no
expression, no script, no hook — a value, a unit, a reference. A row that
holds in part of the country names its regions (ISO 3166-2), declared in the
identity. A value that depends on the company, a contract or an option is
`null` with its reference. Nothing is deleted: a value that changes gets a
`valid_to`, and the new value is a new row starting that day.

## Build and check

`nexgen-os pack build <cc>` validates the pack, compiles it into
`supabase/seed/<seed_sequence>_pack_<cc>.sql` and writes its checksum into
`pack.json`. The seed upserts every row by its natural key, so applying it
again changes nothing and a new version reaches an installation that holds an
older one; `countries` records the version, the checksum and the
certification. The database refuses, by name, a value edited in place
(`value_edited`), an unknown property (`attribute_type_unknown`) and a unit that is
not the property's (`unit_mismatch`).

`nexgen-os pack check --all`, run by the CI, refuses:

- a file that fails the schema, a section listed and absent, a JSON file not listed;
- executable content anywhere (`pack_executable`);
- a default without a unit or without a reference;
- a region a row names and the identity does not declare;
- an identifier pattern that does not compile or does not match its example;
- a value citing a source the pack does not declare, two values of one
  property and region at once, a period that ends before it starts;
- a committed seed or a checksum that is not the exact output of its pack;
- two packs on one seed number, or one code published by two packs.

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
| [`fr`](fr/README.md) | 0.3.0, `community`: compiled into `supabase/seed/10_pack_fr.sql` |
