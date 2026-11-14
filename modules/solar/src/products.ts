// Products read from PAN and OND files, in the catalogue with their physics.
//
// `@nexgen-os/panond` reads a file into a product and its physics; this
// importer adds the product to `products` (manufacturer, model,
// unit power, surface) and its physics to `solar.module_products` (the
// `pvsyst` one-diode model in pvlib's keys, its two currents solved here
// from the file's reference point) or `solar.inverter_products` (the `ond`
// model, the file's keys and efficiency curves).

import type { Db } from '@nexgen-os/core';
import type { InverterFile, ModuleFile, PvsystFileParameters } from '@nexgen-os/panond';

/** The pvlib parameters of the PVsyst one-diode model (`pvlib.pvsystem.calcparams_pvsyst`), currents included. */
export interface PvsystModuleParameters extends PvsystFileParameters {
  /** A, at the reference conditions. */
  I_L_ref: number;
  /** A, at the reference conditions. */
  I_o_ref: number;
}

const BOLTZMANN = 1.380649e-23;
const ELEMENTARY_CHARGE = 1.602176634e-19;

/**
 * The light current and the diode's saturation current at the reference
 * conditions, from the two points every PAN file gives: at short circuit
 * (V = 0, I = Isc) and at open circuit (V = Voc, I = 0), the one-diode
 * equation is linear in both currents, so they are solved exactly and the
 * model gives back the file's Isc and Voc. `nNsVth` is the diode factor
 * times the cells in series times the thermal voltage, in V.
 */
export function diodeCurrents(p: { isc: number; voc: number; rs: number; rsh: number; nNsVth: number }): { I_L_ref: number; I_o_ref: number } {
  const atShortCircuit = Math.expm1((p.isc * p.rs) / p.nNsVth);
  const atOpenCircuit = Math.expm1(p.voc / p.nNsVth);
  const I_o_ref = (p.isc - (p.voc - p.isc * p.rs) / p.rsh) / (atOpenCircuit - atShortCircuit);
  if (!(I_o_ref > 0)) throw new Error('pan_inconsistent: the file\'s Isc, Voc and resistances give no diode');
  return { I_L_ref: I_o_ref * atOpenCircuit + p.voc / p.rsh, I_o_ref };
}

/** A PAN file's PVsyst one-diode model, its two currents solved from the file's reference point. */
export function pvsystModel(module: ModuleFile): PvsystModuleParameters {
  const p = module.parameters;
  const { isc, voc, t_ref } = module.reference;
  const nNsVth = (p.gamma_ref * p.cells_in_series * BOLTZMANN * (t_ref + 273.15)) / ELEMENTARY_CHARGE;
  const { I_L_ref, I_o_ref } = diodeCurrents({ isc, voc, rs: p.R_s, rsh: p.R_sh_ref, nNsVth });
  return { ...p, I_L_ref: Math.round(I_L_ref * 1e8) / 1e8, I_o_ref: Number(I_o_ref.toPrecision(8)) };
}

/**
 * Adds a product read from a file to the catalogue with its physics. A
 * product the catalogue already knows by manufacturer and model (an
 * organisation's own, or a shared one when `organisationId` is null) gains
 * the physics; one that already has them is refused by name
 * (`already_imported`), and a module whose file gives no diode is refused
 * before anything is written (`pan_inconsistent`). `sourceCode` names where
 * the file comes from (a `sources` row: a manufacturer's datasheets, a
 * product database).
 */
export async function importProduct(
  db: Db,
  product: ModuleFile | InverterFile,
  options: { organisationId: string | null; sourceCode?: string | null; fileName?: string | null },
): Promise<{ productId: string; created: boolean }> {
  const physics = product.kind === 'module' ? 'solar.module_products' : 'solar.inverter_products';
  const parameters = product.kind === 'module' ? pvsystModel(product) : product.parameters;
  const known = await db.query<{ id: string; has_physics: boolean }>(
    `select d.id, exists (select 1 from ${physics} p where p.id = d.id) as has_physics
       from products d
      where d.organisation_id is not distinct from $1 and d.manufacturer = $2 and d.model = $3`,
    [options.organisationId, product.manufacturer, product.model],
  );
  if (known.rows[0]?.has_physics) {
    throw new Error(`already_imported: ${product.manufacturer} ${product.model} has its ${product.kind} physics`);
  }
  let productId = known.rows[0]?.id;
  const created = !productId;
  if (!productId) {
    const inserted = await db.query<{ id: string }>(
      `insert into products (organisation_id, device_type, manufacturer, model, unit_power_kw, unit_surface_m2)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [options.organisationId, product.kind === 'module' ? 'solar' : 'inverter', product.manufacturer, product.model, product.unit_power_kw, product.unit_surface_m2],
    );
    productId = inserted.rows[0].id;
  }
  const metadata = options.fileName ? { ...product.metadata, file: options.fileName } : product.metadata;
  await db.query(
    `insert into ${physics} (id, model, parameters, source_code, metadata) values ($1, $2, $3, $4, $5)`,
    [productId, product.physics_model, JSON.stringify(parameters), options.sourceCode ?? null, JSON.stringify(metadata)],
  );
  return { productId, created };
}
