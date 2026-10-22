// Products read from PAN and OND files, in the catalogue with their physics.
//
// `@nexgen-os/panond` reads a file into a product and its physics; this
// importer adds the product to `products` (manufacturer, model,
// unit power, surface) and its physics to `solar.module_products` (the
// `pvsyst` one-diode model in pvlib's keys) or `solar.inverter_products`
// (the `ond` model, the file's keys and efficiency curves).

import type { Db } from '@nexgen-os/core';
import type { InverterFile, ModuleFile } from '@nexgen-os/panond';

/**
 * Adds a product read from a file to the catalogue with its physics. A
 * product the catalogue already knows by manufacturer and model (an
 * organisation's own, or a shared one when `organisationId` is null) gains
 * the physics; one that already has them is refused by name
 * (`already_imported`). `sourceCode` names where the file comes from (a
 * `sources` row: a manufacturer's datasheets, a product database).
 */
export async function importProduct(
  db: Db,
  product: ModuleFile | InverterFile,
  options: { organisationId: string | null; sourceCode?: string | null; fileName?: string | null },
): Promise<{ productId: string; created: boolean }> {
  const physics = product.kind === 'module' ? 'solar.module_products' : 'solar.inverter_products';
  const known = await db.query<{ id: string; has_physics: boolean }>(
    `select d.id, exists (select 1 from ${physics} p where p.id = d.id) as has_physics
       from products d
      where d.organisation_id is not distinct from $1 and d.manufacturer = $2 and d.model_ref = $3`,
    [options.organisationId, product.manufacturer, product.model_ref],
  );
  if (known.rows[0]?.has_physics) {
    throw new Error(`already_imported: ${product.manufacturer} ${product.model_ref} has its ${product.kind} physics`);
  }
  let productId = known.rows[0]?.id;
  const created = !productId;
  if (!productId) {
    const inserted = await db.query<{ id: string }>(
      `insert into products (organisation_id, device_type, manufacturer, model_ref, unit_power_kw, unit_surface_m2)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [options.organisationId, product.kind === 'module' ? 'solar' : 'inverter', product.manufacturer, product.model_ref, product.unit_power_kw, product.unit_surface_m2],
    );
    productId = inserted.rows[0].id;
  }
  const metadata = options.fileName ? { ...product.metadata, file: options.fileName } : product.metadata;
  await db.query(
    `insert into ${physics} (id, model, parameters, source_code, metadata) values ($1, $2, $3, $4, $5)`,
    [productId, product.model, JSON.stringify(product.parameters), options.sourceCode ?? null, JSON.stringify(metadata)],
  );
  return { productId, created };
}
