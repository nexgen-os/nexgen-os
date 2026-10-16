# 0017 — Tasks: what has to be done is data of the country

**Decided 16/10/2026.** Builds on [0006](0006-named-objects.md) (named
objects) and [0009](0009-addresses-and-geocoding.md) (what a pack holds).
Replaces the `construction` module shipped on 15/10/2026 before any
release.

## Context

A roof of 30 kWp in Wallonia, an energy community in France, a carport in
Flanders: each needs a different list of notifications, permits,
certificates, connections, registrations and consents, in an order, carried
by someone. Today that list is in the head of an installer or a
consultant. The `construction` module held the milestones of works, from
design to handover, and nothing of why a milestone existed. The question
was whether the life of a project belongs to the core, to a module named
after the project, or to the works.

## Decision

- **The project and its state stay in the core.** `projects` carries the
  kind, the status (simulation, creation, active, inactive, archived), the
  country whose rules apply and the dates. A project exists without a task.
- **Tasks are a module, `tasks`.** Following a project by phases is a tool,
  not a property of the object; an installation that maps a district in
  3D or computes yields does without it. A task is about a project, a
  site, a building, a surface or a device, not only a project, so the
  module is named after what it holds, never after a core table (the
  lesson of `participation` and `participants`).
- **Phases cover the whole life**, from `study` to `decommissioning`, and
  are a vocabulary: a pack or an installation adds its own.
- **What has to be done is data**: `tasks.templates`, for a country, a
  kind of project and a role, one task of one phase with its legal
  reference, its expected documents, the condition under which it applies
  and the template it waits for. The module ships no template: the country
  packs publish theirs in a section `tasks`, the installation its own.
  `tasks.plan()` instantiates them once per project and says what it could
  not decide.
- **Roles are their own vocabulary** (`tasks.roles`: owner, installer,
  grid operator, municipality, regulator, financer, notary, community
  manager), distinct from an organisation's members and from a
  participant's role in the energy flows.
- **Tasks and actions are two things.** An application built on the
  foundation may detect opportunities (a surplus to capture, a battery
  worth adding, a consent missing) and score them; that is an action, it
  lives in the application, and most of them are never done. A task is
  what has to be done or was decided. When an action is decided, the
  application records the tasks it entails with `source = 'action'` and its
  reference in `source_ref`; the foundation does not know the action.

## Consequences

- `construction` is renamed `tasks`; `milestones` become `tasks.tasks`
  with a role, a dependency, a source and a template; `progress()` keeps
  its contract.
- Packs gain a section `tasks`. The first ones, for `fr` and `be`, cover a
  PV roof and an energy community, each template with its legal reference
  and a test.
- Conditions beyond one attribute compared to a number (a protected zone, a
  heritage building, a cascade rule) are the `compliance` module's, which
  will create tasks in its turn.
- Notifications, inbox, comments and screens stay in the application.

## Open

`projects.kind` is free text. Templates match on it, so the kinds a pack
publishes templates for must be the kinds applications write; a vocabulary
of kinds in the core (energy community, PV plant, renovation, district
plan, portfolio, study) is the next step.
