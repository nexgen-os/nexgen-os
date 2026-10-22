# `community` — energy sharing among the participants of a project

Status: shipped with schema 0.3. Schema: `community`.

The project and the participants taking part in it are the core's: `projects`,
`participants`, `join_project()`, `leave_project()` and
`participant_meters()` ([docs/model.md](../../docs/model.md), decision
[0042](../../docs/decisions/0042-a-module-starts-from-an-object-of-the-core.md)).
This module starts from them and adds what an energy community does with
them: share the energy some participants produce among the others. It adds
no table; it publishes the vocabulary sharing reads and writes (0002) and
the function that runs it.

## Energy sharing

Who received how much lives here, on the participants it describes
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
  `energy_sharing` kind ([packages/connectors/README.md](../../packages/connectors/README.md#programs-in-any-language));
- the answer is a run of this module on the project (`community.runs`),
  its engine and version recorded: for each participant, `shared_offtake_energy`,
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
// { runId, engine: 'sharing_example 0.3.0', sharedKwh, series: { <participant>: { shared_offtake_energy: <id>, … } } }
```

Refusals before an engine starts: `project_not_found`, `period_empty`,
`period_misaligned`, `key_required`, `key_changes_in_period`,
`key_outside_period`, `key_invalid`, `engine_kind_unsupported`,
`participants_missing`, `series_incomplete`; then the engine's own
(`key_unknown`, `rule_unknown`…), passed on as they come.
[`packages/connectors/sharing-example`](../../packages/connectors/sharing-example/README.md) shares
in proportion to offtake and is meant to be copied: the key a community
applies is its engine, never a function of this module.

Install: `npx nexgen-os init --modules community`.
