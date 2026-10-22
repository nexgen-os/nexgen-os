# 0017 — An action is something to do on an object of the core, now or later

> Status: accepted · a record of the modules

## Context

A roof of 30 kWp, an energy community, a carport: each needs a list of
studies, notifications, permits, certificates, connections and consents, in
an order, carried by someone. That list lives in the head of an installer or
a consultant. Written per country, it repeats five steps every country
shares (a feasibility study, a sizing, an offer, a commissioning, a
handover) once per pack, and the packs grow a section no function of the
core reads.

The same installation, once it runs, is asked for other things to do: a
battery an estimate recommends, an export limit asked of an inverter at
noon, a heat pump switched off for an hour. A module that held only the plan
of a project would leave the recommendation and the command to two more
tables, each with its own lifecycle.

## Decision

**What has to be done is a module, `actions`.** An action is something to
do on an object of the core (a project, a participant, a meter, a device),
now or later. It has a kind, a phase, a role, a status in one lifecycle —
proposed, validated, launched, done or failed, or dismissed and restored —
planned and actual dates, a dependency and a source (a template, a person,
an agent, a detector of an application). An installation that maps a
district or computes yields does without it.

**Three kinds, one table, one lifecycle.** The kind is read from a
vocabulary (`actions.kinds`):

- a **step** of a project, from a template or a person: "file the permit";
- a **recommendation**, proposed and resting on the estimate that gives its
  gain: "install a 20 kWh battery, gain 1 400 a year". The estimate is the
  table of a module's figures and the row's id, named by kind and id as the
  core names an object, never by a foreign key to another module, with the
  gain per year and its horizon copied for reading; a recommendation rests
  on one, and only a recommendation does;
- a **command**, in real time: a setpoint or an order asked of a device at
  an instant, carried out by a connector. Its effect is a value of a series
  of kind `setpoint` or `command` of the device
  ([0022](0022-the-instrument-is-a-device-the-point-is-the-series.md)),
  stored at the instant the device acknowledged it. A command refused or
  not acknowledged has `failed`, and says why.

`failed` belongs to the one lifecycle: a step fails too, a permit refused
after it was filed. A failed or dismissed action is restored to proposed.

**Templates are generic, in the module.** A study, a sizing, an offer, a
commissioning is the same in every country: one template each, with no
country, and a free reference instead of a legal source.

**A step only one country has is an overlay outside the pack.** An
installation or a private package adds its own templates; the open pack of
a country carries none ([0020](0020-a-pack-holds-what-a-function-reads.md)).

**Phases and roles are vocabularies.** Phases cover the whole life, from
study to decommissioning; roles (owner, installer, grid operator,
municipality, financer) are distinct from an organisation's members and
from a participant's role in the energy flows.

**Each gesture is one function** ([0018](0018-one-function-per-gesture.md)).
`actions.plan()` instantiates the matching templates once for a project and
says what it could not decide; `actions.progress()` says where an object
stands on a day; `actions.propose()` proposes a step or a recommendation;
`actions.command()` asks a device for a value; `actions.report()` records
what the connector that carried a command out answered; `actions.move()`
moves any action along its lifecycle.

**Deciding is an application's.** The detectors that propose actions, the
scoring of recommendations and the controllers that decide when to command
a device are an application's ([services](../services.md)); what they
propose lands here, with `source = 'detector'` or `'agent'`.

**When a template applies is a condition in the one shape of the core**
([0044](0044-a-condition-has-one-shape.md)), matched by the core's
`condition_matches()`.

## What it forbids

- Action templates in a country pack.
- A template per country for a step every country shares.
- A second table, or a second lifecycle, for recommendations or commands.
- A command whose effect is written anywhere but a setpoint or command
  series of its device.
- A module named after a core table it does not own.

## See also

- Inherits Ekwo OS 0038 (*A deadline is a rule of the country; null is an
  answer*), translated: a step a country requires is data, outside the
  generic templates.
- [`modules/actions/README.md`](../../modules/actions/README.md).
