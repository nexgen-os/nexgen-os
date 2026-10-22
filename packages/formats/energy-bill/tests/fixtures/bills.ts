// Bills of several countries, as a generic invoice reader returns them
// (`ReceivedInvoice`, EN 16931) with the energy facts beside them. Anonymised:
// the figures of the first two are those of the tests of the reader this
// library was ported from, the parties, numbers and meters are made up; the
// last two are synthetic.

import type { ReceivedInvoice, ReceivedLine } from '@ekwo-ai/factur-x';
import type { EnergyBillInput, LineFacts } from '../../src/types.js';

export interface Printed {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  /** Net price per unit of `unit` (or of `priceUnit` when given). */
  price: number | null;
  priceUnit?: string;
  /** The printed amount; quantity × price when absent. */
  amount?: number;
  start?: string | null;
  end?: string | null;
}

const party = (name: string): ReceivedInvoice['seller'] => ({
  name, tradeName: null, identifiers: [], legalId: null, vatId: null, taxRegistrationId: null, legalForm: null,
  electronicAddress: null, address: null, contact: null,
});

const text = (n: number, decimals = 2) => n.toFixed(decimals);

export function line(p: Printed): ReceivedLine {
  const amount = p.amount ?? Math.round((p.quantity ?? 0) * (p.price ?? 0) * 100) / 100;
  return {
    id: p.id, note: null, quantity: p.quantity === null ? null : String(p.quantity), unitCode: p.unit, netAmount: text(amount),
    orderLineReference: null, period: p.start || p.end ? { start: p.start ?? null, end: p.end ?? null } : null, allowances: [],
    netPrice: p.price === null ? null : String(p.price), priceDiscount: null, grossPrice: null, priceBaseQuantity: null,
    priceBaseUnitCode: p.priceUnit ?? null, vatCategory: 'S', vatRate: null, name: p.name, description: null,
    sellerItemId: null, buyerItemId: null, standardItemId: null,
  };
}

/** An invoice whose totals add up, unless `totals` overrides them. */
export function invoice(o: {
  number: string; issueDate: string; currency: string; seller: string; buyer: string; vatRate: number;
  period?: { start: string; end: string }; lines: Printed[]; totals?: Partial<ReceivedInvoice['totals']>; kind?: 'invoice' | 'credit_note';
}): ReceivedInvoice {
  const lines = o.lines.map(line);
  const lineTotal = Math.round(lines.reduce((s, l) => s + Number(l.netAmount), 0) * 100) / 100;
  const tax = Math.round(lineTotal * o.vatRate) / 100;
  return {
    syntax: 'cii', customizationId: null, profileId: null, kind: o.kind ?? 'invoice', typeCode: '380', number: o.number,
    issueDate: o.issueDate, dueDate: null, taxPointDate: null, currency: o.currency, taxCurrency: null, buyerReference: null,
    orderReference: null, salesOrderReference: null, contractReference: null, projectReference: null, accountingCost: null,
    precedingInvoices: [], notes: [], seller: party(o.seller), buyer: party(o.buyer), deliveryDate: null, deliveryAddress: null,
    invoicingPeriod: o.period ?? null, paymentTerms: null, paymentMeans: [], allowances: [],
    taxes: [{ category: 'S', rate: String(o.vatRate), base: text(lineTotal), tax: text(tax), exemptionReasonCode: null, exemptionReason: null }],
    totals: {
      lineTotal: text(lineTotal), allowanceTotal: null, chargeTotal: null, taxExclusive: text(lineTotal), taxTotal: text(tax),
      taxTotalInTaxCurrency: null, taxInclusive: text(lineTotal + tax), prepaid: null, rounding: null, payable: text(lineTotal + tax),
      ...o.totals,
    },
    lines, attachments: [],
  };
}

const facts = (role: LineFacts['role'], ids: string[], extra: Omit<LineFacts, 'line' | 'role'> = {}): LineFacts[] =>
  ids.map((id) => ({ line: id, role, ...extra }));

/**
 * A bill whose prices were revised mid-period: peak and off-peak on two
 * sub-periods each, a per-kWh tax revised on the same date, a contribution on
 * a fixed base, network delivery stated as information only.
 */
