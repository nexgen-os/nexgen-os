/**
 * The products evcc can drive, in the catalogue.
 *
 * `@nexgen-os/evcc` reads the templates of evcc; these functions turn the
 * products they name into catalogue entries of the core
 * ([0027](../../../../docs/decisions/0027-a-product-is-a-catalogue-entry.md)),
 * each carrying, under `metadata.evcc`, the templates a device of that
 * model can be driven through: the connector proposed when a device of the
 * model is installed.
 *
 *   - `catalogueOfEvcc()`     the entries the templates give, and what they
 *                             leave out and why, with no database;
 *   - `importEvccCatalogue()` the entries written, an entry the catalogue
 *                             already holds gaining its templates.
 *
 * A template evcc drives only for its sponsors is left out: what it drives
 * is not open to every installation.
 */
import type { EvccTemplate } from '@nexgen-os/evcc';
import type { Db } from '../db.js';

/**
 * Which device type of the core a template's products are, by class: for
 * `charger`, by the template's group (`''` without one); for `meter`, by
 * the first of the uses the template serves found in the table, in the
 * table's order (`''` for a template that names no use). A class or a group
 * absent from the table, or mapped to null, gives no catalogue entry.
 */
export interface EvccDeviceTypes {
  charger: Record<string, string | null>;
  meter: Array<[usage: string, deviceType: string | null]>;
  [evccClass: string]: Record<string, string | null> | Array<[string, string | null]>;
}

/**
 * The device types evcc's templates are read as by default: a charging
 * station; a heating template (heat pumps and heating rods) a heat pump; a
 * switch socket a controller; a meter template serving `pv` an inverter
 * (a hybrid inverter included), else `battery` a battery, else a meter.
 * Vehicles are not devices of a place: no entry.
 */
export const EVCC_DEVICE_TYPES: EvccDeviceTypes = {
  charger: { '': 'charger', heating: 'heat_pump', switchsockets: 'controller' },
  meter: [['pv', 'inverter'], ['battery', 'battery'], ['grid', 'meter'], ['charge', 'meter'], ['aux', 'meter'], ['', 'meter']],
};

/** The device type of a template's products, or null when the table gives none. */
export function deviceTypeOfEvcc(template: EvccTemplate, table: EvccDeviceTypes = EVCC_DEVICE_TYPES): string | null {
  const rule = table[template.class];
  if (!rule) return null;
  if (Array.isArray(rule)) {
    const usages = template.usages.length > 0 ? template.usages : [''];
    return rule.find(([usage]) => usages.includes(usage))?.[1] ?? null;
  }
  return rule[template.group ?? ''] ?? null;
}

/** A template a device of a model can be driven through. */
export interface EvccConnectorOfProduct {
  class: string;
  template: string;
  group: string | null;
  capabilities: string[];
  usages: string[];
  discovery: EvccTemplate['discovery'];
}

/** A catalogue entry evcc's templates give. */
export interface EvccCatalogueEntry {
  manufacturer: string;
  model: string;
  deviceType: string;
  /** Every template naming this model, in the order read. */
  connectors: EvccConnectorOfProduct[];
}

/** A product left out of the catalogue, and why. */
export interface EvccLeftOut {
  template: string;
  brand: string;
  model: string | null;
  reason: 'sponsored' | 'model_missing' | 'device_type_unknown';
}

/**
 * The catalogue entries the templates give: one per manufacturer and
 * model, the device type of the first template naming it, every template
 * naming it as its connectors. Left out: the products of a sponsored
 * template, a brand named without a model, a template the table gives no
 * device type.
 */
export function catalogueOfEvcc(
  templates: readonly EvccTemplate[],
  options: { deviceTypes?: EvccDeviceTypes } = {},
): { entries: EvccCatalogueEntry[]; leftOut: EvccLeftOut[] } {
  const entries = new Map<string, EvccCatalogueEntry>();
  const leftOut: EvccLeftOut[] = [];
  for (const t of templates) {
    const deviceType = deviceTypeOfEvcc(t, options.deviceTypes);
    for (const p of t.products) {
      const reason = t.sponsored ? 'sponsored' : p.model === null ? 'model_missing' : deviceType === null ? 'device_type_unknown' : null;
      if (reason) {
        leftOut.push({ template: t.template, brand: p.brand, model: p.model, reason });
        continue;
      }
      const key = `${p.brand}\u0000${p.model}`;
      const entry = entries.get(key) ?? { manufacturer: p.brand, model: p.model!, deviceType: deviceType!, connectors: [] };
      entries.set(key, entry);
      if (!entry.connectors.some((c) => c.class === t.class && c.template === t.template)) {
        entry.connectors.push({ class: t.class, template: t.template, group: t.group, capabilities: t.capabilities, usages: t.usages, discovery: t.discovery });
      }
    }
  }
  return { entries: [...entries.values()], leftOut };
}

/** Where the templates were read from: the repository and the commit. */
export interface EvccRevision {
  repository: string;
  commit: string;
}

/**
 * Writes the catalogue entries of the templates: an organisation's own
 * (`organisationId`), or shared by every organisation (null, for whoever
 * installs). An entry the catalogue already holds by manufacturer and
 * model keeps its values and gains `metadata.evcc`, replaced as a whole at
 * each import, so importing the same templates again changes nothing. A
 * new entry is published by `evcc`. Every entry says the commit it was
 * read at and evcc's licence.
 */
export async function importEvccCatalogue(
  db: Db,
  templates: readonly EvccTemplate[],
  options: { organisationId: string | null; revision: EvccRevision; deviceTypes?: EvccDeviceTypes },
): Promise<{ created: number; updated: number; leftOut: EvccLeftOut[] }> {
  if (!options.revision?.commit) throw new Error('revision_required: the commit of evcc the templates were read at');
  const { entries, leftOut } = catalogueOfEvcc(templates, { deviceTypes: options.deviceTypes });
  let created = 0;
  for (const e of entries) {
    const evcc = { connectors: e.connectors, repository: options.revision.repository, commit: options.revision.commit, licence: 'MIT' };
    const row = (await db.query<{ created: boolean }>(
      `insert into products (organisation_id, device_type, manufacturer, model, metadata, published_by)
       values ($1, $2, $3, $4, jsonb_build_object('evcc', $5::jsonb), 'evcc')
       on conflict (organisation_id, manufacturer, model)
       do update set metadata = products.metadata || jsonb_build_object('evcc', $5::jsonb)
       returning (xmax = 0) as created`,
      [options.organisationId, e.deviceType, e.manufacturer, e.model, JSON.stringify(evcc)],
    )).rows[0]!;
    if (row.created) created += 1;
  }
  return { created, updated: entries.length - created, leftOut };
}
