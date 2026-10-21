# `@nexgen-os/homeassistant` — Home Assistant ⇄ plain shapes

Reads what a Home Assistant instance exports — its floors, areas, devices,
entities and the states its recorder keeps — into plain shapes any tool can
use, and writes the shapes back, with no field lost. MIT; no dependency.

| Home Assistant | Shape | Notes |
|---|---|---|
| floor | `HomeSpace`, kind `floor` | `level` as the file says it, or null |
| area | `HomeSpace`, kind `room` | `parent` = its floor, or null |
| device | `HomeDevice` | `name` = the name a person gave it, else its own; manufacturer, model, serial number; `space` = its area |
| entity | `HomePoint` | `device`, `space`; `deviceClass` and `unit` as stated; `role` from the domain (`number`, `climate`, `water_heater` → `setpoint`; `switch`, `light`, `cover`, `button`… → `command`; the rest → `measured`); `valueKind` from the state class (`total`, `total_increasing` → `cumulative`, else `instant`); `binary` for on/off domains |
| state | `HomeReading` | `on`/`off` → 1/0; `unavailable`, `unknown` or not a number → `null` |

Every field a shape has no field for (icons, aliases, identifiers,
connections, versions, `via_device_id`, `unique_id`, `platform`,
`entity_category`, `disabled_by`, original names and classes) travels in
its `extra`, so that `writeHomeAssistant(readHomeAssistant(s))` deep-equals
`s`. The one thing the round trip flattens: `unknown` comes back as
`unavailable`.

```ts
import { readHomeAssistant, writeHomeAssistant } from '@nexgen-os/homeassistant';

const home = readHomeAssistant(snapshot); // { spaces, devices, points }
const again = writeHomeAssistant(home);   // deep-equals snapshot
```

What it never does: convert a unit, guess a quantity, open a connection or
call Home Assistant. Into Nexgen OS, `importHomeAssistant()` of the `building`
module (`modules/building/src`) writes the shapes for a participant — spaces
of its building through `building.add_space()`, devices under the
participant through `install_device()`, their area kept in their metadata,
one series per point
through `series_ensure()`, the readings through `store()` converted by the
`units` vocabulary — and `exportHomeAssistant()` reads them back.
