# `modules/` — one Postgres schema each, beside the core

The core is `public`: entities and what is attached to them. What computes
on it lives here, one folder and one schema per module.

## The rules

1. **One schema, and the core is not it.** A module depends on `public` by
   foreign key; the core has no hook and no idea it exists.
2. **Read the core freely, write it through `record_run()`.** A module may
   also publish vocabulary rows (classes, properties, quantities, relation
   types) with `published_by` set to its code.
3. **Row level security on every table**, through `can_read_workspace()` and
   `can_write_workspace()`.
4. **A country is data.** No module names one; what a country decides is in
   its pack.
5. **The registry is a table.** The last statement of a module's first
   migration writes its row into `public.modules`.
6. **A module declares its inputs and outputs**, typed and with units, so
   that a run can be reproduced and compared.

## Planned modules

| Module | Computes |
|---|---|
| `energy` | PV production, consumption profiles, self-consumption, energy sharing with allocation keys, batteries, EV charging, flexibility |
| `thermal` | envelope, heat losses, heating and cooling needs |
| `ems` | real-time control, battery dispatch, demand response — by connecting to existing energy management systems |
| `compliance` | requirement checks against country packs (permits, solar obligations, protected zones) |
| `construction` | commissioning of equipment, site progress |
| `participation` | public consultation: read-only exports and portals |
| `capture` | drone and scan surveys, photogrammetry jobs, point cloud registration |
