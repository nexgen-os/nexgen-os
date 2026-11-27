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
  added up on one grid of steps by the core's `aggregate()`, and hands them with the key, the
  participants' attributes and the caller's `rules` to an engine of the
  `energy_sharing` kind ([packages/connectors/README.md](../../packages/connectors/README.md#programs-in-any-language));
- a participant with no metered series of its own (a study, a scenario)
  is read from its curves when the modules that hold them are installed:
  its production measured first (`solar.curve()`), its consumption measured
  first (`consumption.curve()`), netted step by step — what it consumes of
  its own production is min(production, consumption), never more — and the
  settlement's inputs name the series read;
- the perimeter of the operation is applied, on the first day of the
  period, where the rules of the places say one (`check_perimeter()`,
  below): a consumer outside it is left out of the sharing,
  `outside_perimeter`; a producer or a prosumer outside it is kept — the
  operation stands around its production; under a distance between the
  members furthest apart both ends of the pair are out, and the consumer is
  the one that goes — `producer_outside_perimeter`; one that cannot be
  decided is kept, `perimeter_undecided`. A power of the operation above
  the cap its rules say is named, `power_over_cap` (`check_power()`). Each
  is a line of the settlement's `warnings`, starting with its name, and its
  inputs keep what was checked;
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
// { settlementId, engine: 'sharing_example 0.3.0', sharedKwh, series: { <participant>: { shared_offtake_energy: <id>, … } }, warnings: [] }
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
| `max_distance_between_members` | `sharing_max_distance_m`, the project's own (a derogation granted) or the smallest any participant's place gives (a municipality); beside it, `sharing_max_distance_derogation_m`, what a derogation may grant | the greatest distance from the participant to another |
| `radius_around_producer` | `sharing_radius_m`, the smallest any participant's place gives | the distance to the nearest producer |
| `same_municipality` | the municipality of the place; `sharing_municipality_extension_m` for a producer's technology | whether a producer is in the participant's municipality |
| `same_substation` | `grid.same_substation()`, when `grid` is installed | whether the participant and the producers sit downstream of one substation |
| `same_region` | the region of the place | whether the producers are in its region |

A greater distance the rules grant only on request (in France, by the
density class of the municipalities, on request to the minister) is never
applied by itself. The criterion says it as `derogation_m`, the smallest any
participant's place allows, with `derogation_from`, and only when every place
allows one; once the derogation is granted, the project records it as its own
`sharing_max_distance_m`, the decision as its source and its date as
`valid_from`, and the criterion reads it first:

```sql
select set_attribute('project', :project, 'sharing_max_distance_m', '20000'::jsonb,
                     '2026-05-01', null, 'Decision of the minister granting the derogation', 'published');
```

Each row is a figure that says where it comes from: `in_perimeter`, each
criterion with its answer, its value, its distance and the default it was
read from (level, conditions, source, reference), and the rule with its
own. A criterion that cannot be decided — no point on the map, no
municipality, no substation said, an adjacent municipality reached by an
extension whose limits the model does not hold — answers `null`, never
guessed. Producers are the participants producing or self-producing.
Refusals: `project_not_found`, `participants_missing`, `producer_missing`,
`perimeter_rule_differs`, `perimeter_rule_unknown`, `parameter_missing`.

`community.check_power(project, day)` reads the installed power of the
operation against the greatest its rules allow:
`{max_kw, installed_kw, within, producers, value_from}`. The cap is
`sharing_max_power_kw`, resolved by `parameter_of()` for each participant
taking part on the day — the project's own attribute with its source first
(a cap granted by derogation, recorded with its decision), then the default
of its pack for the participant's region and the kind of the project — and
the smallest applies, as a perimeter holds for the whole operation; without
a participant taking part, the project's is read. In France the pack gives
5 MW on the mainland and 0.5 MW in the non-interconnected zones. The power is never entered, it is the sum of
`installed_power()` of the producers and prosumers taking part, computed
from their devices ([0065](../../docs/decisions/0065-a-value-is-written-once.md)).
`within` is null when either is missing.

Install: `npx nexgen-os init --modules community`.
