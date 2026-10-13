# `packs/` — one folder per country

A country is data: everything that varies from one country to the next,
written so that a professional can read it, a contributor can propose it
and a test can prove it. No country is the default, and no feature is
limited to one. A pack never holds code that says "if the country is X";
it holds rows, mappings and the adapters of its national services.

```
packs/fr/
├── pack.json            country, name, version, what sections it carries
├── README.md            what the pack says, with its sources, and who checked it
├── seed/*.sql           its rows: identifier schemes, sources, mappings
├── geocoding.ts         the adapter of its national address register
└── tests/*.test.ts      picked up by the root `npm test`
```

| Section | What it holds | Serves |
|---|---|---|
| `identifiers` | national identifier schemes and their patterns: building or parcel, metering point, company | `id_schemes` |
| `sources` | national APIs and datasets — cadastre, address register, 3D city model, LiDAR, grid operators' hubs, company register — with licence, attribution, retention | `sources`, and the adapters that read them |
| `addresses` | the fields a country requires, the postal code pattern, the regions that matter for its rules | decision 0009 |
| `grid` | distribution and transmission operators and their areas, market and balancing zones, tariff components, what a data mandate requires | `grid` module |
| `energy_sharing` | the legal forms of a community, the allowed perimeter, the admitted allocation keys, settlement steps and roles | `energy` module |
| `compliance` | solar obligations, permit thresholds, protected zones and heritage, energy labels and their thresholds | `compliance` module |
| `mappings` | the attributes of the national 3D model or cadastre to the core's properties and profiles | `property_defs`, `attributes`, format libraries |
| `series` | the hub's quality codes to the core's four, raw retention, the standard reading step, time zones when there are several | `series`, decision 0007 |
| `examples` | one loadable dataset of the country — a building, a meter, a community — with the figures expected | `tests/` |

A row of a pack that applies to part of the country says so: `regions`
(ISO 3166-2) or the municipality codes it lists, or a geometry when only a
map says it ([0009](../docs/decisions/0009-addresses-and-geocoding.md),
"the regional level"). Belgium is the usual example: one address register,
one grid operator and one rule set per region.

Out of a pack: computations (modules, generic), formats (libraries, by
format), the law's text itself (a pack points to it and encodes the rule),
and anything of one installation (keys, private connectors).

## Packs

| Pack | Sections | Checked by |
|---|---|---|
| [`fr`](fr/README.md) | identifiers, sources, geocoding (BAN) | — |
