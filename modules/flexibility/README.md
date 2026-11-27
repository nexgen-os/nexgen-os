# `flexibility` — what a device can be asked, and the power it can give up

A flexible asset is a device of the core
([0058](../../docs/decisions/0058-a-flexible-device-is-a-device-an-activation-is-a-command.md)):
a battery, a charger, a heat pump, a PV system curtailed. This module says
what each can be asked, with the same id, and computes the first figure a
producer, an aggregator or a grid operator reads of it: the power a
generator can give up, interval by interval. Offers, activations and their
settlements, the other three objects of 0058, come next.

## What it holds

| Table | What a row is |
|---|---|
| `flexibility.devices` | a device of any type, same id: the power it can be asked above and below its operating point (`power_up_kw`, `power_down_kw`, kW), its ramp (`ramp_kw_per_min`), its minimum step (`min_step_kw`), the shortest and longest activation it takes (`min_duration`, `max_duration`) and the notice it needs (`notice`) |

A column left empty is not decided: no cap on the power, no ramp, no
minimum. The table carries the organisation of its device and is read by
whoever reads the device, its participant's account included.

## What it computes

- `flexibility.power_down_available(series, from, to, step)`: the power a
  generator can give up in each bucket of `step` (15 minutes by default),
  in kW, the mean of the bucket dated at its start. Its operating point is
  read from a production series of the device through `resample()` —
  `production_power` as it is, `production_energy` turned into its mean
  power (the energy of the bucket divided by its length in hours) — and
  capped by the `power_down_kw` the device declares, never below zero. A
  bucket without a value is left out; the quality of each bucket is the
  worst of the values it read.

```sql
insert into flexibility.devices (id, power_down_kw, ramp_kw_per_min)
values ('<device>', 4, 2);

select bucket, operating_kw, available_kw
from flexibility.power_down_available('<production series>', '2026-06-01T06:00:00Z', '2026-06-01T08:00:00Z', '1 hour');
```

It is a read: the production is written once, in its series, and the
availability is computed from it each time it is asked for. An
availability the operator of the device publishes is a series of the
device, `published`, and is read as such.

Refusals: `series_not_found` (also for a series the person cannot read),
`production_series_required` (a series that is not a measured, simulated or
forecast production of a device), `step_unsupported`, and what
`resample()` refuses (`time_zone_required`).

## What it does not model

The power upwards of a generator (its headroom below its rated power, which
a PV system curtailed only has when it already is); the power a load can
shift; a minimum operating point below which a device cannot run; the ramp
and the notice, which are held and not yet applied to a bucket. They come
with the activations, which ask for them.

## Conventions

Powers in kW, energies in kWh, a bucket dated at its start, in UTC.
