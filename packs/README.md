# `packs/` — one folder per country

A country is data: everything that varies from one country to the next,
written so that a professional can read it, a contributor can propose it
and a test can prove it. No country is the default, and no feature is
limited to one. A pack never holds code that says "if the country is X";
it holds rows: what the law of the country says, where it says it, and the
registers and operators of the country. Like a country pack of Ekwo OS, it
is structured information on the regulation, with its legal sources. The
code that reads a national service — an address register, a grid hub — is a
format library or a connector, never part of the pack.

```
packs/fr/
├── pack.json            country, name, version, what sections it carries
├── README.md            what the pack says, with its sources, and who checked it
└── seed/*.sql           its rows, one file per section, loaded in order
tests/packs-fr.test.ts   picked up by the root `npm test`
```

| Section | What it holds | Serves |
|---|---|---|
| `identifiers` | national identifier schemes and their patterns: building or parcel, metering point, company | `id_schemes` |
| `sources` | national APIs and datasets — cadastre, address register, 3D city model, LiDAR, grid operators' hubs, company register — with licence, attribution, retention | `sources`, and the adapters that read them |
| `addresses` | the fields a country requires, the postal code pattern, the regions that matter for its rules | a `rules` row, decision 0009 |
| `legal` | the texts the rules come from — codes, laws, decrees, orders, deliberations, standards — with their official reference and the consolidated text online | `legal_sources` |
| `grid` | distribution and transmission operators and their areas, the bidding zone, the metering step, the components of the network tariff, connection and conformity | `grid_operators`, `rules`; the `grid` module later |
| `energy_sharing` | the legal forms of a community, the allowed perimeter and power, the admitted allocation keys, the convention and the settlement steps | `rules`; the `sharing` module later |
| `compliance` | planning authorisations by power, environmental assessment, solar obligations, tertiary energy, energy labels and their thresholds | `rules`; the `compliance` module later |
| `support` | purchase obligations, premiums and tenders, with their ceilings | `rules` |
| `data` | what a third party may read of a customer's meter data, under which consent | `rules` |
| `tasks` | what has to be done for a kind of project, by phase and role, with the legal reference, the expected documents and the condition: the templates `tasks.plan()` instantiates | `tasks` module |
| `mappings` | the attributes of the national 3D model or cadastre to the core's properties and profiles | `property_defs`, `attributes`, format libraries |
| `series` | the hub's quality codes to the core's four, raw retention, the standard reading step, time zones when there are several | `series`, decision 0007 |
| `examples` | one loadable dataset of the country — a building, a meter, a community — with the figures expected | `tests/` |

A row of a pack that applies to part of the country says so: `regions`
(ISO 3166-2) or the municipality codes it lists, or a geometry when only a
map says it ([0009](../docs/decisions/0009-addresses-and-geocoding.md),
"the regional level"). Belgium is the usual example: one address register,
one grid operator and one rule set per region.

Out of a pack: computations (modules, generic), formats and geocoders
(libraries, by format), the law's text itself (a pack points to it and
encodes the rule), and anything of one installation (keys, private
connectors). A rule carries its `notes` when a reading is to be confirmed
or a change is announced: a pack says what it knows and what it doubts.

## Packs

| Pack | Sections | Checked by |
|---|---|---|
| [`be`](be/README.md) | identifiers, sources, legal (11 texts), tasks (23 templates: roof PV, energy community, by region) | — |
| [`fr`](fr/README.md) | identifiers, sources, addresses, legal (15 texts), grid (8 operators, 5 rules), energy_sharing (12 rules), compliance (14 rules), support (3), data (1), tasks (21 templates: roof PV, energy community) | — |
