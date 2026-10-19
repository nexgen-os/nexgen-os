# `grid` — connection points, and who runs the grid

Status: shipped with schema 0.2. Schema: `grid`.

A meter, in the sense of the grid, is a connection point to a network: the
identifier its operator knows, on a site, with what it can do (take, inject,
both) and the period that identifier names that point (IEC CIM
*UsagePoint*). The physical meter is a device of the core, of type `meter`,
and can be swapped; the devices behind a connection point say so with a
`behind_meter` link, dated like any link.

| Table / function | Holds / does |
|---|---|
| `grid.operators` | the distribution and transmission operators of a country, what they cover, where a third party reads meter data with the customer's consent, and the identifier scheme of the metering points they issue; written by the country packs |
| `grid.meters` | connection points: identifier and scheme (checked against the scheme's pattern), resource, direction, operator, validity; an object, so attributes, documents and series attach to it |
| `grid.declare_meter()` | declares a connection point on a site; refuses `invalid_identifier`, `meter_already_open` |
| `grid.close_meter()` | ends the period an identifier names a point; refuses `meter_not_open` |

Install: `npx nexgen-os init --modules grid`.