export const TWO_PERIODS: EnergyBillInput = {
  invoice: invoice({
    number: 'A-2026-0817', issueDate: '2026-08-17', currency: 'EUR', seller: 'Supplier A', buyer: 'Farm One', vatRate: 20,
    period: { start: '2026-08-01', end: '2026-08-31' },
    lines: [
      { id: '1', name: 'Electricity peak hours', quantity: 2182, unit: 'KWH', price: 0.1351, start: '2026-07-16', end: '2026-07-31' },
      { id: '2', name: 'Electricity peak hours', quantity: 2045, unit: 'KWH', price: 0.1407, start: '2026-08-01', end: '2026-08-15' },
      { id: '3', name: 'Electricity off-peak hours', quantity: 982, unit: 'KWH', price: 0.0989, start: '2026-07-16', end: '2026-07-31' },
      { id: '4', name: 'Electricity off-peak hours', quantity: 920, unit: 'KWH', price: 0.0999, start: '2026-08-01', end: '2026-08-15' },
      { id: '5', name: 'Excise on electricity', quantity: 3163, unit: 'KWH', price: 0.03085, amount: 97.58, start: '2026-07-16', end: '2026-07-31' },
      { id: '6', name: 'Excise on electricity', quantity: 2966, unit: 'KWH', price: 0.03062, amount: 90.82, start: '2026-08-01', end: '2026-08-15' },
      { id: '7', name: 'Network contribution', quantity: 1, unit: 'C62', price: 6.32, start: '2026-07-16', end: '2026-08-16' },
      { id: '8', name: 'Subscription', quantity: 1, unit: 'MON', price: 42.81, start: '2026-08-01', end: '2026-08-31' },
    ],
  }),
  energy: {
    meter: { identifier: '00000000000017', scheme: 'prm' },
    bands: [{ code: 'peak', label: 'Peak hours' }, { code: 'offpeak', label: 'Off-peak hours', hours: [['23:00', '07:00']] }],
    lines: [
      ...facts('energy', ['1', '2'], { band: 'peak' }),
      ...facts('energy', ['3', '4'], { band: 'offpeak' }),
      ...facts('tax', ['5', '6']),
      { line: '7', role: 'contribution', base: '42.14', rate: '0.15' },
      { line: '8', role: 'subscription' },
    ],
    stated: [
      { role: 'network', label: 'Delivery - fixed part', kind: 'fixed', amount: '42.14' },
      { role: 'network', label: 'Delivery - variable part', kind: 'variable', amount: '90.53' },
    ],
    energyTotal: { kwh: 6129, amount: null },
    power: { value: '36', unitCode: 'KVA', evidence: 'Subscribed power 36 kVA' },
  },
};

/**
 * A bill that takes back an earlier one (negative lines), bills those kWh
 * again at a price revised on 1 January, and names its season on every band;
 * the contract is a fixed price, in the words the bill prints.
 */
export const REVISION: EnergyBillInput = {
  invoice: invoice({
    number: 'A-2026-0212', issueDate: '2026-02-12', currency: 'EUR', seller: 'Supplier A', buyer: 'Workshop Two', vatRate: 20,
    lines: [
      { id: '1', name: 'Take-back peak hours winter', quantity: null, unit: 'KWH', price: 0.14173, amount: -923.8, start: '2025-12-11', end: '2026-01-10' },
      { id: '2', name: 'Take-back off-peak hours winter', quantity: null, unit: 'KWH', price: 0.10079, amount: -134.35, start: '2025-12-11', end: '2026-01-10' },
      { id: '3', name: 'Billed again peak hours winter', quantity: 4415, unit: 'KWH', price: 0.14173, amount: 625.74, start: '2025-12-11', end: '2025-12-31' },
      { id: '4', name: 'Billed again peak hours winter', quantity: 2103, unit: 'KWH', price: 0.11819, amount: 248.55, start: '2026-01-01', end: '2026-01-10' },
      { id: '5', name: 'Billed again off-peak hours winter', quantity: 903, unit: 'KWH', price: 0.10079, amount: 91.01, start: '2025-12-11', end: '2025-12-31' },
      { id: '6', name: 'Billed again off-peak hours winter', quantity: 430, unit: 'KWH', price: 0.0839, amount: 36.08, start: '2026-01-01', end: '2026-01-10' },
      { id: '7', name: 'Peak hours winter', quantity: 9965, unit: 'KWH', price: 0.11819, amount: 1177.76, start: '2026-01-11', end: '2026-02-10' },
      { id: '8', name: 'Off-peak hours winter', quantity: 1385, unit: 'KWH', price: 0.0839, amount: 116.2, start: '2026-01-11', end: '2026-02-10' },
    ],
  }),
  energy: {
    meter: { identifier: '00000000000024', scheme: 'prm' },
    bands: [{ code: 'peak' }, { code: 'offpeak' }],
    seasons: [{ code: 'winter', label: 'Winter' }],
    lines: [
      ...facts('energy', ['1', '3', '4', '7'], { band: 'peak', season: 'winter' }),
      ...facts('energy', ['2', '5', '6', '8'], { band: 'offpeak', season: 'winter' }),
    ],
    // The total printed for one sub-period only.
    energyTotal: { kwh: 11350, amount: null },
    contract: { type: 'fixed', evidence: 'Fixed price offer, prices revised on 1 January' },
  },
};

