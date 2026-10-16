# `tasks` — what has to be done on a project, and where it stands

Status: shipped, decision [0017](../../docs/decisions/0017-tasks-as-data.md). Schema: `tasks`.

A project lives through phases, from the first study to the day its
equipment is taken down, and each phase through tasks: the grid study
accepted, the permit filed, the loan signed, the panels delivered, the
array wired, the injection point energised, the system commissioned, the
yearly inspection done. What has to be done depends on the country, on the
kind of project and on who does it. This module holds the tasks, and the
templates that say which tasks a project needs; the core keeps the project
itself (`projects`: kind, status, country, dates) and its participants.

## What it adds to the core

| Table | Holds |
|---|---|
| `tasks.phases` | the phases a project goes through, in their usual order: `study`, `design`, `permitting`, `financing`, `procurement`, `site_preparation`, `installation`, `grid_connection`, `commissioning`, `handover`, `operation`, `decommissioning`. A vocabulary: read by everyone signed in, written by migrations, modules and packs. |
| `tasks.roles` | who carries a task: `owner`, `installer`, `grid_operator`, `municipality`, `regulator`, `financer`, `notary`, `community_manager`. Distinct from the roles of an organisation's members and from a participant's role in the energy flows. A vocabulary, extended by packs. |
| `tasks.templates` | what has to be done, as data: for a country (or every country) and a kind of project (or every kind), one task of one phase carried by one role, with the legal source (one of the core's `legal_sources`) and reference it answers, the documents it expects, the condition under which it applies (one attribute of the project compared to a number) and the template it waits for. Published by the country packs (`published_by = 'pack:fr'`) and by the installation; the module ships none, so no country is written in it. |
| `tasks.tasks` | an object (`task`): one thing to do about a project, a site, a building, a surface or a device (`subject_id`), its phase, the role that carries it and the contact who holds that role, status (`planned`, `in_progress`, `done`, `blocked`, `cancelled`), planned and actual start and end, the task it waits for, where it comes from (`template`, `manual`, `action`) and the template it was planned from. Photos, reports and certificates attach to it as documents and attributes. |

A task in progress has its actual start; one done has its actual end, and
only one done has it. Its subject, its contact and the task it waits for
are of its organisation. It may exist only in a scenario, like any object.

## Planning a project

```sql
select tasks.plan(:project);
-- {"project_id": …, "created": 9, "existing": 0,
--  "skipped": [{"code": "building_permit", "published_by": "pack:fr", "reason": "attribute_missing", "property": "installed_power"}]}
```

`plan()` reads the project's country and kind, takes every template that
matches them, checks each condition against the project's attributes and
creates one task per template, once: calling it again creates nothing
twice, and a scenario gets its own plan. A template whose condition names
an attribute the project does not have is skipped and said so, rather than
decided in the dark. Dependencies between templates become dependencies
between the tasks. It writes under the caller's row level security.

## Where a project stands

```sql
select tasks.progress(:site_or_project, date '2026-06-15');
-- {"on": "2026-06-15", "total": 6, "by_status": {"done": 2, "in_progress": 1, "planned": 2, "cancelled": 1},
--  "done_share": 0.4, "late": [{"id": …, "name": "Ground array mounted and wired", "phase": "installation", "planned_end": "2026-05-29"}],
--  "current_phase": "installation"}
```

The tasks of a site are those on the site or on anything on it; those of a
project, the project's own and those of every site taking part. The share
done leaves the cancelled ones out; a task is late when it was planned to
end before the day and is not done. The day is always given: the same call
gives the same answer. It reads under the caller's row level security, and
takes a scenario as its third argument.

## What stays outside

- The rules themselves live in the country packs (section `tasks`) and in
  the installation's own templates; the module decides nothing by itself.
- Whether a rule applies beyond a threshold on one attribute (a protected
  zone, a heritage building) is the `compliance` module's question, which
  will create tasks in its turn.
- Who is notified, the inbox, the comments and the screens belong to the
  application built on the foundation. An application that detects
  opportunities (an action worth taking) records the tasks it decides on
  with `source = 'action'` and its own reference in `source_ref`.

## Later

The commissioning workflow (states of a device from installed to in
service, with their log and photos), inspections and a site diary, the
tasks that return every year in operation.
