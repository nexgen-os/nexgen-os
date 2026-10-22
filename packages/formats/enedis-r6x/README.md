# `@nexgen-os/enedis-r6x`

The R63 (load curve) and R64 (index) files Enedis publishes, in JSON and in
XML, read into plain series. MIT. No database, no network, no time zone and
no quality table written in the code: the caller gives both.

```ts
import { readR6x } from '@nexgen-os/enedis-r6x';

const file = readR6x(text, {
  timeZone: hub.time_zone,         // the operator's legal time, from the caller's data
  qualityCodes: hub.quality_codes, // nature letter → quality code, `missing` and `none` included
});
for (const s of file.series) console.log(s.prm, s.business, s.physical, s.unit, s.step, s.points.length);
console.log(file.problems);        // by name, never corrected
```

## What it reads

The structure of the R6X guide (Enedis, implementation guide of the
R6X flows, v2.0, 29/11/2023, [enedis.fr/media/3751](https://enedis.fr/media/3751/download)):
`header`, then `mesures[]` per metering point (`idPrm`, `etapeMetier`
`BRUT` or `BEST`, `periode`), each with its quantities `grandeur[]`
(`grandeurMetier` `CONS` taken from the grid or `PROD` injected into it;
`grandeurPhysique` `PA` active power, `PRI` / `PRC` reactive power
inductive / capacitive, `E` voltage, `EA` active energy; `unite` `W`, `VAr`,
`V`, `Wh`) and:

- for a load curve (R63), `points[] { v, d, p, n, tc, iv, ec }`: the value,
  the date, the step, the nature letter, the correction type, the likelihood
  index and the additional state;
- for an index (R64), the readings of each dial,
  `calendrier[].classeTemporelle[].valeur[] { d, v, iv }`.

The XML form is read by the same element names as the JSON.

## Time

**An R63 dates each step at its start, in the legal time of the operator,
without an offset.** The reader turns each stamp into the start of the step
in UTC with the zone the caller gives (`time_zone_required` without one).
The day the clocks go forward has two steps fewer an hour; the day they go
back writes the repeated hour twice, and only **the order of the lines**
tells the two apart: of the two instants a repeated stamp names, the reader
takes the first after the previous line. A stamp that carries an offset is
read with it.

The web services of the same operator date a step at its **end**, with an
offset: that convention is the SOAP answer's, read by its connector
(`@nexgen-os/enedis-sge`), never here.

A load curve has one point per step of its period (`periode`, local days,
`dateFin` excluded): a step the file does not carry comes back as a point
whose value is `NaN`, with the quality the table gives `missing`.

## Quality

The nature letter `n` is mapped by the caller's table, a country's data. The
one the French pack publishes (`grid.json`, operator `enedis`,
`meter_data.quality_codes`):

| Letter | Meaning | Code |
|---|---|---|
| `B`, `R` | raw (smart meter), real | 0 measured |
| `E` | estimated | 1 estimated |
| `C` | corrected | 2 substituted |
| `D` | imported | 100 |
| `H` | reconstructed at a clock change | 101 |
| `P` | reconstructed, with an outage | 102 |
| `S` | outage | 103 |
| `T` | short outage | 104 |
| `F` | start of an outage | 105 |
| `G` | end of an outage | 106 |
| a step absent from the file (`missing`) | | 3 missing |
| an index without a letter (`none`) | | 0 measured |

`tc`, `iv` and `ec` are kept on each point as the file writes them. A letter
the table does not hold is reported (`quality_unknown`) and its point keeps
a null quality.

## Problems

`file_unreadable`, `no_measures`, `time_zone_required`,
`local_time_nonexistent`, `date_unreadable`, `value_unreadable`,
`quality_unknown`, `step_irregular` (several steps in one quantity: no
missing step is added). Each says where.

## Fixtures

The files of `tests/fixtures` are built after the structure of the guide,
with invented metering points and values: a 30-minute day (JSON and the same
in XML), the two days the clocks change, two hours at five minutes with
active and reactive power, an outage and a lost step, an R64 index. The
examples of the guide itself and anonymised files recorded from the hub are
to be added beside them; the reader must pass them unchanged.

The small XML reader (`parseXml`, `findFirst`, `findAll`, `childText`) is
exported for the SOAP answers of the same operator.
