# `examples/` — one story per domain, loadable as is

Each file is a complete, self-contained dataset: an organisation, a
project, its participants with their place, their meters and the devices
behind them, with the `building` module their buildings and the spaces
inside, the series the devices read, attachments, and the queries a page would
run on it. They load on a fresh database after the core migrations, the
core vocabularies and the modules they name in their first line (`building` for
the ground, buildings, spaces and roof faces of a participant,
`grid` for the operator of a connection point, `community` for energy
sharing, `billing` for the invoicing side), and the
test suite loads every one of them (`tests/examples.test.ts`).

Identifiers are fixed (`00000000-0000-4000-8000-000N…`, N = the example),
so that the queries at the end of each file can be copied as they are.

| File | Domain | Country | What it shows |
|---|---|---|---|
| `01-house-pv-battery.sql` | residential energy | ES | a house as one participant with its place and its meter, a PV system behind the meter, an inverter and a smart meter whose registers are series, a day of 15-minute production, a planned battery, the monthly estimate PVGIS published as a series of that source; core only |
| `02-school.sql` | building description, building automation | BE | the municipality as the participant, floors and rooms as spaces of the `building` module, the building's year, floor area and energy label in its columns, a multisensor per classroom whose temperature, CO₂ and presence are series named after the room, heating setpoints asked of the heat pump |
| `03-energy-community.sql` | energy sharing | NL | a project, four participants carrying their place and their meter, the companies who answer for them and their Ekwo contacts, a group, a producer |
| `04-farm-solar.sql` | agriculture, ground and carport PV | FR | a farm as one participant, PV on roof, ground and carport, import and export meters carried by the farm, a PVGIS estimate as a run of `solar` with the orientation it assumed (the GeoJSON test adds its barn, stable, field and car park with `building`) |
| `05-district-open-data.sql` | city, open data | SN | a district plan with a perimeter, six participants with their plots (`building.sites`) and buildings known by OpenStreetMap ids and floors in a projected CRS, a plot the cadastre split into two |
| `06-drone-survey.sql` | capture, 3D | IT | a client's place surveyed by drone, the client as the participant of the study: orthophoto, video and photos as documents, roof faces of the `building` module measured from the survey with their source, a point cloud kept as a document |
| `07-office-heating.sql` | heating, thermal | DE | an office with its facades' U-values (`building`), a boiler and a heat pump behind their meters, a setpoint and a flow temperature as series, a second heat pump planned to replace the boiler and the insulation design as a document |

`yield.ts` is not a dataset: it runs the yield of a PV system as a run and
reads it back by month, the twenty-minute path of the
[README](../README.md#twenty-minutes-to-the-same-house-with-its-yield).

Run one by hand with PGlite from the repo root:

```bash
node --input-type=module -e "
import { freshDatabase } from './tests/helpers/db.ts';
import { readFile } from 'node:fs/promises';
const db = await freshDatabase();
await db.exec(await readFile('examples/01-house-pv-battery.sql', 'utf8'));
console.log((await db.query('select name, city, country from participants order by name')).rows);
"
```
