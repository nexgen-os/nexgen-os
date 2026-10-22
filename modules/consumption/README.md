# `consumption` — the consumption curve of a participant

Status: shipped. Schema: `consumption`.

A participant's consumption over time is known three ways: **measured**, by a
meter or a data hub, as a series of the core; **estimated**, from the
energy of a bill spread over its period by a load profile and the participant's
activity hours; **typical**, from an annual consumption and a load profile.
This module holds what the last two need and reads the curve of a participant
whichever way it is known. A load profile says which use it describes, by
the code the `building` module gives that use (`building.uses`) when it
is installed. An estimate is a curve of this module, kept in
`consumption.estimates`.

## What it adds to the core

| Table | Holds |
|---|---|
| `consumption.load_profiles` | how energy spreads over the slots of a day (24, 48 or 96), the day types of a week (`weekday`, `saturday`, `sunday`) and the months of a year: by `day_shapes` given as weights, or by `activity_hours`, a slot weighing 1 while the participant is open and `closed_ratio` while it is closed. Optional `monthly_factors`, the use it describes, its source. A vocabulary: read by everyone signed in, written by migrations, modules and the installation (`service_role`). The module ships `flat`; a standard profile a grid operator publishes is added with its source. |
| `consumption.activity_hours` | when a participant or a project is open, day of the week by day of the week (ISO, 1 Monday), in the local wall-clock time of its participant (`24:00` closes at midnight; two rows for a break), over a period of dates, with its source. Of the organisation of what is open, under row level security. |

## An estimated curve

```ts
import { estimateConsumption } from './src/curve.js';

await estimateConsumption(db, {
  siteId, from: '2026-01-01', to: '2026-02-01', profileCode: 'office_hours',
  energy: { kwh: 41850, source: 'electricity bill January 2026', documentId },
});
// { estimateId, seriesId, kwh: 41850, step: '60 minutes', slots: 744 }
```

Each slot of the period, cut in the participant's local days, is weighed by the
profile — the shape of its day type at its local time, or its open share
under the activity hours — times the factor of its month; the energy is
spread in proportion, so the curve adds up to the bill. Without `energy`,
the participant's `annual_consumption` attribute is spread over a period that
must then be one year (`energy_required` otherwise).

The curve is a `simulated` `consumption_energy` series of the participant that
names the estimate in its source (`consumption.estimates:<id>`), dated at the start of each slot in
UTC, written through `store()`. The estimate keeps its provenance, the
profile as it was read, the activity hours, the energy and its source, the
period and the time zone: it says where it comes from. A new computation
that names an estimate (`replaces`) replaces it, its curve written again.

Days are the participant's local days, daylight-saving time included, since a
timetable is read on the wall clock: the spring day has one hour less, the
autumn day one more, its repeated hour weighed twice. Public holidays are
not known here and weigh as the day of the week they fall on.

Refusals: `participant_not_found`, `estimate_not_found`, `time_zone_required`, `time_zone_unknown`,
`load_profile_unknown`, `activity_hours_required`, `energy_required`,
`energy_invalid`, `profile_without_weight`, `period_empty`, `date_invalid`;
in the table, `day_type_unknown` and `day_shape_invalid`.

## From a bill

```ts
import { readEnergyBill } from '@nexgen-os/energy-bill';
import { estimateFromBill } from './src/bill.js';

await estimateFromBill(db, { participantId, reading: readEnergyBill({ invoice, energy }), profileCode: 'flat', documentId });
```

The energy of a bill read by [`@nexgen-os/energy-bill`](../../packages/formats/energy-bill/README.md)
— its kWh, each counted once whatever the components billed on it — is
spread over its consumption period, from the first day of its consumption
lines to their last included, by the estimate above; the estimate
names the bill as the source of its energy and its document. kWh stay kWh:
a bill priced per MWh is read in kWh. Refusals:
`credit_note_not_consumption`, `period_required`, `energy_required`, and
those of the estimate.

## The curve of a participant

```sql
select * from consumption.curve(:participant, '2026-01-12', '2026-01-19', '1 day');
-- bucket, value (kWh), series_id, kind ('measured' or 'simulated')
```

Of the `consumption_energy` series of the participant or of anything of it (a
meter, a building) holding values in the period: a measured one first,
the one on the participant itself before the others; otherwise the latest
estimate of this module. `consumption.curve_series()` says which
series that is. Both read under the caller's row level security, through
`resample()`.

## A device recognised by disaggregation

A disaggregation source — a third-party insights service, a model the
installation runs — reads the curve of a meter and recognises the equipment
behind it: a heat pump, a charging station, a boiler, a PV system. It fits
the objects that exist, with no table of its own, through one gesture,
`consumption.recognise_device(participant_id, device_type, source_code,
confidence, name, quantity_code, step, at)`:

- the equipment is a **device** of the participant, signed by the source
  (`source_code`, a `sources` row the installation names);
- how sure the source is, 0 to 1, is the attribute
  `recognition_confidence` of the device;
- the consumption it estimates is a **series** of the device, kind
  `simulated`, signed by the same source, whose values the source stores
  with `store()`;
- the question to the end customer — *a heat pump is recognised: confirm?* —
  is an **action** of kind `recommendation` (module `actions`, which this
  module therefore requires), `source = 'detector'`, resting on that series.

The account of the participant answers with `actions.decide()`: validated,
the device becomes the customer's declaration (`customer_declaration`);
dismissed, it is retired on the day. The gesture runs once per participant,
device type and source: a second call returns what the first created and
updates the confidence.

## Later

Typical weeks learnt from a measured year, a curve estimated from
several bills at once, the energy of each band of a bill spread over the
hours of its band, public holidays read from the calendar of the participant's
country.
