// @nexgen-os/energy-bill: bills of several countries, read once by a generic
// invoice reader, then their energy.
import { describe, expect, it } from 'vitest';
import { componentsOf, meanProjectedPrice, priceRevision, projectedPrice, readEnergyBill } from '../src/index.js';
import type { EnergyBillInput } from '../src/index.js';
import { DAY_NIGHT, OTHER_CURRENCY, REVISION, TWO_PERIODS, invoice } from './fixtures/bills.js';

const price = (r: ReturnType<typeof readEnergyBill>, band: string | null, season: string | null = null) => r.prices.find((p) => p.band === band && p.season === season);
const codes = (r: ReturnType<typeof readEnergyBill>, kind: 'warning' | 'note') => r.remarks.filter((x) => x.kind === kind).map((x) => x.code);

describe('a price revised mid-period', () => {
  const r = readEnergyBill(TWO_PERIODS);

  it('is one band at a volume-weighted price, not two seasons', () => {
    // (2182 × 0.1351 + 2045 × 0.1407) / 4227 and (982 × 0.0989 + 920 × 0.0999) / 1902
    expect(price(r, 'peak')).toEqual({ band: 'peak', season: null, billed: 0.13781, latest: 0.1407, weighted: true });
    expect(price(r, 'offpeak')).toEqual({ band: 'offpeak', season: null, billed: 0.09938, latest: 0.0999, weighted: true });
    expect(r.energy).toEqual({ kwh: 6129, bands: [{ band: 'peak', season: null, kwh: 4227 }, { band: 'offpeak', season: null, kwh: 1902 }] });
    expect(r.revision).toEqual({ since: '2026-08-01', changes: 1 });
  });

  it('projects the weighted price when the bill does not say how the contract prices energy', () => {
    expect(r.contract).toBeNull();
    expect(r.projection).toBe('weighted');
    expect(projectedPrice(r, 'peak')).toBe(0.13781);
    expect(meanProjectedPrice(r)).toBe(Math.round(((4227 * 0.13781 + 1902 * 0.09938) / 6129) * 1e5) / 1e5);
  });

  it('dates the consumption by its lines, never by the invoicing period', () => {
    expect(r.period).toEqual({ start: '2026-07-16', end: '2026-08-15' });
    expect(r.invoice.invoicingPeriod).toEqual({ start: '2026-08-01', end: '2026-08-31' });
  });

  it('keeps taxes per kWh, contributions on a fixed base and the subscription apart', () => {
    // 0.03085 and 0.03062, weighted over 3163 and 2966 kWh: one tax revised mid-period.
    expect(r.taxes).toEqual({ perKwh: 0.03074, label: 'Excise on electricity', amount: 188.4 });
    expect(r.contributions).toEqual({ rate: 0.15, amount: 6.32, label: 'Network contribution' });
    expect(r.subscription.amount).toBe(42.81);
  });

  it('reads network delivery stated as information as included in the energy price', () => {
    expect(r.network).toEqual({ included: true, fixed: 42.14, variable: 90.53, variablePerKwh: 0.01477, label: 'Delivery - variable part' });
  });

  it('keeps the currency, the meter and the power the bill prints, and reconciles its totals', () => {
    expect(r.invoice.currency).toBe('EUR');
    expect(r.meter).toEqual({ identifier: '00000000000017', scheme: 'prm', resource: 'electricity', operator: null });
    expect(r.power).toEqual({ value: 36, unitCode: 'KVA', evidence: 'Subscribed power 36 kVA' });
    expect(r.totals.agree).toBe(true);
    expect(r.remarks).toEqual([]);
  });
});

describe('a bill that takes back an earlier one and revises its price', () => {
  const r = readEnergyBill(REVISION);

  it('leaves the take-back out of prices, volumes and period, with a note', () => {
    // (4415 × 0.14173 + 2103 × 0.11819 + 9965 × 0.11819) / 16483 — never 0.14173 stacked on top.
    expect(price(r, 'peak', 'winter')?.billed).toBe(0.1245);
    expect(price(r, 'offpeak', 'winter')?.billed).toBe(0.08951);
    expect(r.energy.kwh).toBe(19201);
    expect(r.period).toEqual({ start: '2025-12-11', end: '2026-02-10' });
    expect(codes(r, 'note')).toContain('correction_set_aside');
  });

  it('uses the volume of the lines over a total printed for one sub-period, and says so', () => {
    expect(codes(r, 'warning')).toEqual(['energy_stated_differs']);
  });

  it('projects the latest price of a fixed price revised on a date', () => {
    expect(r.contract).toEqual({ type: 'fixed', evidence: 'Fixed price offer, prices revised on 1 January' });
    expect(r.revision).toEqual({ since: '2026-01-01', changes: 1 });
    expect(r.projection).toBe('latest');
    expect(projectedPrice(r, 'peak', 'winter')).toBe(0.11819);
    expect(projectedPrice(r, 'offpeak', 'winter')).toBe(0.0839);
  });
});

