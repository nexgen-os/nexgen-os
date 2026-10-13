# `@nexgen-os/homeassistant` — Home Assistant ⇄ Nexgen OS

Maps a Home Assistant instance — its floors, areas, devices, entities and
the states its recorder keeps — onto a Nexgen OS building, and back, with no
field lost. MIT, like every format library.

| Home Assistant | Nexgen OS | Notes |
|---|---|---|
| floor | `architecture.floors` | `level` = the floor's level, or its rank |
| area | `architecture.spaces` | on its floor's level; straight in the building when it has no floor |
| device | `devices` | type `sensor_box`; manufacturer, model, serial number as columns; identifiers, connections, versions, `via_device_id` in `metadata.ha` |
| entity | `sensors` | host = its device, else its area, else the building; `external_ref` = `homeassistant://<entity_id>` |
| `device_class` + unit | `quantity_code` | temperature °C, humidity %, CO₂ ppm, power W/kW, energy Wh/kWh/MWh, battery %, irradiance W/m², volume and gas m³, occupancy; any other pair gets a quantity of its own, published by the library |
| `state_class` | `series.value_kind` | `measurement` → `instant`; `total`, `total_increasing` → `cumulative` |
| domain | `sensors.kind` | `number`, `climate`, `water_heater` → `setpoint`; `switch`, `light`, `cover`, `button`… → `command`; the rest → `sensor` |
| state | `series_values` | in the quantity's unit (W → kW); `on`/`off` → 1/0; `unavailable` / `unknown` → quality code 3, `missing` |

Everything else an entity carries — `unique_id`, `platform`, `icon`,
`entity_category`, `disabled_by`, original name and class, the original unit
and the factor applied — travels in `sensors.metadata.ha`, so that
`exportHomeAssistant()` returns the registry exactly as `importHomeAssistant()`
received it. The one thing the round trip flattens: `unknown` comes back as
`unavailable`.

```ts
import { importHomeAssistant, exportHomeAssistant } from './formats/homeassistant/index.js';

await importHomeAssistant(db, { organisationId, siteId, buildingId }, snapshot);
const again = await exportHomeAssistant(db, buildingId); // deep-equals snapshot
```

The library speaks SQL only, through a one-method `Db` interface, so it runs
on PGlite, node-postgres or postgres.js, on a connection whose search path
holds `nexgen`. Needs the `architecture` module.
