// An energy bill, read once: the invoice a generic reader returned, and the
// energy facts beside it, brought to one typed reading.
//
// Nothing here reads a PDF, calls a model or knows a country. Units are the
// invoice's UN/ECE codes (Recommendation 20): energy in KWH, MWH, WHR or GWH
// becomes kWh, a price per MWh a price per kWh; amounts stay in the currency of
// the invoice, which is never assumed. What the figures say against one
// another is checked, never corrected by arithmetic, and said in `remarks`.

import type { ReceivedInvoice, ReceivedLine } from '@ekwo-ai/factur-x';
import {
  AMOUNT_TOLERANCE,
  bandGrid,
  billedKwh,
  contributionSummary,
  deliveryBilling,
  distinctLabels,
  lineDisagrees,
  periodOfLines,
  projection,
  reconcileLines,
  round,
  sameVolume,
  taxPerKwh,
  wholeSeasons,
  type Billed,
  type Delivery,
  type Report,
} from './prices.js';
import type { EnergyBillInput, EnergyBillReading, Figure, LineFacts, Remark } from './types.js';

/** kWh in one unit of energy, by UN/ECE Recommendation 20 code. */
export const KWH_PER_UNIT: Readonly<Record<string, number>> = { WHR: 0.001, KWH: 1, MWH: 1000, GWH: 1_000_000 };

