// The `energy_sharing` request kind (engines/README.md): the participants of
// a sharing with their offtake and injection on one grid of steps, an
// allocation key as data, and the rules a country or a project sets, passed
// as they are; back, what each participant received from the sharing and
// gave to it, step by step, and what is left for the grid. Any engine that
// accepts `energy_sharing` answers in this shape; how it shares is its own:
// the example engine (engines/sharing-example) shares in proportion to
// offtake, and is meant to be copied and replaced.

import type { EngineSpec } from './runner.js';
import type { EngineSeries } from './pvlib/index.js';

export type { EngineSeries };

/** What `runEngine` needs to start the example engine; the command comes from the caller or `NEXGEN_ENGINE_SHARING_EXAMPLE`. */
export const SHARING_EXAMPLE_ENGINE: Pick<EngineSpec, 'name' | 'install'> = {
  name: 'sharing_example',
  install: 'pip install -e engines/sharing-example, NEXGEN_ENGINE_SHARING_EXAMPLE="python3 -m nexgen_sharing_example"',
};

/** The quantities a participant sends: its metered `offtake_energy` and `injection_energy`, kWh per step. */
export const SHARING_INPUTS = ['offtake_energy', 'injection_energy'] as const;

/**
 * The quantities an engine answers for each participant, kWh per step:
 * what it received from the sharing and gave to it, and what is left —
 * offtake from its supplier, injection to the grid.
 */
export const SHARING_OUTPUTS = ['shared_offtake_energy', 'shared_injection_energy', 'offtake_energy', 'injection_energy'] as const;

export interface SharingParticipant {
  /** The participant's id in the core. */
  id: string;
  name: string;
  role: 'producer' | 'consumer' | 'prosumer';
  /** `offtake_energy` and `injection_energy`, each with a value at every step of the request. */
  series: EngineSeries[];
}

export interface EnergySharingRequest {
  kind: 'energy_sharing';
  /** The grid every series is on: `[from, to)` by `step`, stamps at the start of each step, UTC. */
  from: string;
  to: string;
  step: string;
  participants: SharingParticipant[];
  /** The allocation key: a method the engine knows (`proportional`…) and its parameters, as the project holds them. */
  key: { method: string; parameters: Record<string, unknown> };
  /** What a country's pack or the project sets (a cap, an order of priority), passed as it is; the engine says in `meta` what it applied. */
  rules: Record<string, unknown>;
}

export interface SharingParticipantResult {
  id: string;
  /** The four `SHARING_OUTPUTS`, each with a value at every step. */
  series: EngineSeries[];
  /** Each output summed over the period, kWh. */
  totals: Record<string, number>;
}

export interface EnergySharingResult {
  participants: SharingParticipantResult[];
  /** Over every participant and the period, kWh: at least `shared_energy`. */
  totals: Record<string, number>;
  /** What the engine did: the key and the rules it applied, the defaults it took. */
  meta: Record<string, unknown>;
}
