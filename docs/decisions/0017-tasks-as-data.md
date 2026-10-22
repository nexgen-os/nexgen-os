# 0017 — What has to be done is a template, the same in every country

> Status: accepted · a record of the modules

## Context

A roof of 30 kWp, an energy community, a carport: each needs a list of
studies, notifications, permits, certificates, connections and consents, in
an order, carried by someone. That list lives in the head of an installer or
a consultant. Written per country, it repeats five steps every country
shares (a feasibility study, a sizing, an offer, a commissioning, a
handover) once per pack, and the packs grow a section no function of the
core reads.

## Decision

**Following work by tasks is a module, `tasks`.** A task is about any
object (a project, a participant, a building, a surface, a device), has a phase,
a role, a status, planned and actual dates, a dependency and a source. An
installation that maps a district or computes yields does without it.

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

**Planning is one gesture.** One function instantiates the matching
templates once for an object and says what it could not decide; another
says where an object stands on a day
([0018](0018-one-function-per-gesture.md)).

**A task is not an action.** An application may detect opportunities and
score them; most are never done, and they live in the application. When
one is decided, the application records the tasks it entails, with the
action as their source; the foundation does not know the action.

## What it forbids

- Task templates in a country pack.
- A template per country for a step every country shares.
- A module named after a core table it does not own.

## See also

- Inherits Ekwo OS 0038 (*A deadline is a rule of the country; null is an
  answer*), translated: a step a country requires is data, outside the
  generic templates.
- [`modules/tasks/README.md`](../../modules/tasks/README.md).