describe('a day / night bill with a component on every kWh', () => {
  const r = readEnergyBill(DAY_NIGHT);

  it('adds the every-hour component to each band and counts each kWh once', () => {
    expect(price(r, 'day')?.billed).toBe(0.122);
    expect(price(r, 'night')?.billed).toBe(0.102);
    expect(price(r, null)).toBeUndefined();
    expect(r.energy.kwh).toBe(2000);
    expect(r.bands).toEqual([{ code: 'day', label: null, hours: null }, { code: 'night', label: null, hours: [['22:00', '07:00']] }]);
  });

  it('reads network delivery billed on its own lines: a fixed part and a variable part per kWh', () => {
    expect(r.network).toEqual({ included: false, fixed: 15, variable: 120, variablePerKwh: 0.06, label: 'Distribution' });
    expect(r.taxes.perKwh).toBe(0.0475);
  });

  it('drops a contract type claimed without the words printed for it', () => {
    expect(r.contract).toBeNull();
    expect(codes(r, 'note')).toEqual(['contract_without_evidence']);
  });
});

describe('a bill in another currency, priced per MWh', () => {
  const r = readEnergyBill(OTHER_CURRENCY);

  it('keeps the currency of the invoice and reads MWh as kWh', () => {
    expect(r.invoice.currency).toBe('CHF');
    expect(r.energy.kwh).toBe(3200);
    expect(price(r, null)).toEqual({ band: null, season: null, billed: 0.145, latest: 0.145, weighted: true });
    expect(r.network).toMatchObject({ included: false, variable: 294.4, variablePerKwh: 0.092 });
    expect(r.taxes.perKwh).toBe(0.023);
    expect(r.subscription.amount).toBe(12);
    expect(r.power).toEqual({ value: 25, unitCode: 'KWT', evidence: null });
    expect(r.totals).toMatchObject({ lines: 844, taxExclusive: 844, agree: true });
  });
});

describe('the figures of a bill against one another', () => {
  it('puts a misread price right when the energy subtotal confirms amounts and volumes', () => {
    const misread: EnergyBillInput = {
      invoice: invoice({
        number: 'A-1', issueDate: '2026-02-17', currency: 'EUR', seller: 'S', buyer: 'B', vatRate: 20,
        lines: [
          // Printed 0.137, read as the price of the line below.
          { id: '1', name: 'Peak', quantity: 3169, unit: 'KWH', price: 0.1351, amount: 434.15, start: '2026-01-16', end: '2026-01-31' },
          { id: '2', name: 'Peak', quantity: 2971, unit: 'KWH', price: 0.1351, start: '2026-02-01', end: '2026-02-15' },
        ],
      }),
      energy: { meter: null, lines: [{ line: '1', role: 'energy', band: 'peak' }, { line: '2', role: 'energy', band: 'peak' }], energyTotal: { kwh: 6140, amount: 835.53 } },
    };
    const r = readEnergyBill(misread);
    expect(r.remarks.map((x) => x.code)).toEqual(['price_misread']);
    expect(price(r, 'peak')?.latest).toBe(0.1351);
    expect(price(r, 'peak')?.billed).toBe(Math.round(((3169 * 0.137 + 2971 * 0.1351) / 6140) * 1e5) / 1e5);
    // Without the subtotal, the price is kept as read and said.
    const kept = readEnergyBill({ ...misread, energy: { ...misread.energy, energyTotal: null } });
    expect(kept.remarks.map((x) => x.code)).toEqual(['line_disagrees']);
  });

  it('says printed totals that disagree, and corrects none', () => {
    const r = readEnergyBill({ ...OTHER_CURRENCY, invoice: { ...OTHER_CURRENCY.invoice, totals: { ...OTHER_CURRENCY.invoice.totals, taxInclusive: '900.00' } } });
    expect(r.totals).toMatchObject({ taxInclusive: 900, agree: false });
    expect(r.remarks.map((x) => x.code)).toEqual(['totals_disagree']);
  });

  it('adds components billed on the same kWh, and reads consecutive sub-periods as a revision', () => {
    const same = { season: null, start: '2026-06-07', end: '2026-07-07', kwh: 13481 };
    expect(componentsOf([same, { ...same }]).components).toHaveLength(2);
    expect(componentsOf([{ ...same, end: '2026-06-20' }, { ...same, start: '2026-06-21' }]).components).toHaveLength(1);
    expect(priceRevision([{ season: null, start: null, price: 0.1 }, { season: null, start: '2026-01-01', price: 0.2 }])).toEqual({ latest: null, since: null, changes: null });
  });

  it('refuses facts about a line the invoice does not have', () => {
    expect(() => readEnergyBill({ ...OTHER_CURRENCY, energy: { ...OTHER_CURRENCY.energy, lines: [{ line: 'X', role: 'energy' }] } })).toThrow(/^line_unknown/);
  });
});
