# `sharing` — allocation keys, and sharing computed by an engine

Status: shipped (keys and runs). Schema: `sharing`.

Energy sharing — self-consumption on a site, a community sharing what its
producers inject among its consumers — is computed by an engine of the
`energy_sharing` kind ([`engines/README.md`](../../engines/README.md),
decision [0013](../../docs/decisions/0013-external-engines.md)). Whoever
shares energy writes their own key in their own engine; this module keeps
the model and records each computation as a run.

## What it adds to the core

| Table | Holds |
|---|---|
| `sharing.allocation_keys` | how a project shares over a period: a `method` an engine knows (`proportional`, `fixed`, `ordered` or one of its own) and its `parameters` as the engine reads them, `valid_from` and `valid_to`, its source and the document it comes from. Of the organisation of its project (`project_in_other_organisation`). Nothing in the database interprets it. |

Two quantities, beside the core's `offtake_energy` and `injection_energy`:
`shared_offtake_energy` (received from a sharing) and
`shared_injection_energy` (given to it), in kWh.

## A sharing, as a run

```ts
import { runSharing } from './run.js';
import { SHARING_EXAMPLE_ENGINE } from '../../engines/energy-sharing.js';

await runSharing(db, {
  projectId, keyId, from: '2026-05-01T22:00:00Z', to: '2026-05-02T22:00:00Z', step: '15 minutes',
  rules: {},                     // what a country's pack or the project sets, passed as it is
  engine: SHARING_EXAMPLE_ENGINE, // or yours; its command from NEXGEN_ENGINE_<NAME>
});
// { runId, engine: 'sharing_example 0.1.0', sharedKwh, series: { <participant>: { shared_offtake_energy: <series id>, … } } }
```

The participants taking part over the period (groups left out: their
meters are their members'), each with the `offtake_energy` and
`injection_energy` metered behind it (`participant_meters()`), summed and
resampled on the grid; a direction a participant has no series of is sent
as zeros, a series missing steps is refused (`series_incomplete`). The
engine's answer is checked against the grid and stored as `simulated`
series on each participant, the run records the engine's version and
dependencies, the key, the rules, the period and the series read: the same
inputs and the same engine give the same run.

Refusals: `project_not_found`, `key_not_found`, `key_outside_period`,
`period_empty`, `period_misaligned`, `participants_missing`,
`series_incomplete`, `engine_kind_unsupported`, and the engine's own
(`key_unknown`, `rule_unknown`…) as it names them.

## Later

Settlement lines handed to Ekwo for invoicing, the rules of each country
in its pack.
