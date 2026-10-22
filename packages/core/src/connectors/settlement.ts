// The `settlement` request kind (packages/connectors/README.md): the contracts in force
// over a period, each with its price signals in the shape the proposed
// `contracts` module would keep them (modules/README.md) and the series its
// volume is read from; back, the
// settlement lines of each contract — the energy, the price and the amount
// over each interval a price holds, who pays and who is paid. Any engine
// that accepts `settlement` answers in this shape; how it matches energy
// with contracts (pay as consumed, pay as produced, a cascade by priority)
// and how it reads an index is its own: the example engine
// (packages/connectors/settlement-example) multiplies a fixed price by the volume, and
// is meant to be copied and replaced. No invoice comes out of an engine:
// a line goes to Ekwo, which knows who is legally a party (decision 0010).

import type { EngineSpec } from './runner.js';
import type { EngineSeries } from './pvlib.js';

export type { EngineSeries };

/** What `runEngine` needs to start the example engine; the command comes from the caller or `NEXGEN_ENGINE_SETTLEMENT_EXAMPLE`. */
export const SETTLEMENT_EXAMPLE_ENGINE: Pick<EngineSpec, 'name' | 'install'> = {
  name: 'settlement_example',
  install: 'pip install -e packages/connectors/settlement-example, NEXGEN_ENGINE_SETTLEMENT_EXAMPLE="python3 -m nexgen_settlement_example"',
};

/** A price signal of a contract: start included, end excluded, no end until further notice. */
export interface SettlementPriceSignal {
  kind: 'fixed' | 'indexed' | 'cap' | 'floor';
  starts_at: string;
  ends_at: string | null;
  /** The price of `fixed`, `cap` and `floor`, per `per_unit`. */
  price?: number | null;
  /** `indexed`: multiplier × the index's value + adder, in the index's currency and unit. */
  index_code?: string | null;
  index_multiplier?: number | null;
  index_adder?: number | null;
  /** ISO 4217. */
  currency: string;
  /** The unit of energy the price is quoted per, a code of the `units` vocabulary (`KiloW-HR`, `MegaW-HR`); `convertUnit()` gives its factor. */
  per_unit: string;
}

/** A party: a contact of the organisation, or the organisation itself when `contact_id` is null. */
export interface SettlementParty {
  contact_id: string | null;
  name: string;
}

export interface SettlementContract {
  /** The contract's id, as the caller knows it. */
  id: string;
  name: string;
  /** A contract type (`supply`, `ppa_physical`…), with the way energy goes and whether it is delivered. */
  type: string;
  direction: 'offtake' | 'injection' | 'both';
  physical: boolean;
  seller: SettlementParty;
  buyer: SettlementParty;
  volume_basis: 'pay_as_consumed' | 'pay_as_produced' | 'allocated_power';
  allocated_power_kw?: number | null;
  /** 1 first; null: outside any order. */
  priority: number | null;
  /** Where the volume is read: a point of the request and one of its series (`offtake_energy`, `shared_offtake_energy`…). */
  volume: { point: string; quantity_code: string };
  signals: SettlementPriceSignal[];
}

/** A delivery point (a meter, a participant) with its series, kWh per step, each with a value at every step of the request. */
export interface SettlementPoint {
  id: string;
  series: EngineSeries[];
}

export interface SettlementRequest {
  kind: 'settlement';
  /** The grid every series is on: `[from, to)` by `step`, stamps at the start of each step, UTC. */
  from: string;
  to: string;
  step: string;
  contracts: SettlementContract[];
  points: SettlementPoint[];
  /** The values of the indices an indexed price follows, one series per index (`quantity_code` = the index's code), on the same grid. */
  indices?: EngineSeries[];
  /** What a country's pack or the project sets (a tax, a rounding), passed as it is; the engine says in `meta` what it applied. */
  rules: Record<string, unknown>;
}

/** What a contract settles over one interval a price holds. The buyer pays the seller `amount`, in `currency`. */
export interface SettlementLine {
  contract_id: string;
  seller: SettlementParty;
  buyer: SettlementParty;
  /** The interval: start included, end excluded, on the steps of the request. */
  from: string;
  to: string;
  energy_kwh: number;
  price: number;
  per_unit: string;
  currency: string;
  amount: number;
}

export interface SettlementResult {
  lines: SettlementLine[];
  /** Per contract: its energy and its amount over the period, in its currency. */
  contracts: { id: string; energy_kwh: number; amount: number; currency: string }[];
  /** What the engine did: how it read the volumes and the prices, how it rounded, the rules it applied. */
  meta: Record<string, unknown>;
}
