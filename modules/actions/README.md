# `actions` — what has to be done on an object of the core, now or later

Status: shipped with schema 0.3. Schema: `actions`.

An action is something to do on an object of the core — a project, a
participant, a meter, a device — now or later. It is of one of three kinds,
read from a vocabulary (`actions.kinds`), in one table and one lifecycle
([0017](../../docs/decisions/0017-an-action-is-something-to-do.md),
[0042](../../docs/decisions/0042-a-module-starts-from-an-object-of-the-core.md)):

| Kind | What it is | What it carries |
|---|---|---|
| `step` | a step of a project, planned from a template or by a person: the grid study accepted, the permit filed, the panels delivered, the yearly inspection done | its phase, role, contact, dates, the template it came from |
| `recommendation` | something proposed, resting on the estimate of a module that gives its gain: install a 20 kWh battery | `estimate_kind` (a module's table such as `solar.estimates`) and `estimate_id`, as the core names an object, never by foreign key, with `expected_gain_per_year` and `gain_horizon_years` copied for reading; only a recommendation carries an estimate |
| `command` | a setpoint or an order asked of a device at an instant, carried out by a connector, in real time | the device as its object; `series_id`, a series of kind `setpoint` or `command` of the device ([0022](../../docs/decisions/0022-the-instrument-is-a-device-the-point-is-the-series.md)); `value`, in the unit of its quantity; `due_at`; `connector_id`; `acknowledged_at` |

| Table | Holds |
|---|---|
| `actions.kinds` | `step`, `recommendation`, `command` |
| `actions.phases` | the life of a project, in order: `study`, `design`, `permitting`, `financing`, `procurement`, `site_preparation`, `installation`, `grid_connection`, `commissioning`, `handover`, `operation`, `decommissioning`; a command is in `operation` |
| `actions.roles` | who carries an action: `owner`, `installer`, `grid_operator`, `municipality`, `regulator`, `financer`, `notary`, `community_manager`. Distinct from the roles of an organisation's members and from a participant's role in the energy flows |
| `actions.templates` | the action templates: for a country (or every country) and its regions (ISO 3166-2, or the whole country), under a `condition` in the one shape of the core ([0044](../../docs/decisions/0044-a-condition-has-one-shape.md)) — the kind of project and the kinds refining it, an attribute of the project compared with a number — one step of one phase carried by one role, with the reference it answers, the documents it expects and the template it waits for |
| `actions.actions` | one thing to do about an object of the core, named by its kind and id (`object_kind`, `object_id`, checked against the six kinds of the core); its kind, phase, role and responsible contact, planned and actual dates, its status, the action it waits for, where it comes from (`source`: `template`, `person`, `agent`, `detector`, with `source_ref`), the estimate of a recommendation, the series, value and instant of a command, and why it failed (`failure`) |

## The lifecycle of an action

```
proposed → validated → launched → done
    ↘          ↘          ↘   ↘
            dismissed       failed
                ↘             ↙
                  proposed (restored)
```

One lifecycle for the three kinds. `actions.propose(object_kind, object_id,
phase, name, source, source_ref, estimate_kind, estimate_id, gain_per_year,
horizon_years, role)` proposes a step, or a recommendation when it names an
estimate; `actions.move(action, status, day, failure)` moves any action —
`launched` on its actual start, `done` on its actual end, `failed` with why
(a command refused, a permit refused). Any other move is refused by name
(`action_status_invalid`), as is a launch or an end without its day
(`action_day_required`), a failure without why (`action_failure_required`),
an estimate of no table (`estimate_kind_unknown`), a gain without an
estimate (`actions_gain_on_estimate`) and an estimate on anything but a
recommendation (`actions_recommendation_estimate`). An action launched has
its actual start; one done has its actual end, and only one done has it.
Its object, its contact, its connector and the action it waits for are of
its organisation (`object_in_other_organisation`,
`contact_in_other_organisation`, `connector_in_other_organisation`,
`dependency_in_other_organisation`).

## A command, in real time

`actions.command(series, value, due_at, name, source, source_ref,
connector)` asks the device of a setpoint or command series for a value at
an instant — a power limit at noon, a heat pump off for an hour — and
proposes it; a series that is not a setpoint or command series of a device
is refused (`command_series_invalid`). Once validated, the connector that
carries it out sends it and calls `actions.report(action, at, failure)`:

- acknowledged at an instant, the command is launched and done on that day,
  in the time zone of the device's participant (`time_zone_required`
  without one), and its value is stored in its series at that instant
  through `store()`: the series is its effect;
- refused or not acknowledged, it is `failed`, says why, and writes
  nothing. A failed command is proposed again with `actions.move(action,
  'proposed')`.

The validated commands still to carry out are found by their instant
(`kind = 'command' and status = 'validated'`, indexed on `due_at`).
Deciding when to command a device — a controller, a schedule, an optimiser
— is an application's.

## The steps of a project

`actions.plan(project)` takes the templates of the project's country (and
those of every country), keeps those of the regions of its participants,
matches each condition against the project with the core's
`condition_matches()`, and creates one step per template, once, as
`validated`. Calling it again creates nothing twice. It says what it could
not decide:

```jsonc
{"project_id": "…", "created": 3, "existing": 0,
 "skipped": [{"code": "building_permit", "published_by": "acme", "reason": "attribute_missing", "attribute_type": "installed_power"}]}
```

A template whose condition reads an attribute the project does not have is
skipped (`attribute_missing`); one that holds in some regions while no
participant says its region is skipped (`region_missing`). Dependencies
between templates become dependencies between the actions. It writes under
the caller's row level security.

The module publishes generic templates for two kinds of project, the same
in every country: a photovoltaic installation on a roof (`pv_roof`, nine
steps) and an energy community (`energy_community`, six). A step only one
country has — a named inspection body, a regional authorisation — is a
template an installation or a private overlay publishes under its own
name; a country pack holds none.

## Where a project stands

`actions.progress(object, day)` sums up the actions of a participant
(those on the participant or on anything of it) or of a project (its own
and those of every participant taking part) on a day: how many by status,
the share done among those not dismissed, the late ones (planned to end
before the day and neither done, failed nor dismissed), the phase of the earliest action still open.
The day is always given: the same call gives the same answer.

## What stays outside

- Detectors that propose actions from a portfolio, the scoring of
  recommendations and the controllers that decide commands are an
  application's ([services](../../docs/services.md)); what a detector
  proposes lands here with `source = 'detector'` and the detector's name in
  `source_ref`.
- Sending a command is a connector's: the module records what was asked and
  what the device answered.
- Notifications, reminders and calendars are an application's.

Install: `npx nexgen-os init --modules actions`. The yearly inspection and
the reporting of an operating installation are actions that return every
year in operation.
