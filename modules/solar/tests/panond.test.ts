// PAN and OND files land as products of the catalogue with their physics,
// through the solar module's importer: a module's PVsyst one-diode model,
// its two currents solved so that it gives back the file's Isc, Voc and
// nominal power, an inverter's keys and efficiency curves, a product
// refused twice by name.
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { readOnd, readPan } from '@nexgen-os/panond';
import { importProduct, pvsystModel, type PvsystModuleParameters } from '../src/products.js';
import { USER_A, asUser, freshDatabase, insert, one, organisation, repoRoot } from '../../../tests/helpers/db.js';

const fixture = (name: string) => readFile(`${repoRoot}/packages/formats/panond/tests/fixtures/${name}`, 'utf8');

/** The current of the one-diode model at a voltage, at the reference conditions. */
function current(p: PvsystModuleParameters, v: number): number {
  const nNsVth = p.gamma_ref * p.cells_in_series * (1.380649e-23 * 298.15) / 1.602176634e-19;
  let lo = -1;
  let hi = p.I_L_ref + 1;
  for (let k = 0; k < 100; k++) {
    const i = (lo + hi) / 2;
    const f = p.I_L_ref - p.I_o_ref * Math.expm1((v + i * p.R_s) / nNsVth) - (v + i * p.R_s) / p.R_sh_ref - i;
    if (f > 0) lo = i;
    else hi = i;
  }
  return lo;
}

describe("a PAN file's one-diode model", () => {
  it("solves the two currents from Isc and Voc, and gives back the file's Isc, Voc and nominal power", async () => {
    const pan = readPan(await fixture('example-module.PAN'));
    const p = pvsystModel(pan);
    expect(p).toMatchObject(pan.parameters);
    // The currents the pvlib engine's tests run this module with.
    expect([p.I_L_ref, p.I_o_ref]).toEqual([13.90531675, 9.1907963e-12]);
    expect(current(p, 0)).toBeCloseTo(13.9, 6);
    expect(current(p, 38.9)).toBeCloseTo(0, 5);
    let pmax = 0;
    for (let v = 0; v <= 38.9; v += 0.01) pmax = Math.max(pmax, v * current(p, v));
    expect(pmax).toBeGreaterThan(430 * 0.995);
    expect(pmax).toBeLessThan(430 * 1.005);
  });

  it('refuses, by name, a file whose numbers give no diode', async () => {
    const pan = readPan(await fixture('example-module.PAN'));
    expect(() => pvsystModel({ ...pan, parameters: { ...pan.parameters, R_sh_ref: 1 } })).toThrow(/^pan_inconsistent/);
  });
});

describe('products in the database', () => {
  let db: PGlite;
  let org: string;

  beforeAll(async () => {
    db = await freshDatabase(['solar']);
    org = await organisation(db, 'An installer', USER_A);
  });

  afterAll(async () => {
    await db.close();
  });

  it("adds a module to the organisation's catalogue with its pvsyst physics, as a member, and refuses it twice", async () => {
    const pan = readPan(await fixture('example-module.PAN'));
    const { productId, created } = await asUser(db, USER_A, () => importProduct(db, pan, { organisationId: org, sourceCode: null, fileName: 'example-module.PAN' }));
    expect(created).toBe(true);
    const row = await one<{ device_type: string; unit_power_kw: string; model: string; i_l: number; file: string }>(db, `
      select d.device_type, d.unit_power_kw::text, m.model, (m.parameters ->> 'I_L_ref')::float8 i_l, m.metadata ->> 'file' file
        from products d join solar.module_products m using (id) where d.id = $1`, [productId]);
    expect(row).toEqual({ device_type: 'solar', unit_power_kw: '0.430', model: 'pvsyst', i_l: pvsystModel(pan).I_L_ref, file: 'example-module.PAN' });
    await expect(asUser(db, USER_A, () => importProduct(db, pan, { organisationId: org }))).rejects.toThrow(/already_imported: Example Solar ES-M108-430/);
  });

  it('gives its physics to an inverter the catalogue already knows', async () => {
    const known = await insert(db, 'products', { organisation_id: org, device_type: 'inverter', manufacturer: 'Example Power', model: 'EP-10K', unit_power_kw: 10 });
    const { productId, created } = await importProduct(db, readOnd(await fixture('example-inverter.OND')), { organisationId: org });
    expect([productId, created]).toEqual([known, false]);
    const row = await one<{ model: string; pnom: number }>(db, `select model, (parameters #>> '{Converter,PNomConv}')::float8 pnom from solar.inverter_products where id = $1`, [known]);
    expect(row).toEqual({ model: 'ond', pnom: 10 });
  });
});