/**
 * A day / night bill whose green certificates are billed on every kWh, network
 * delivery billed on its own lines (a variable part per kWh and a metering
 * fee), and a levy per kWh. Synthetic.
 */
export const DAY_NIGHT: EnergyBillInput = {
  invoice: invoice({
    number: 'B-26-000431', issueDate: '2026-04-03', currency: 'EUR', seller: 'Supplier B', buyer: 'Household Three', vatRate: 6,
    period: { start: '2026-03-01', end: '2026-03-31' },
    lines: [
      { id: '10', name: 'Energy day', quantity: 1200, unit: 'KWH', price: 0.11, start: '2026-03-01', end: '2026-03-31' },
      { id: '11', name: 'Energy night', quantity: 800, unit: 'KWH', price: 0.09, start: '2026-03-01', end: '2026-03-31' },
      { id: '12', name: 'Green certificates', quantity: 2000, unit: 'KWH', price: 0.012, start: '2026-03-01', end: '2026-03-31' },
      { id: '13', name: 'Distribution', quantity: 2000, unit: 'KWH', price: 0.06, start: '2026-03-01', end: '2026-03-31' },
      { id: '14', name: 'Metering', quantity: 1, unit: 'MON', price: 15, start: '2026-03-01', end: '2026-03-31' },
      { id: '15', name: 'Energy levy', quantity: 2000, unit: 'KWH', price: 0.0475, start: '2026-03-01', end: '2026-03-31' },
    ],
  }),
  energy: {
    meter: { identifier: '000000000000000017', scheme: 'gs1_gsrn' },
    bands: [{ code: 'day' }, { code: 'night', hours: [['22:00', '07:00']] }],
    lines: [
      { line: '10', role: 'energy', band: 'day' },
      { line: '11', role: 'energy', band: 'night' },
      { line: '12', role: 'energy' },
      { line: '13', role: 'network' },
      { line: '14', role: 'network', kind: 'fixed' },
      { line: '15', role: 'tax' },
    ],
    contract: { type: 'variable', evidence: null },
  },
};

/**
 * A bill in another currency than the euro, priced per MWh: one band, network
 * delivery per MWh, a levy per kWh and a monthly fee. Synthetic.
 */
export const OTHER_CURRENCY: EnergyBillInput = {
  invoice: invoice({
    number: 'C-7781', issueDate: '2026-07-05', currency: 'CHF', seller: 'Utility C', buyer: 'Shop Four', vatRate: 8.1,
    period: { start: '2026-06-01', end: '2026-06-30' },
    lines: [
      { id: 'E', name: 'Energy', quantity: 3.2, unit: 'MWH', price: 145, start: '2026-06-01', end: '2026-06-30' },
      { id: 'N', name: 'Grid use', quantity: 3.2, unit: 'MWH', price: 92, start: '2026-06-01', end: '2026-06-30' },
      { id: 'T', name: 'Levy', quantity: 3200, unit: 'KWH', price: 0.023, start: '2026-06-01', end: '2026-06-30' },
      { id: 'S', name: 'Monthly fee', quantity: 1, unit: 'MON', price: 12, start: '2026-06-01', end: '2026-06-30' },
    ],
  }),
  energy: {
    meter: { identifier: '000000000000000024', scheme: 'gs1_gsrn' },
    lines: [
      { line: 'E', role: 'energy' },
      { line: 'N', role: 'network' },
      { line: 'T', role: 'tax' },
      { line: 'S', role: 'subscription' },
    ],
    power: { value: 25, unitCode: 'KWT' },
  },
};
