# `examples/` — one story per domain, loadable as is

Each file is a complete, self-contained dataset: an organisation, its places,
grid side, devices, sensors, series, attachments, and the queries a page
would run on it. They load on a fresh database after the core migrations,
the core vocabularies and the modules they name, and the test suite loads
every one of them (`tests/examples.test.ts`).

Identifiers are fixed (`00000000-0000-4000-8000-000N…`, N = the example),
so that the queries at the end of each file can be copied as they are.

| File | Domain | Country | What it shows |
|---|---|---|---|
| `01-house-pv-battery.sql` | residential energy | ES | a house, two roof faces, a PV system behind the meter, a day of 15-minute production, an energy label over time, a battery in a scenario, a run |
| `02-school-architecture.sql` | architecture, building automation | BE | floors and rooms (`architecture` module), temperature / CO₂ sensors and heating setpoints per room, a heat pump serving the building |
| `03-energy-community.sql` | energy sharing | NL | a project, four sites behind their meters, the companies who answer for them, a group, a producer, a register read as an index |
| `04-farm-solar.sql` | agriculture, ground and carport PV | FR | a farm with a barn, a stable, a field and a car park, PV on roof, ground and carport, import and export meters, a PVGIS estimate as a run |
| `05-district-open-data.sql` | city, open data | SN | a district plan with a perimeter, buildings known by OpenStreetMap ids in a projected CRS, a plot split, a shading link |
| `06-drone-survey.sql` | capture, 3D | IT | a site surveyed by drone: orthophoto, video and photos as documents, roof faces measured from the survey with their source, a point cloud announced for the `3d` module |
| `07-office-heating.sql` | heating, thermal | DE | an office with its facades' U-values, a boiler and a heat pump, setpoints, a scenario replacing the boiler |

Run one by hand with PGlite from the repo root:

```bash
node --input-type=module -e "
import { freshDatabase } from './tests/helpers/db.ts';
import { readFile } from 'node:fs/promises';
const db = await freshDatabase(['architecture']);
await db.exec(await readFile('examples/02-school-architecture.sql', 'utf8'));
console.log((await db.query('select kind, count(*)::int n from objects group by kind order by kind')).rows);
"
```
