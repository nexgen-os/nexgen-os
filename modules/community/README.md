# `community` — energy sharing among the participants of a project

Status: shipped with schema 0.3. Schema: `community`.

The project and the participants taking part in it are the core's: `projects`,
`participants`, `join_project()`, `leave_project()` and
`participant_meters()` ([docs/model.md](../../docs/model.md), decision
[0042](../../docs/decisions/0042-a-module-starts-from-an-object-of-the-core.md)).
This module starts from them and adds what an energy community does with
them: share the energy some participants produce among the others. It adds
one table, its settlements; it publishes the vocabulary sharing reads and
writes (0002) and the function that computes it.

## Energy sharing

Who received how much lives here, on the participants it describes
(decision [0041](../../docs/decisions/0041-a-module-names-one-thing.md)).
The module keeps the model and an engine shares:

- the **allocation key** of a project is its attribute `allocation_key`,
  `{"method": "proportional", "parameters": {}}`, with the period it holds
  and its source (the general assembly that voted it); what a key reads
  about a participant is the participant's attribute (`allocation_share`,
  0 to 1; `allocation_rank`, 1 first);
- `settleSharing()` (`src/sharing.ts`) reads the participants taking part over
  a period, groups left out, the `offtake_energy` and `injection_energy`
  metered behind each one (its meters through `participant_meters()`)
  resampled on one grid of steps, and hands them with the key, the
  participants' attributes and the caller's `rules` to an engine of the
  `energy_sharing` kind ([packages/connectors/README.md](../../packages/connectors/README.md#programs-in-any-language));
- a participant with no metered series of its own (a study, a scenario)
  is read from its curves when the modules that hold them are installed:
  its production measured first (`solar.curve()`), its consumption measured
  first (`consumption.curve()`), netted step by step — what it consumes of
  its own production is min(production, consumption), never more — and the
  settlement's inputs name the series read;
- the engine's answer is checked against physics before anything is
  stored: at every step a participant receives at most its offtake and gives
  at most its injection, and the project shares no more than it gave, nor
  more than min(total injection, total offtake)
  (`settlement_exceeds_physics`);
- the answer is a settlement of this module on the project (`community.settlements`),
  its provenance (the engine and its version) and its inputs recorded: for each
  participant, `shared_offtake_energy`, `shared_injection_energy` and what is
  left of its `offtake_energy` and `injection_energy`, as `simulated` series of
  the settlement. A new computation that names a settlement (`replaces`)
  replaces it, its series written again.

```ts
import { settleSharing } from './src/sharing.js';

await settleSharing(db, {
  projectId, from: '2026-05-01T22:00:00Z', to: '2026-05-02T22:00:00Z', step: '15 minutes',
  engine: { name: 'sharing_example' }, // started from NEXGEN_ENGINE_SHARING_EXAMPLE
});
// { settlementId, engine: 'sharing_example 0.3.0', sharedKwh, series: { <participant>: { shared_offtake_energy: <id>, … } } }
```

Refusals before an engine starts: `project_not_found`, `period_empty`,
`period_misaligned`, `key_required`, `key_changes_in_period`,
`key_outside_period`, `key_invalid`, `engine_kind_unsupported`,
`consent_missing`, `participants_missing`, `series_incomplete`; after it,
`settlement_exceeds_physics`; then the engine's own
(`key_unknown`, `rule_unknown`…), passed on as they come.
[`packages/connectors/sharing-example`](../../packages/connectors/sharing-example/README.md) shares
in proportion to offtake and is meant to be copied: the key a community
applies is its engine, never a function of this module
(decision [0056](../../docs/decisions/0056-the-key-a-community-applies-is-its-engine.md)).

## Consents

What a participant agreed to is one table, `community.consents`: a
participant, a purpose of the vocabulary `community.consent_purposes`
(`terms`, `processing`, `sharing`, `marketing`), the period it holds
(given at `valid_from`; a revocation closes it at `valid_to`, with its
reason and who revoked it), who gave it and the signed text, a `documents`
row of the participant. Periods of one participant and purpose never
overlap (`consent_already_given`).

- `community.give_consent(participant, purpose, from, given_by, document, contact)`;
- `community.revoke_consent(consent, at, reason, revoked_by)` — refuses
  `consent_not_found`, `consent_already_closed`, `consent_revoked_before_given`;
- `community.consents_missing(project, purpose, from, to)` — the participants
  taking part over a period without a consent covering it.

`settleSharing()` refuses `consent_missing`, naming them, the participants
without a consent to `sharing` over the period where `sharing_consent_required`
is true for them: a default of their pack, or an attribute of their project
or organisation — data, never code.

## Perimeter

`community.check_perimeter(project, day)` says, for each participant taking
part on the day, whether it is within the perimeter of the operation. The
rule is its pack's: `sharing_perimeter`, a list of criteria any one of which
suffices, resolved by `parameter_of()` for the kind of the project and the
place of the participants (one rule for all, `perimeter_rule_differs`
otherwise):

| Criterion | Reads | Measures |
|---|---|---|
| `max_distance_between_members` | `sharing_max_distance_m`, the smallest any participant's place gives (a density class, a municipality) | the greatest distance from the participant to another |
| `radius_around_producer` | `sharing_radius_m`, the smallest any participant's place gives | the distance to the nearest producer |
| `same_municipality` | the municipality of the place; `sharing_municipality_extension_m` for a producer's technology | whether a producer is in the participant's municipality |
| `same_substation` | `grid.same_substation()`, when `grid` is installed | whether the participant and the producers sit downstream of one substation |
| `same_region` | the region of the place | whether the producers are in its region |

Each row is a figure that says where it comes from: `in_perimeter`, each
criterion with its answer, its value, its distance and the default it was
read from (level, conditions, source, reference), and the rule with its
own. A criterion that cannot be decided — no point on the map, no
municipality, no substation said, an adjacent municipality reached by an
extension whose limits the model does not hold — answers `null`, never
guessed. Producers are the participants producing or self-producing.
Refusals: `project_not_found`, `participants_missing`, `producer_missing`,
`perimeter_rule_differs`, `perimeter_rule_unknown`, `parameter_missing`.

Install: `npx nexgen-os init --modules community`.
