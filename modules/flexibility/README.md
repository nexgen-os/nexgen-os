# `flexibility` — what a device can be asked, and the power it can give up

A flexible asset is a device of the core
([0058](../../docs/decisions/0058-a-flexible-device-is-a-device-an-activation-is-a-command.md)):
a battery, a charger, a heat pump, a PV system curtailed. This module says
what each can be asked, with the same id, and computes the first figure a
producer, an aggregator or a grid operator reads of it: the power a
generator can give up, interval by interval; and it keeps the activations
asked of a device, each carried out as a command of the
[`actions`](../actions) module, which it requires. Offers and settlements,
the other two objects of 0058, come next.

## What it holds

| Table | What a row is |
|---|---|
| `flexibility.devices` | a device of any type, same id: the power it can be asked above and below its operating point (`power_up_kw`, `power_down_kw`, kW), its ramp (`ramp_kw_per_min`), its minimum step (`min_step_kw`), the shortest and longest activation it takes (`min_duration`, `max_duration`) and the notice it needs (`notice`) |
| `flexibility.activations` | an activation of one flexible device: its direction (`up`, more injection or less offtake as the grid sees it; `down`, the reverse), `start_at` and `end_at` (UTC), the power asked (`requested_kw`, kW, a change from the operating point), who asked (`requested_by`, a contact of the core) in which market role (`requested_role`), their reference (`external_ref`), and the id of the command that carries it out (`command_id`) |

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

- `flexibility.activate(device, direction, start, end, kW, requested_by,
  requested_role, external_ref, source)`: an activation, checked against
  what the device declares — the power in its direction, its minimum step,
  its shortest and longest activation — kept in `flexibility.activations`
  and carried out as a command (`actions.command()`) on the setpoint series
  of power of the device, at its start, with the source ref
  `flexibility.activations:<id>`. The command is proposed: the person, or
  an agent the person allowed, validates it, a connector carries it out and
  reports it (`actions.report()`), as for every command. What the device
  delivered is never a column of the activation: it is read from the series
  of its meter.

```sql
select flexibility.activate('<device>', 'down', '2026-06-01T06:00:00Z', '2026-06-01T06:30:00Z', 3,
                            null, 'aggregator', '<reference of the requester>');
```

An aggregator, a grid operator or an energy manager whose platform asks
activations is a connector of the core: `collectActivations()` of
`@nexgen-os/core` keeps what it asked, each activation through
`activate()`, once per device and reference
([connectors](../../packages/connectors/README.md)).

The availability is a read: the production is written once, in its series, and the
availability is computed from it each time it is asked for. An
availability the operator of the device publishes is a series of the
device, `published`, and is read as such.

Refusals of `power_down_available()`: `series_not_found` (also for a series the person cannot read),
`production_series_required` (a series that is not a measured, simulated or
forecast production of a device), `step_unsupported`, and what
`resample()` refuses (`time_zone_required`). Refusals of `activate()`:
`device_not_flexible`, `module_required`, `direction_invalid`,
`activation_period_invalid`, `activation_duration_invalid`,
`activation_power_invalid`, `activation_step_invalid`, and what
`actions.command()` refuses.

## What it does not model

The power upwards of a generator (its headroom below its rated power, which
a PV system curtailed only has when it already is); the power a load can
shift; a minimum operating point below which a device cannot run; the ramp
and the notice, which are held and not yet applied to an activation; an
activation of several devices, which comes with the offers that pool them;
the settlement of an activation against a baseline, which comes next.

## Conventions

Powers in kW, energies in kWh, a bucket dated at its start, in UTC.
