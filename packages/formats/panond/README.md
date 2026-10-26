# `@nexgen-os/panond` — PAN and OND product files → plain products

Reads the files PVsyst writes and manufacturers publish next to their
datasheets — PAN for a PV module, OND for an inverter, in PVsyst's text
format (version 6 and later) — into a product and its physics. Read only:
a PAN or OND file is never written (decision
[0012](../../../docs/decisions/0012-a-yield-says-what-it-was-computed-from.md)). MIT; no dependency,
no database, no network. The table names the product's fields, and where
the importer of the `solar` module writes them.

| File | Product, and its row in Nexgen OS | Notes |
|---|---|---|
| `Manufacturer`, `Model` | `products.manufacturer`, `model` | a product the catalogue already knows gains its physics |
| PAN `PNom`, `Width` × `Height` | `unit_power_kw`, `unit_surface_m2` | |
| OND `PNomConv` | `unit_power_kw` (AC) | |
| PAN `Gamma`, `muGamma`, `RShunt`, `Rp_0`, `Rp_Exp`, `RSerie`, `muISC`, `NCelS` | `solar.module_products`, model `pvsyst`: `gamma_ref`, `mu_gamma`, `R_sh_ref`, `R_sh_0`, `R_sh_exp`, `R_s`, `alpha_sc` (A/°C), `cells_in_series` | pvlib's keys for `calcparams_pvsyst`; `EgRef` 1.121 eV for silicon |
| PAN `Isc`, `Voc` at `TRef` | `reference`: `isc`, `voc`, `t_ref` | `TRef` 25 °C when the file says none; the importer solves `I_L_ref`, `I_o_ref` from them: see below |
| the whole PAN file | `module_products.metadata.pan` | incidence profile, bifaciality, STC point, dimensions |
| the OND file but its commercial block | `solar.inverter_products`, model `ond`, `parameters` | the file's keys, efficiency curves (`ProfilPIO…`) as `[x, y]` pairs, as pvlib's `read_panond` gives them |
| the OND commercial block | `inverter_products.metadata.ond` | data source, dimensions, remarks |
| `Price`, `Currency`, `PriceDate` | left out | the line between open and paid data runs on prices |

```ts
import { readPan, readOnd } from '@nexgen-os/panond';
import { importProduct } from '../modules/solar/src/products.js'; // the solar module, inside this repository

const module = readPan(panText);
await importProduct(db, module, { organisationId, sourceCode: null, fileName: 'module.PAN' });
await importProduct(db, readOnd(ondText), { organisationId });
```

What it never does: look a product up, write a catalogue, open a
connection. `importProduct()` of the `solar` module
([`modules/solar/src/products.ts`](../../../modules/solar/src/products.ts))
adds the product to `products`, or gives its physics to the one the
catalogue already knows by manufacturer and model, and refuses physics
given twice (`already_imported`). A module imported this way runs as it is
through the pvlib engine (`packages/connectors/pvlib`, DC model `pvsyst`) once an
array names it.

## The diode currents

PVsyst stores the series and shunt resistances and the diode factor, not
the light current and the diode's saturation current. A format library
computes no figure (decision
[0035](../../../docs/decisions/0035-a-format-library-touches-no-database.md)),
so `readPan()` gives the point the file states them by — `Isc` and `Voc`
at `TRef`, in `reference` — and the `solar` module solves them:
`pvsystModel()` of
[`modules/solar/src/products.ts`](../../../modules/solar/src/products.ts),
which `importProduct()` calls, gives the model back the file's Isc and Voc
exactly, and its maximum power within half a percent of `PNom` on the
files tested.

## Refusals

`panond_unreadable` (not a PVsyst text file), `panond_binary_unsupported`
(a binary file of PVsyst before version 6: export it again as text),
`pan_unreadable` / `ond_unreadable` (another kind of object, or a value the
model needs is missing); from the importer, `pan_inconsistent` (the file's
numbers give no diode) and `already_imported` (the product already has its
physics).
