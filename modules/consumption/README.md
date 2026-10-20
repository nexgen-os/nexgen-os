# `consumption` — the consumption curve of a site

Status: shipped. Schema: `consumption`.

A site's consumption over time is known three ways: **measured**, by a
meter or a data hub, as a series of the core; **reconstructed**, from the
energy of a bill spread over its period by a load profile and the site's
activity hours; **typical**, from an annual consumption and a load profile.
This module holds what the last two need and reads the curve of a site
whichever way it is known. What a building or a site is used for is the
core's vocabulary (`profiles`); a load profile says which use it describes.

## What it adds to the core

| Table | Holds |
|---|---|
| `consumption.load_profiles` | how energy spreads over the slots of a day (24, 48 or 96), the day types of a week (`weekday`, `saturday`, `sunday`) and the months of a year: by `day_shapes` given as weights, or by `activity_hours`, a slot weighing 1 while the site is open and `closed_ratio` while it is closed. Optional `monthly_factors`, the use it describes, its source. A vocabulary: read by everyone signed in, written by migrations, modules and the installation (`service_role`). The module ships `flat`; a standard profile a grid operator publishes is added with its source. |
| `consumption.activity_hours` | when a site, a building or a space is open, day of the week by day of the week (ISO, 1 Monday), in the local wall-clock time of its site (`24:00` closes at midnight; two rows for a break), over a period of dates, with its source; in a scenario if need be. Of the organisation of what is open, under row level security. |

## A curve reconstructed, as a run

```ts
import { reconstructConsumption } from './src/curve.js';

await reconstructConsumption(db, {
  siteId, from: '2026-01-01', to: '2026-02-01', profileCode: 'office_hours',
  energy: { kwh: 41850, source: 'electricity bill January 2026', documentId },
});
// { runId, seriesId, kwh: 41850, step: '60 minutes', slots: 744 }
```

Each slot of the period, cut in the site's local days, is weighed by the
profile — the shape of its day type at its local time, or its open share
under the activity hours — times the factor of its month; the energy is
spread in proportion, so the curve adds up to the bill. Without `energy`,
the site's `annual_consumption` attribute is spread over a period that
must then be one year (`energy_required` otherwise).

The curve is a `simulated` `consumption_energy` series of the site that
belongs to the run (`series.run_id`), dated at the start of each slot in
UTC, written through `store()` while the run runs and final once it is
finished. The run keeps the profile as it was read, the activity hours,
the energy and its source, the period and the time zone: the same inputs
give the same run.

Days are the site's local days, daylight-saving time included, since a
timetable is read on the wall clock: the spring day has one hour less, the
autumn day one more, its repeated hour weighed twice. Public holidays are
not known here and weigh as the day of the week they fall on.

Refusals: `site_not_found`, `time_zone_required`, `time_zone_unknown`,
`load_profile_unknown`, `activity_hours_required`, `energy_required`,
`energy_invalid`, `profile_without_weight`, `period_empty`, `date_invalid`;
in the table, `day_type_unknown` and `day_shape_invalid`.

## The curve of a site

```sql
select * from consumption.curve(:site, '2026-01-12', '2026-01-19', '1 day');
-- bucket, value (kWh), series_id, kind ('measured' or 'simulated')
```

Of the `consumption_energy` series of the site or of anything on it (a
meter, a building) holding values in the period: a measured one first,
the one on the site itself before the others; otherwise the latest
reconstruction of this module. `consumption.curve_series()` says which
series that is. Both read under the caller's row level security, through
`resample()`.

## Later

Typical weeks learnt from a measured year, a curve reconstructed from
several bills at once, public holidays read from the calendar of the site's
country.
