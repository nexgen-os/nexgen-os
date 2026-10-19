# `community` — projects, and the sites taking part in them

Status: shipped with schema 0.2. Schema: `community`.

A project is a working perimeter — an energy community, a portfolio, a
study, a construction site, a district plan — with the country whose rules
apply and a lifecycle (`simulation`, `creation`, `active`, `inactive`,
`archived`). A participant is a site's role in a project — producer,
consumer or prosumer — with the contact who answers for it and the period it
is in. A site takes part in a project once at a time; participants may be
grouped, a group having no site of its own.

| Table / function | Holds / does |
|---|---|
| `community.projects` | the project, an object: attributes, documents, tasks and runs attach to it |
| `community.participants` | a site's role in a project over a period, or a group of participants |
| `community.join_project()` | a site joins a project from a day; refuses `participant_site_already_in_project`, `participant_contact_in_other_organisation` |
| `community.leave_project()` | a participant leaves on a day, and may join again; refuses `participant_not_in_project` |
| `community.participant_meters()` | the connection points behind a participant, groups included; needs the `grid` module (`module_required`) |

The `tasks` module depends on it. Install: `npx nexgen-os init --modules community`.
