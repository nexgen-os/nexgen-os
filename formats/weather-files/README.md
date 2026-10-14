# `@nexgen-os/weather-files` — EPW and TMY3 ⇄ Nexgen OS

Reads the weather files solar and building tools exchange — EPW (EnergyPlus
Weather: PVGIS, Meteonorm, climate.onebuilding.org, EnergyPlus) and TMY3
(the National Solar Radiation Database's CSV) — into series in the core's
conventions, and writes a place's weather back as EPW, so that a PVsyst,
PV\*SOL, SAM, EnergyPlus or pvlib user reruns the same weather. MIT, like
every format library; usable without Nexgen OS (`readEpw`, `readTmy3` and
`writeEpw` need no database).

| File | Nexgen OS | Notes |
|---|---|---|
| global, direct normal, diffuse horizontal radiation (Wh/m² over the hour) | `ghi`, `dni`, `dhi`, `interval`, `1 hour`, W/m² | dated at the start of the hour, in UTC |
| dry-bulb temperature, wind speed | `temperature` (°C), `wind_speed` (m/s), `instant` | dated at the hour's stamp, in UTC |
| hour 1 to 24, local standard time | UTC, from the header's offset | daylight saving never applies in these files |
| months from several years (a typical year) | one calendar year, `options.year`, by default the latest year the months come from | stored `simulated`, named `typical year <first>-<last>` |
| a real year | its own dates | stored `measured`, unnamed |
| missing values (EPW 9999, 99.9, 999; TMY3 −9900) | left out, counted in `missing` | never filled |
| dew point, humidity, pressure, wind direction, albedo… | not carried yet, listed in `skipped` | written back as missing |
| `LOCATION` line, TMY3 station line | `location`: name, region, country as written, data source, station, latitude, longitude, offset, elevation | |

```ts
import { readEpw, importWeatherFile, exportEpw } from './formats/weather-files/index.js';

const file = readEpw(text);                       // or readTmy3(text)
for (const w of file.warnings) console.warn(w.code, w.message);
await importWeatherFile(db, { organisationId, objectId: pointOrSite }, file, { sourceCode: 'pvgis' });

const epw = await exportEpw(db, { objectId: pointOrSite, sourceCode: 'pvgis', kind: 'simulated',
  name: 'typical year 2005-2020', year: file.year!, location: file.location });
```

The series land on the object named — a weather point of the `weather`
module or a site — with the `sources` row the caller names: the dataset the
file comes from, with its licence. Importing the same file again replaces
the values. The export reads the series through `resample()` and writes
every hour of the year, missing ones with the EPW codes; 29 February only
when the series have it.

## The time offset is checked

A file states its offset from UTC and is read in it; the hour at which the
irradiance peaks is then compared with the solar noon of its longitude. A
file whose hours sit one or more hours away is reported as
`time_offset_suspect`, with the offset its irradiance implies. PVGIS writes
its EPW hours in UTC under a header that gives the local offset: read it
with `{ utcOffsetHours: 0 }`.

## Refusals

`epw_unreadable`, `tmy3_unreadable` (not the format, or a row without a
date), `epw_subhourly_unsupported` (more than one record per hour),
`epw_duplicate_hour` / `tmy3_duplicate_hour` (the same hour twice),
`weather_file_unreadable` (no latitude, longitude or offset in the header).
