// The `settlement` engine contract: the example engine
// (engines/settlement-example, pure Python) on six hours of a cold store
// whose lines are worked out by hand in JSON, and its named refusals.
// Without Python, the engine's tests are skipped and say so.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETTLEMENT_EXAMPLE_ENGINE, type SettlementLine, type SettlementRequest, type SettlementResult } from '../engines/settlement.js';
import { describeEngine, runEngine, type EngineSpec } from '../engines/runner.js';
import { repoRoot } from './helpers/db.js';

// The engine from its folder, with the Python on the path: no installation needed.
const folder = join(repoRoot, 'engines', 'settlement-example');
const spec: EngineSpec = {
  ...SETTLEMENT_EXAMPLE_ENGINE,
  command: ['python3', '-c', `import sys; sys.path.insert(0, ${JSON.stringify(folder)}); from nexgen_settlement_example.run import main; sys.exit(main())`],
};
const installed = await describeEngine(spec).catch(() => null);
const skipped = installed ? '' : ' (skipped: python3 is not on the path)';

interface Fixture {
  request: SettlementRequest;
  expected: { lines: Omit<SettlementLine, 'seller' | 'buyer'>[]; contracts: SettlementResult['contracts'] };
}
const fixture = JSON.parse(await readFile(join(repoRoot, 'tests', 'fixtures', 'engines', 'settlement-day.json'), 'utf8')) as Fixture;
const settle = (request: SettlementRequest) => runEngine<SettlementRequest, SettlementResult>(spec, request);
const changed = (f: (r: SettlementRequest) => void): SettlementRequest => {
  const r = structuredClone(fixture.request);
  f(r);
  return r;
};

describe.skipIf(!installed)(`the example settlement engine${skipped}`, () => {
  it('describes itself: pure Python, the settlement kind', () => {
    expect(installed).toMatchObject({ engine: 'settlement_example', version: 'settlement_example 0.1.0', kinds: ['settlement'] });
    expect(Object.keys(installed!.dependencies)).toEqual(['nexgen_settlement_example', 'python']);
  });

  it('settles six hours of a supply, a surplus sale and a PPA, as worked out by hand', async () => {
    const { version, result } = await settle(fixture.request);
    expect(version).toBe('settlement_example 0.1.0');
    expect(result.lines.map(({ seller, buyer, ...line }) => line)).toEqual(fixture.expected.lines);
    expect(result.contracts).toEqual(fixture.expected.contracts);
    expect(result.meta).toEqual({ volume: "each contract's own series, counted once", price: 'fixed', rounding: 'six decimals, no currency\'s minor unit', rules: {} });
  });

  it('names who pays whom on every line, as the contract does', async () => {
    const { result } = await settle(fixture.request);
    const sale = result.lines.find((l) => l.contract_id === 'injection')!;
    expect(sale.seller).toEqual({ contact_id: null, name: 'Cold store cooperative' });
    expect(sale.buyer).toEqual({ contact_id: '00000000-0000-4000-8000-000800000012', name: 'Surplus buyer' });
  });

  it('cuts a line where a price changes, whatever offset the price is written in', async () => {
    const { result } = await settle(fixture.request);
    const supply = result.lines.filter((l) => l.contract_id === 'supply');
    // The second price starts at 13:00+02:00, the step stamped 11:00Z.
    expect(supply.map((l) => [l.from, l.to])).toEqual([['2026-06-20T08:00:00Z', '2026-06-20T11:00:00Z'], ['2026-06-20T11:00:00Z', '2026-06-20T14:00:00Z']]);
  });

  it('refuses by name what it cannot settle, and never assumes a price', async () => {
    await expect(settle(changed((r) => { r.contracts = []; }))).rejects.toThrow(/^contracts_missing/);
    await expect(settle(changed((r) => { r.rules = { vat: 0.25 }; }))).rejects.toThrow(/^rule_unknown: vat; this engine applies no rule$/);
    await expect(settle(changed((r) => { r.contracts[1].signals[0].starts_at = '2026-06-20T10:00:00Z'; })))
      .rejects.toThrow(/^price_missing: contract injection has no price at 2026-06-20T08:00:00\+00:00$/);
    await expect(settle(changed((r) => { r.contracts[0].signals[1].starts_at = '2026-06-20T10:30:00Z'; })))
      .rejects.toThrow(/^signal_misaligned: a price of contract supply starts or ends inside the step at 2026-06-20T10:00:00\+00:00$/);
    await expect(settle(changed((r) => { r.contracts[0].signals[0].ends_at = null; }))).rejects.toThrow(/^signals_overlap: contract supply has 2 fixed prices at 2026-06-20T11:00:00\+00:00$/);
    await expect(settle(changed((r) => { r.contracts[2].signals.push({ kind: 'cap', starts_at: '2026-01-01T00:00:00Z', ends_at: null, price: 800, currency: 'SEK', per_unit: 'MegaW-HR' }); })))
      .rejects.toThrow(/^price_kind_unsupported: 'cap' on contract ppa; this engine reads fixed prices$/);
    await expect(settle(changed((r) => { r.contracts[1].signals[0].currency = 'NOK'; r.contracts[1].signals.push({ ...r.contracts[1].signals[0], currency: 'SEK', starts_at: '2027-01-01T00:00:00Z' }); })))
      .rejects.toThrow(/^currency_mixed: contract injection is priced in NOK, SEK/);
    await expect(settle(changed((r) => { r.contracts[2].volume_basis = 'allocated_power'; }))).rejects.toThrow(/^volume_basis_unsupported: 'allocated_power' of contract ppa/);
    await expect(settle(changed((r) => { r.contracts[2].volume = { point: 'meter', quantity_code: 'offtake_energy' }; })))
      .rejects.toThrow(/^volume_counted_twice: offtake_energy of point meter is read by contracts supply and ppa/);
    await expect(settle(changed((r) => { r.contracts[2].volume.point = 'elsewhere'; }))).rejects.toThrow(/^point_unknown: contract ppa reads point 'elsewhere'/);
    await expect(settle(changed((r) => { r.points[1].series[0].quantity_code = 'ac_energy'; }))).rejects.toThrow(/^series_missing: point plant has no production_energy series$/);
    await expect(settle(changed((r) => { r.points[1].series[0].values[2].at = '2026-06-20T10:30:00Z'; }))).rejects.toThrow(/^series_misaligned: production_energy of point plant/);
  });
});
