// What this library reads and what it returns.
//
// It reads TWO things, declared here: the invoice as a generic invoice reader
// returns it — `ReceivedInvoice`, the EN 16931 shape of `@ekwo-ai/factur-x`
// (MIT), which a reader of a PDF, of a Factur-X or of a UBL file returns alike —
// and the energy facts that reader cannot know, because EN 16931 has no word
// for them: the meter, which line bills which time-of-use band and season,
// which lines are network delivery, taxes per kWh, contributions on a fixed
// base, the subscription, what the bill states as information without billing
// it, the contract type with the words printed for it, the subscribed power.
//
// The invoice is taken as the reader wrote it: figures are its decimal texts,
// the currency is its BT-5. The bill is never read again here.

import type { ReceivedInvoice } from '@ekwo-ai/factur-x';

export type { ReceivedInvoice, ReceivedLine } from '@ekwo-ai/factur-x';

/** A figure as the bill prints it: a decimal text of the reader, or a number. */
export type Figure = string | number;

/** What a line of the invoice bills, from the point of view of energy. */
export type LineRole =
  /** a price of the energy consumed, one component of it (energy, capacity, certificates…) */
  | 'energy'
  /** network delivery: transport, distribution, metering, management */
  | 'network'
  /** a tax or a levy per unit of energy */
  | 'tax'
  /** a contribution assessed on a fixed base (a rate on a fixed charge) or a lump sum */
  | 'contribution'
  /** the subscription of the supply contract over the period */
  | 'subscription'
  /** anything else the invoice bills (a service, a fee, a late payment) */
  | 'other';

/** The energy facts of one line of the invoice, named by its identifier (BT-126). */
export interface LineFacts {
  line: string;
  role: LineRole;
  /**
   * The time-of-use band the line bills, by the code the country's pack gives
   * it (peak, offpeak, day, night…). Null or absent: the line bills every hour.
   */
  band?: string | null;
  /** The season the line's label NAMES, by its pack code; null when the label names none. A price revision is not a season. */
  season?: string | null;
  /**
   * For a network line priced per unit of something else than energy: whether
   * it is owed whatever is consumed (`fixed`). A line whose quantity is energy
   * is `variable`, whatever this says.
   */
  kind?: 'fixed' | 'variable' | null;
  /** For a contribution: the base it is assessed on and its rate (a fraction, 0.15), as printed. */
  base?: Figure | null;
  rate?: Figure | null;
  /** The label lines of one tax or one component are grouped by; the line's name (BT-153) when absent. */
  label?: string | null;
}

/** An amount the bill prints as information ("of which", a footnote) and does not bill on a line of its total. */
export interface StatedAmount {
  role: 'network';
  label: string | null;
  kind: 'fixed' | 'variable' | null;
  amount: Figure;
  period?: { start: string | null; end: string | null } | null;
}

/** Energy over a period as the bill states it beside its lines (index readings), per band. */
export interface StatedConsumption {
  band: string | null;
  season?: string | null;
  start: string;
  end: string;
  kwh: Figure;
}

/** How the contract prices energy over time. */
export type ContractType = 'fixed' | 'variable' | 'indexed';

export interface EnergyFields {
  /** The connection point the bill is for, with its scheme (an `identifier_schemes` code: a GSRN, a national scheme). */
  meter: {
    identifier: string;
    scheme: string;
    resource?: 'electricity' | 'gas' | 'heat' | 'water';
    /** The grid operator the bill names, by the code its country's pack gives it. */
    operator?: string | null;
  } | null;
  /** The time-of-use bands the bill prints, with their hours when it says them (local wall-clock `HH:MM` windows). */
  bands?: { code: string; label?: string | null; hours?: [string, string][] | null }[];
  /** The seasons the bill names. */
  seasons?: { code: string; label?: string | null }[];
  /** The facts of the lines of the invoice; a line not named here is `other`. */
  lines: LineFacts[];
  /** Amounts stated as information only. */
  stated?: StatedAmount[];
  /** Energy per band and period stated beside the lines; read when the lines carry no volume. */
  consumption?: StatedConsumption[];
  /** The subtotal the bill prints for its energy section, when it does: what confirms the lines. */
  energyTotal?: { kwh: Figure | null; amount: Figure | null } | null;
  /** The contract type and the printed words it was read on. A type without its words is not kept. */
  contract?: { type: ContractType | null; evidence: string | null } | null;
  /** The subscribed power, with its UN/ECE unit (KWT, KVA) and the printed words. */
  power?: { value: Figure; unitCode: string; evidence?: string | null } | null;
}

/** What `readEnergyBill` reads: the invoice and its energy. */
export interface EnergyBillInput {
  invoice: ReceivedInvoice;
  energy: EnergyFields;
}

/** A remark on the reading. A `warning` says a figure may be wrong; a `note` gives context and changes no figure. */
export interface Remark {
  code: string;
  kind: 'warning' | 'note';
  message: string;
  /** The line it is about (BT-126), when it is about one. */
  line?: string;
}

/** The energy of one band and season, counted once whatever the components billed on it. */
export interface BandEnergy {
  band: string | null;
  season: string | null;
  kwh: number | null;
}

/** What a kWh of one band and season costs, every component added up, per kWh in the invoice's currency. */
export interface BandPrice {
  band: string | null;
  season: string | null;
  /** What the kWh of the bill cost: each component weighted by its volumes over its sub-periods. */
  billed: number | null;
  /** The price in force at the end of the bill: each component at its latest dated sub-period; null when the lines do not say. */
  latest: number | null;
  /** False when prices of a component were averaged without volumes. */
  weighted: boolean;
}

export interface EnergyBillReading {
  invoice: {
    number: string;
    issueDate: string;
    kind: 'invoice' | 'credit_note';
    /** ISO 4217, the invoice's BT-5: every amount and price of the reading is in it. */
    currency: string;
    seller: { name: string | null; vatId: string | null; legalId: string | null };
    buyer: { name: string | null; vatId: string | null; legalId: string | null };
    invoicingPeriod: { start: string | null; end: string | null } | null;
  };
  meter: { identifier: string; scheme: string; resource: 'electricity' | 'gas' | 'heat' | 'water'; operator: string | null } | null;
  /** The consumption period: the union of the dates of the consumption lines, inclusive; the invoicing period without dated lines. */
  period: { start: string; end: string } | null;
  energy: {
    /** kWh of the period, each kWh counted once. */
    kwh: number | null;
    bands: BandEnergy[];
  };
  prices: BandPrice[];
  revision: { since: string | null; changes: number | null };
  /** Which price stands for the kWh to come: the latest for a fixed price revised on a date, the billed one otherwise. */
  projection: 'latest' | 'weighted';
  contract: { type: ContractType; evidence: string } | null;
  power: { value: number; unitCode: string; evidence: string | null } | null;
  bands: { code: string; label: string | null; hours: [string, string][] | null }[];
  network: {
    /** True: included in the energy price, its figures informative; false: billed on its own lines; null: the bill does not say. */
    included: boolean | null;
    fixed: number | null;
    variable: number | null;
    variablePerKwh: number | null;
    label: string | null;
  };
  taxes: { perKwh: number | null; label: string | null; amount: number | null };
  contributions: { rate: number | null; amount: number | null; label: string | null };
  subscription: { amount: number | null };
  totals: {
    lines: number;
    lineTotal: number | null;
    taxExclusive: number;
    tax: number | null;
    taxInclusive: number;
    payable: number;
    /** The printed totals agree with one another and with the lines. */
    agree: boolean;
  };
  remarks: Remark[];
}
