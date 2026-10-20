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

## Energy sharing

Who received how much lives here, beside the participants it describes
(decision [0041](../../docs/decisions/0041-a-module-names-one-thing.md)).
The module keeps the model and an engine shares:

- the **allocation key** of a project is its attribute `allocation_key`,
  `{"method": "proportional", "parameters": {}}`, with the period it holds
  and its source (the general assembly that voted it); what a key reads
  about a participant is the participant's attribute (`allocation_share`,
  0 to 1; `allocation_rank`, 1 first);
- `runSharing()` (`src/sharing.ts`) reads the participants taking part over
  a period, groups left out, the `offtake_energy` and `injection_energy`
  metered behind each one (its meters through `participant_meters()`)
  resampled on one grid of steps, and hands them with the key, the
  participants' attributes and the caller's `rules` to an engine of the
  `energy_sharing` kind ([engines/README.md](../../engines/README.md));
- the answer is a run of this module on the project, its engine and version
  recorded: for each participant, `shared_offtake_energy`,
  `shared_injection_energy` and what is left of its `offtake_energy` and
  `injection_energy`, as `simulated` series of the run, final with it. The
  same inputs and the same engine give the same run, without starting the
  engine again.

```ts
import { runSharing } from './src/sharing.js';

await runSharing(db, {
  projectId, from: '2026-05-01T22:00:00Z', to: '2026-05-02T22:00:00Z', step: '15 minutes',
  engine: { name: 'sharing_example' }, // started from NEXGEN_ENGINE_SHARING_EXAMPLE
});
// { runId, engine: 'sharing_example 0.1.0', sharedKwh, series: { <participant>: { shared_offtake_energy: <id>, … } } }
```

Refusals before an engine starts: `project_not_found`, `period_empty`,
`period_misaligned`, `key_required`, `key_changes_in_period`,
`key_outside_period`, `key_invalid`, `engine_kind_unsupported`,
`participants_missing`, `series_incomplete`; then the engine's own
(`key_unknown`, `rule_unknown`…), passed on as they come.
[`engines/sharing-example`](../../engines/sharing-example/README.md) shares
in proportion to offtake and is meant to be copied: the key a community
applies is its engine, never a function of this module.

The `tasks` module depends on it. Install: `npx nexgen-os init --modules community`.
