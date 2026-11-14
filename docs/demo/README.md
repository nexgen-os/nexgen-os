# `docs/demo/` — one story per domain, loadable as is

Each file is a complete, self-contained dataset: an organisation, a
project, its participants with their place, their meters and the devices
behind them, with the `building` module their buildings and the spaces
inside, the series the devices read, attachments, and the queries a page would
run on it. They load on a fresh database after the core migrations, the
core vocabularies and the modules they name in their first line (`building` for
the ground, buildings, spaces and roof faces of a participant,
`grid` for the operator of a connection point, `community` for energy
sharing, `billing` for the invoicing side), and the
test suite loads every one of them (`tests/demo.test.ts`).

Identifiers are fixed (`00000000-0000-4000-8000-000N…`, N = the example),
so that the queries at the end of each file can be copied as they are.

| File | Domain | Country | What it shows |
|---|---|---|---|
| `01-house-pv-battery.sql` | residential energy | ES | a house as one participant with its place and its meter, a PV system behind the meter, an inverter and a smart meter whose registers are series, a day of 15-minute production, a planned battery, the monthly estimate PVGIS published as a series of that source; core only |
| `02-school.sql` | building description, building automation | BE | the municipality as the participant, floors and rooms as spaces of the `building` module, the building's year, floor area and energy label in its columns, a multisensor per classroom whose temperature, CO₂ and presence are series named after the room, heating setpoints asked of the heat pump |
| `03-energy-community.sql` | energy sharing | NL | a project, four participants carrying their place and their meter, the companies who answer for them and their Ekwo contacts, a group, a producer |
| `04-farm-solar.sql` | agriculture, ground and carport PV | FR | a farm as one participant, PV on roof, ground and carport, import and export meters carried by the farm, a PVGIS estimate of `solar` (`solar.estimates`) with the orientation it assumed (the GeoJSON test adds its barn, stable, field and car park with `building`) |
| `05-district-open-data.sql` | city, open data | SN | a district plan with a perimeter, six participants with their plots (`building.sites`) and buildings known by OpenStreetMap ids and floors in a projected CRS, a plot the cadastre split into two |
| `06-drone-survey.sql` | capture, 3D | IT | a client's place surveyed by drone, the client as the participant of the study: orthophoto, video and photos as documents, roof faces of the `building` module measured from the survey with their source, a point cloud kept as a document |
| `07-office-heating.sql` | heating, thermal | DE | an office with its facades' U-values (`building`), a boiler and a heat pump behind their meters, a setpoint and a flow temperature as series, a second heat pump planned to replace the boiler and the insulation design as a document |

`yield.ts` is not a dataset: it computes the yield of a PV system as an estimate and
reads it back by month, the twenty-minute path of the
[README](../../README.md#twenty-minutes-to-the-same-house-with-its-yield).

`compared.ts` is not a dataset either: it computes the yield of one PV system by
several methods and gives the gap between them, [below](#one-roof-three-programs).

## One roof, three programs

The same PV system, its yield computed three ways, month by month, in the
participant's local year. Each yield is an estimate of the `solar` module,
kept in `solar.estimates` with what it was computed from; `compared.ts` only
reads them back and divides.

```bash
npx tsx docs/demo/compared.ts <pv system id> 2023                     # PVGIS and PVWatts
npx tsx docs/demo/compared.ts <pv system id> 2023 --engine pvlib      # and PVWatts computed by pvlib
npx tsx docs/demo/compared.ts <pv system id> 2023 --reference report.json
```

With `--reference`, the gaps are taken against another tool's report — a
PVsyst or PV*SOL simulation of the same system — given as a file
`{ "name": "PVsyst 8.0", "source": "<the report, its date>", "monthly_kwh": [12 energies] }`.
The figures are the report's, copied from it with their source; nothing
here estimates them.

The case below is a 1 kWp roof in Brussels (50.85° N, 4.35° E), facing
south at 35°, mounted on the roof, in 2023 (Europe/Brussels):

| Month | PVGIS (kWh) | PVWatts (kWh) | PVWatts by pvlib (kWh) | PVWatts vs PVGIS |
|---:|---:|---:|---:|---:|
| 1 | 28.0 | 38.1 | 38.1 | +36.1 % |
| 2 | 56.5 | 61.3 | 61.3 | +8.5 % |
| 3 | 71.6 | 76.1 | 76.1 | +6.3 % |
| 4 | 99.3 | 111.4 | 111.4 | +12.2 % |
| 5 | 136.1 | 139.6 | 139.6 | +2.6 % |
| 6 | 150.6 | 156.2 | 156.2 | +3.7 % |
| 7 | 113.5 | 124.9 | 124.9 | +10.0 % |
| 8 | 107.1 | 126.3 | 126.3 | +17.9 % |
| 9 | 105.1 | 109.7 | 109.7 | +4.4 % |
| 10 | 62.7 | 76.0 | 76.0 | +21.2 % |
| 11 | 30.2 | 37.5 | 37.5 | +24.2 % |
| 12 | 17.2 | 24.3 | 24.3 | +41.3 % |
| **Year** | **977.9** | **1,081.4** | **1,081.4** | **+10.6 %** |

- **PVGIS** (`pvgis_like`): PVGIS 5.3 computes, on its SARAH3 satellite
  irradiance, with the horizon of its elevation model and one aggregate
  loss of 14 %.
- **PVWatts** (`pvwatts`): the module computes, on the ERA5 reanalysis read
  from the Open-Meteo archive, the real year 2023 (no typical year, no
  anchoring), a Faiman cell temperature, the PVWatts DC model with the
  temperature coefficient of PVWatts v5's standard module (−0.37 %/°C) and
  the same 14 % loss.
- **PVWatts by pvlib**: the same profile computed by pvlib 0.16.1 through its
  connector. It gives the module's figures to the tenth of a kWh every month:
  two programs, one model.

**Where the 10.6 % comes from.** Not from the light: in the plane of the
array, PVGIS reads 1,287 kWh/m² in the year and ERA5 1,267 kWh/m², 1.6 % less.
It comes from what the `pvwatts` profile does not model, which its row of
`solar.yield_profiles` names: no inverter efficiency, no incidence angle
losses, no spectrum, no horizon in the hourly shape. Its performance ratio
is 0.854, PVGIS's 0.760. The gap is largest in winter, when the light is
low and comes at grazing angles, which is where reflection on the glass and
a far horizon weigh most. A figure for a client is computed with a profile
that models them (`pvsyst_like` through pvlib, with the module's physics),
or anchored on PVGIS (`anchor: 'pvgis'`).

`tests/compared-yields.test.ts` runs this case on the answers of PVGIS and
of the Open-Meteo archive recorded for it (`tests/fixtures/compared/`), and
holds it: the table as printed, the gap under 12 % on the year and under
20 % every month from April to September, the two irradiations within 3 %.
A change of a method that moves a figure shows there first.

Run one by hand with PGlite from the repo root:

```bash
node --input-type=module -e "
import { freshDatabase } from './tests/helpers/db.ts';
import { readFile } from 'node:fs/promises';
const db = await freshDatabase();
await db.exec(await readFile('docs/demo/01-house-pv-battery.sql', 'utf8'));
console.log((await db.query('select name, city, country from participants order by name')).rows);
"
```
