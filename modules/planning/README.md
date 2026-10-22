# `planning` — what has to be done on a project, and where it stands

Status: shipped, decision [0017](../../docs/decisions/0017-planning-as-data.md). Schema: `planning`.

A project lives through phases, from the first study to the day its
equipment is taken down, and each phase through tasks: the grid study
accepted, the permit filed, the loan signed, the panels delivered, the
array wired, the injection point energised, the system commissioned, the
yearly inspection done. What has to be done depends on the country, on the
kind of project and on who does it. This module holds the tasks, and the
templates that say which tasks a project needs; the core keeps the project
itself (`projects`: kind, status, country, dates) and its participants, so
the module needs no other module.

## What it adds to the core

| Table | Holds |
|---|---|
| `planning.phases` | the phases a project goes through, in their usual order: `study`, `design`, `permitting`, `financing`, `procurement`, `site_preparation`, `installation`, `grid_connection`, `commissioning`, `handover`, `operation`, `decommissioning`. A vocabulary: read by everyone signed in, written by migrations, modules and packs. |
| `planning.roles` | who carries a task: `owner`, `installer`, `grid_operator`, `municipality`, `regulator`, `financer`, `notary`, `community_manager`. Distinct from the roles of an organisation's members and from a participant's role in the energy flows. A vocabulary, extended by packs. |
| `planning.templates` | what has to be done, as data: for a country (or every country), its regions (ISO 3166-2, or the whole country) and a kind of project (or every kind), one task of one phase carried by one role, with the published text (the code of a `sources` row of kind `text`) and the reference it answers, the documents it expects, the condition under which it applies (one attribute of the project compared to a number) and the template it waits for. The module publishes fifteen generic ones for every country (`published_by = 'planning'`, `country` null): nine steps of a roof installation, six of an energy community. A step one country adds is published by the installation or a private overlay under its own name; a country pack holds no task. |
| `planning.tasks` | one thing to do about an object of the core — a project, a participant, a meter, a device — named by its kind and id (`subject_kind`, `subject_id`, checked on the six words of the core), its phase, the role that carries it and the contact who holds that role, status (`planned`, `in_progress`, `done`, `blocked`, `cancelled`), planned and actual start and end, the task it waits for, where it comes from (`template`, `manual`, `action`) and the template it was planned from. Photos and certificates are documents of its subject. |

A task in progress has its actual start; one done has its actual end, and
only one done has it. Its subject, its contact and the task it waits for
are of its organisation, and it goes with its subject.

## Planning a project

```sql
select planning.plan(:project);
-- {"project_id": …, "created": 9, "existing": 0,
--  "skipped": [{"code": "building_permit", "published_by": "acme", "reason": "attribute_missing", "property": "installed_power"}]}
```

`plan()` reads the project's country and kind, and the regions of the
participants taking part in it, takes every template that matches them, checks each condition against the project's attributes and
creates one task per template, once: calling it again creates nothing
twice. A template whose condition names
an attribute the project does not have is skipped and said so, rather than
decided in the dark; so is a regional template on a project none of whose
participants says its region (`region_missing`). Dependencies between templates become dependencies
between the tasks. It writes under the caller's row level security.

## Where a project stands

```sql
select planning.progress(:site_or_project, date '2026-06-15');
-- {"on": "2026-06-15", "total": 6, "by_status": {"done": 2, "in_progress": 1, "planned": 2, "cancelled": 1},
--  "done_share": 0.4, "late": [{"id": …, "name": "Ground array mounted and wired", "phase": "installation", "planned_end": "2026-05-29"}],
--  "current_phase": "installation"}
```

The tasks of a participant are those on the participant or on anything of it; those of a
project, the project's own and those of every participant taking part. The share
done leaves the cancelled ones out; a task is late when it was planned to
end before the day and is not done. The day is always given: the same call
gives the same answer. It reads under the caller's row level security.

## What stays outside

- The steps one country adds (a named inspection body, a regional
  authorisation, a purchase-contract branch) live in the installation's own
  templates or a private overlay, never in a country pack; the law they
  answer is not kept in the open model.
- Whether a rule applies beyond a threshold on one attribute (a protected
  zone, a heritage building) is a question of the law, which the open
  repository does not hold; an installation that answers it records the
  tasks it decides on.
- Who is notified, the inbox, the comments and the screens belong to the
  application built on the foundation. An application that detects
  opportunities (an action worth taking) records the tasks it decides on
  with `source = 'action'` and its own reference in `source_ref`.

## Later

The commissioning workflow (states of a device from installed to in
service, with their log and photos), inspections and a construction diary, the
tasks that return every year in operation.
