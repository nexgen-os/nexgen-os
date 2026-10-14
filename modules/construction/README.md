# `construction` — the milestones of works

Status: shipped. Schema: `construction`.

From the permit to the handover, works on a site go through phases, and
each phase through milestones: the roof survey done, the panels delivered,
the array installed, the grid connection energised, the system
commissioned. This module holds them, so that the owner of the works and
the site manager read the same progress, and the devices of the core keep
their own lifecycle (`devices.status`).

## What it adds to the core

| Table | Holds |
|---|---|
| `construction.phases` | the phases works go through, in their usual order: `design`, `permitting`, `procurement`, `site_preparation`, `installation`, `grid_connection`, `commissioning`, `handover`. A vocabulary: read by everyone signed in, written by migrations, modules and packs. |
| `construction.milestones` | an object (`milestone`): one step of the works about a project, a site, a building, a surface or a device (`subject_id`), its phase, name, status (`planned`, `in_progress`, `done`, `blocked`, `cancelled`), planned and actual start and end, the contact who answers for it, notes and tags. Photos, reports, inspection results attach to it as documents and attributes. |

A milestone in progress has its actual start; one done has its actual end,
and only one done has it. Its subject and its contact are of its
organisation (`parent_in_other_organisation`,
`contact_in_other_organisation`). It may exist only in a scenario, like any
object.

## Where the works stand

```sql
select construction.progress(:site_or_project, date '2026-06-15');
-- {"on": "2026-06-15", "total": 6, "by_status": {"done": 2, "in_progress": 1, "planned": 2, "cancelled": 1},
--  "done_share": 0.4, "late": [{"id": …, "name": "Ground array mounted and wired", "phase": "installation", "planned_end": "2026-05-29"}],
--  "current_phase": "installation"}
```

The milestones of a site are those on the site or on anything on it; those
of a project, the project's own and those of every site taking part. The
share done leaves the cancelled ones out; a milestone is late when it was
planned to end before the day and is not done. The day is always given:
the same call gives the same answer. It reads under the caller's row level
security, and takes a scenario as its third argument.

## Later

The commissioning workflow (states of a device from installed to in
service, with their log and photos), a dashboard of the works with a map of
the equipment by state, inspections and a site diary.
