# `@nexgen-os/pvsol` — a PV\*SOL study → a plain project

Reads the `.pvprj` file PV\*SOL premium (Valentin Software) saves — a study
of a PV system on a roof or a ground — into plain shapes: the project, its
arrays with their orientation and modules, its inverters, the load profile
the designer imported, the losses, and the results PV\*SOL simulated. Read
only: a study is never written. MIT; no dependency, no database, no network.

```ts
import { readFile } from 'node:fs/promises';
import { readPvsolStudy } from '@nexgen-os/pvsol';

const study = readPvsolStudy(new Uint8Array(await readFile('warehouse.pvprj')));
study.arrays;            // [{ name, tilt_deg, azimuth_deg, module_count, module, power_kwp, results }]
study.results?.production_kwh;
study.problems;          // what the study lacks or what disagrees inside it, by name
```

A `.pvprj` file is a ZIP archive. What is read in it was settled on studies
PV\*SOL premium 2025 and 2026 saved (`PVSOL_TESTED_PROGRAMS`); a study of
another version reads, with the warning `program_untested`.

| In the archive | Read as | Notes |
|---|---|---|
| `Project.xml`, `ProjektdatenV1` | `project`: title, author, commissioning date, address of the system, customer | the date as `YYYY-MM-DD` from .NET's invariant culture (month first); the address lines joined by commas |
| `Project.xml`, `PVModule/Modulfelder` | `arrays`: id, name, `tilt_deg`, `azimuth_deg`, `module_count`, `module` | the azimuth in degrees clockwise from true north, as PV\*SOL writes it and as Nexgen OS keeps it; an array without a module is left aside (`array_empty`) |
| `DB.json`, `PVModules[].SpecifiedOutputPower` | `module.power_w`, and `power_kwp` of the array | null when the file does not give it (`module_power_missing`) |
| `OecForeCast.json`, `PVLeistung` | `declared_power_kwp` | the arrays adding up to more than 2 % away from it: `power_disagrees` |
| `Project.xml`, `Wechselrichter/Verschaltung/WRObj` | `inverters`: manufacturer, model, count | one entry per model |
| `Project.xml`, `Verbrauch/…/ImportierteProfile` | `load_profile`: `step_minutes`, `values_w`, `declared_total_kwh` | base64 of a gzip stream of float64 little-endian values in watts, one per step from the start of the year; a count or a total that disagrees with the declared one is named (`load_profile_count`, `load_profile_total`) |
| `Project.xml`, losses of the simulation | `losses`: spectral, AC cabling, mismatch, diodes, soiling (fractions), albedo, bifacial | |
| `SimResults.xml` | `results`: production, DC input of the inverters, consumption, self-consumed, offtake and injection in kWh; self-consumption and self-sufficiency rates; monthly global horizontal irradiation and temperature; per array its AC energy, specific yield, performance ratio and monthly plane-of-array irradiation | PV\*SOL writes energies in joules and temperatures in kelvin; the balance of the whole system is the largest of the inverters' balances; a study saved before a simulation has none (`not_simulated`) |
| `*.wbv` | `weather_file`, its name | the weather PV\*SOL licenses: named, never read |
| prices, tariffs, the investment | left out | |

Nothing is computed beyond the units the format defines: a figure the
study does not give is null, and a disagreement inside it is a problem of
`problems` (all warnings), never a correction. The load profile carries no
year: its values follow each other from the start of a year at their step,
and whoever stores them dates them.

## Into the model

`importPvsolStudy()` of [`@nexgen-os/core`](../../core/README.md)
(`src/files/pvsol.ts`), and `nexgen-os project import --file <study.pvprj>
--country <cc>`, give a study to the core: the project and one participant
at the system's address with its inverters through `importProject()`, the
PV system and one array per face, each with its orientation and power,
through `describePvSystem()` of the `solar` module. The country is the
caller's: a study does not say it. Imported again, it finds what is there.

## Refusals

`pvsol_unreadable`: not a ZIP archive, no `Project.xml` in it, or a
`Project.xml` that is not well-formed XML. Everything else is read as far as
it goes, and named in `problems`.