/** A figure of the bill as a number; null when absent or not a number. */
export function figure(value: Figure | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = (value: string | null | undefined): string | null => (value && ISO_DATE.test(value) ? value : null);

/** The quantity of a line in kWh; null when its unit is not one of energy. */
function lineKwh(line: ReceivedLine): number | null {
  const factor = line.unitCode ? KWH_PER_UNIT[line.unitCode] : undefined;
  const quantity = figure(line.quantity);
  return factor === undefined || quantity === null ? null : round(quantity * factor, 6);
}

/** The net price of a line per kWh: BT-146 over its base quantity (BT-149) in its unit (BT-150, else the line's). */
function linePricePerKwh(line: ReceivedLine): number | null {
  const price = figure(line.netPrice);
  const unit = line.priceBaseUnitCode ?? line.unitCode;
  const factor = unit ? KWH_PER_UNIT[unit] : undefined;
  if (price === null || factor === undefined) return null;
  const base = figure(line.priceBaseQuantity) ?? 1;
  return base > 0 ? round(price / base / factor, 8) : null;
}

/**
 * Reads the energy of a bill. Refuses, by name, what it cannot read at all:
 * `line_unknown` (facts about a line the invoice does not have),
 * `meter_scheme_required`.
 */
export function readEnergyBill(input: EnergyBillInput): EnergyBillReading {
  const { invoice, energy } = input;
  const remarks: Remark[] = [];
  const report: Report = (code, message, kind = 'warning', line) => remarks.push({ code, kind, message, ...(line ? { line } : {}) });

  if (energy.meter && !energy.meter.scheme) throw new Error('meter_scheme_required: a meter identifier is read with its scheme');
  const byId = new Map(invoice.lines.map((line) => [line.id, line]));
  const facts = new Map<string, LineFacts>();
  for (const fact of energy.lines) {
    if (!byId.has(fact.line)) throw new Error(`line_unknown: the invoice has no line ${fact.line}`);
    facts.set(fact.line, fact);
  }
  const role = (line: ReceivedLine) => facts.get(line.id)?.role ?? 'other';
  const labelOf = (line: ReceivedLine) => facts.get(line.id)?.label ?? line.name ?? line.description ?? null;
  const ofRole = (r: string) => invoice.lines.filter((line) => role(line) === r);

  // ── Consumption lines ──
  const consumption: Billed[] = ofRole('energy').map((line) => {
    const fact = facts.get(line.id)!;
    const kwh = lineKwh(line);
    if (kwh === null && line.quantity !== null) {
      report('energy_unit_unknown', `Line ${line.id} bills energy in ${line.unitCode ?? 'no unit'}, which is not a unit of energy: its volume is not read.`, 'warning', line.id);
    }
    return {
      id: line.id,
      label: labelOf(line),
      band: fact.band ?? null,
      season: fact.season ?? null,
      start: date(line.period?.start),
      end: date(line.period?.end),
      kwh: kwh !== null && kwh >= 0 ? kwh : null,
      price: linePricePerKwh(line),
      amount: figure(line.netAmount),
    };
  });
  const printedEnergy = { kwh: figure(energy.energyTotal?.kwh), amount: figure(energy.energyTotal?.amount) };
  const reconciled = reconcileLines(consumption, printedEnergy, report);
  // A negative amount takes back what an earlier bill billed: kept on the bill, never a price, a volume or a period of this one.
  const billing = reconciled.filter((line) => !(line.amount !== null && line.amount < 0));
  if (billing.length < reconciled.length) {
    report('correction_set_aside', `${reconciled.length - billing.length} consumption line(s) with a negative amount (an earlier bill taken back) left out of the prices, volumes and period.`, 'note');
  }

  // Energy stated beside the lines (index readings) serves when the lines carry no volume.
  const stated = (energy.consumption ?? []).map((c) => ({ band: c.band, season: c.season ?? null, start: c.start, end: c.end, kwh: figure(c.kwh) }));
  const seasoned = wholeSeasons(billing, report);
  const order = (energy.bands ?? []).map((band) => band.code);
  const grid = bandGrid(seasoned, order, report);
  const linesKwh = billedKwh(seasoned);
  const statedKwh = stated.length > 0 && stated.every((c) => c.kwh !== null) ? round(stated.reduce((s, c) => s + (c.kwh as number), 0), 3) : null;
  let kwh = linesKwh ?? statedKwh ?? printedEnergy.kwh;
  let bands = grid.energy;
  if (linesKwh === null && statedKwh !== null) {
    bands = stated.map((c) => ({ band: c.band, season: c.season, kwh: c.kwh }));
    report('energy_from_statement', 'The consumption lines carry no volume: the energy is the one the bill states beside them.', 'note');
  }
  const reference = linesKwh !== null ? statedKwh ?? printedEnergy.kwh : null;
  if (linesKwh !== null && reference !== null && !sameVolume(reference, linesKwh)) {
    report('energy_stated_differs', `The bill states ${reference} kWh, but its consumption lines bill ${linesKwh} kWh over their period: the volume of the lines is used.`);
  }
  if (invoice.kind === 'credit_note') report('credit_note', 'The document is a credit note: its figures are positive as printed, and give money back.', 'note');

  // ── Period ──
  const period = periodOfLines(seasoned) ?? periodOfLines(stated)
    ?? (invoice.invoicingPeriod?.start && invoice.invoicingPeriod.end ? { start: invoice.invoicingPeriod.start, end: invoice.invoicingPeriod.end } : null);

  // ── Contract, power ──
  const claimed = energy.contract?.type ?? null;
  const evidence = energy.contract?.evidence?.trim() || null;
  if (claimed && !evidence) report('contract_without_evidence', `Contract type "${claimed}" dropped: no printed words were given for it.`, 'note');
  const contract = claimed && evidence ? { type: claimed, evidence } : null;
  const powerValue = figure(energy.power?.value);
  const power = energy.power && powerValue !== null && powerValue > 0 ? { value: powerValue, unitCode: energy.power.unitCode, evidence: energy.power.evidence ?? null } : null;

  // ── Network delivery ──
  const delivery: Delivery[] = [
    ...ofRole('network').map((line): Delivery => {
      const kwhOf = lineKwh(line);
      const fact = facts.get(line.id)!;
      return {
        label: labelOf(line),
        kind: kwhOf !== null ? 'variable' : fact.kind ?? null,
        kwh: kwhOf,
        price: kwhOf !== null ? linePricePerKwh(line) : null,
        amount: figure(line.netAmount),
        inTotal: true,
      };
    }),
    ...(energy.stated ?? []).map((s): Delivery => ({ label: s.label, kind: s.kind, kwh: null, price: null, amount: figure(s.amount), inTotal: false })),
  ];
  for (const line of delivery.filter((d) => d.inTotal && lineDisagrees(d))) {
    report('network_line_disagrees', `Network line "${line.label ?? '?'}": ${line.kwh} kWh at ${line.price} do not give the ${line.amount} printed — amount kept, to be checked.`);
  }
  const network = deliveryBilling(delivery, kwh, report);

  // ── Taxes per kWh, contributions, subscription ──
  const taxLines = ofRole('tax').map((line) => ({ id: line.id, label: labelOf(line), kwh: lineKwh(line), price: lineKwh(line) !== null ? linePricePerKwh(line) : null, amount: figure(line.netAmount) }));
  for (const line of taxLines.filter(lineDisagrees)) {
    report('tax_line_disagrees', `Tax line ${line.id}: ${line.kwh} kWh at ${line.price} do not give the ${line.amount} printed — rate kept, to be checked.`, 'warning', line.id);
  }
  const perKwhTaxes = taxLines.filter((line) => line.price !== null);
  const taxAmount = taxLines.length > 0 ? round(taxLines.reduce((s, line) => s + (line.amount ?? 0), 0), 2) : null;
  const contributionLines = ofRole('contribution').map((line) => {
    const fact = facts.get(line.id)!;
    const base = figure(fact.base);
    const rate = figure(fact.rate);
    return { label: labelOf(line), base: base !== null && base > 0 ? base : null, rate: rate !== null && rate > 0 && rate < 1 ? rate : null, amount: figure(line.netAmount) };
  });
  const contributions = contributionSummary(contributionLines);
  const subscriptionLines = ofRole('subscription');
  const subscription = subscriptionLines.length > 0 ? round(subscriptionLines.reduce((s, line) => s + (figure(line.netAmount) ?? 0), 0), 2) : null;

  // ── Totals: as printed, checked against one another and against the lines ──
  const t = invoice.totals;
  const lines = round(invoice.lines.reduce((s, line) => s + (figure(line.netAmount) ?? 0), 0), 2);
  const taxExclusive = figure(t.taxExclusive) as number;
  const taxTotal = figure(t.taxTotal) ?? (invoice.taxes.length > 0 ? round(invoice.taxes.reduce((s, x) => s + (figure(x.tax) ?? 0), 0), 2) : null);
  const taxInclusive = figure(t.taxInclusive) as number;
  let agree = true;
  const near = (a: number, b: number) => Math.abs(a - b) <= AMOUNT_TOLERANCE;
  const lineTotal = figure(t.lineTotal);
  if (lineTotal !== null && !near(lines, lineTotal)) {
    agree = false;
    report('lines_disagree_with_total', `The lines add up to ${lines}, the sum of lines printed is ${lineTotal}: a line was misread or missed.`);
  }
  const net = round((lineTotal ?? lines) - (figure(t.allowanceTotal) ?? 0) + (figure(t.chargeTotal) ?? 0), 2);
  if (!near(net, taxExclusive)) {
    agree = false;
    report('lines_disagree_with_total', `The lines, allowances and charges give ${net}, the total excluding tax printed is ${taxExclusive}.`);
  }
  if (taxTotal !== null && !near(round(taxExclusive + taxTotal, 2), taxInclusive)) {
    agree = false;
    report('totals_disagree', `Printed totals disagree: ${taxExclusive} excluding tax + ${taxTotal} of tax give ${round(taxExclusive + taxTotal, 2)}, the total including tax reads ${taxInclusive}; none is corrected.`);
  }

  const party = (p: ReceivedInvoice['seller']) => ({ name: p.name, vatId: p.vatId, legalId: p.legalId?.value ?? null });
  return {
    invoice: {
      number: invoice.number,
      issueDate: invoice.issueDate,
      kind: invoice.kind,
      currency: invoice.currency,
      seller: party(invoice.seller),
      buyer: party(invoice.buyer),
      invoicingPeriod: invoice.invoicingPeriod,
    },
    meter: energy.meter ? { identifier: energy.meter.identifier, scheme: energy.meter.scheme, resource: energy.meter.resource ?? 'electricity', operator: energy.meter.operator ?? null } : null,
    period,
    energy: { kwh: kwh === null ? null : round(kwh, 3), bands },
    prices: grid.prices,
    revision: grid.revision,
    projection: projection(contract?.type ?? null, grid.revision.since !== null, grid.latestTold),
    contract,
    power,
    bands: (energy.bands ?? []).map((band) => ({ code: band.code, label: band.label ?? null, hours: band.hours ?? null })),
    network,
    taxes: { perKwh: taxPerKwh(perKwhTaxes), label: distinctLabels(perKwhTaxes), amount: taxAmount },
    contributions: { ...contributions, label: distinctLabels(contributionLines) },
    subscription: { amount: subscription },
    totals: { lines, lineTotal, taxExclusive, tax: taxTotal, taxInclusive, payable: figure(t.payable) as number, agree },
    remarks,
  };
}

/** The price a reading projects for one band and season: its latest or its billed price, as `projection` says. */
export function projectedPrice(reading: EnergyBillReading, band: string | null, season: string | null = null): number | null {
  const p = reading.prices.find((x) => x.band === band && x.season === season);
  if (!p) return null;
  return reading.projection === 'latest' ? p.latest : p.billed;
}

/** The price a kWh of the bill stands at over every band: each band's projected price weighted by its kWh. */
export function meanProjectedPrice(reading: EnergyBillReading): number | null {
  let amount = 0;
  let kwh = 0;
  for (const p of reading.prices) {
    const price = reading.projection === 'latest' ? p.latest : p.billed;
    const e = reading.energy.bands.find((b) => b.band === p.band && b.season === p.season)?.kwh ?? null;
    if (price === null || e === null) return reading.prices.length === 1 ? price : null;
    amount += price * e;
    kwh += e;
  }
  return kwh > 0 ? round(amount / kwh, 5) : null;
}
