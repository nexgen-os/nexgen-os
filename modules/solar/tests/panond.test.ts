// PAN and OND files land as products of the catalogue with their physics,
// through the solar module's importer: a module's PVsyst one-diode model, an
// inverter's keys and efficiency curves, a product refused twice by name.
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { readOnd, readPan } from '@nexgen-os/panond';
import { importProduct } from '../src/products.js';
import { USER_A, asUser, freshDatabase, insert, one, organisation, repoRoot } from '../../../tests/helpers/db.js';

const fixture = (name: string) => readFile(`${repoRoot}/packages/formats/panond/tests/fixtures/${name}`, 'utf8');

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
    expect(row).toEqual({ device_type: 'solar', unit_power_kw: '0.430', model: 'pvsyst', i_l: pan.parameters.I_L_ref, file: 'example-module.PAN' });
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
