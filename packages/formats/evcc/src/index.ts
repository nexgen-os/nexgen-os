/**
 * `@nexgen-os/evcc` — the device templates of evcc ⇄ plain shapes.
 *
 * evcc (https://evcc.io, MIT) keeps one YAML template per way of talking
 * to a device: a charging station, a meter (a grid meter, an inverter, a
 * battery), a vehicle. Each template names the products it drives — a brand
 * and, most often, a model — what the device can do, the uses a meter
 * template serves, how the device is found on a local network, and whether
 * evcc asks for a sponsorship to drive it.
 *
 * This library reads one template file into those facts, and folds many
 * templates into the connectors each brand can be reached through. It
 * renders nothing: the `render` block, the parameters and their presets are
 * evcc's own and stay in the file.
 */
import { parse } from 'yaml';

/** A product a template drives: its brand and, when the template names one, its model. */
export interface EvccProduct {
  brand: string;
  /**
   * The model: the `generic` description, else the description in the
   * first of the languages asked for, else the first description the file
   * gives. Null when the template names the brand only.
   */
  model: string | null;
  /** Every description the file gives, by its key (`generic` or a language). */
  descriptions: Record<string, string>;
}

/** How evcc finds a device on a local network. */
export interface EvccDiscovery {
  /** DNS-SD service types, `_<service>._tcp`. */
  mdns: string[];
  /** Host name patterns, `*` for any characters. */
  hostname: string[];
  /** Prefixes of the MAC address, upper-case hexadecimal, no separators. */
  mac: string[];
}

/** One template of evcc, as read from its file. */
export interface EvccTemplate {
  /** The directory the template comes from: `charger`, `meter`, `vehicle`… */
  class: string;
  /** The template's name, what evcc is configured with. */
  template: string;
  /** The group of a template, `heating` or `switchsockets` for a charger template; null otherwise. */
  group: string | null;
  /** The templates this one replaces. */
  covers: string[];
  products: EvccProduct[];
  /** What the device can do: `1p3p`, `rfid`, `battery-control`, `curtail`… */
  capabilities: string[];
  /** The uses a meter template serves (`grid`, `pv`, `battery`, `charge`, `aux`), from its `usage` parameter. */
  usages: string[];
  /** The `requirements.evcc` list: `sponsorship`, `skiptest`… */
  evccRequirements: string[];
  /** Whether evcc asks for a sponsorship to drive the device. */
  sponsored: boolean;
  /** What the installation requires, by description key. */
  requirements: Record<string, string>;
  discovery: EvccDiscovery;
}

/** A way a brand can be reached: one template of one class. */
export interface EvccConnector {
  class: string;
  template: string;
  group: string | null;
  sponsored: boolean;
}

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.length > 0) : []);

function descriptions(v: unknown): Record<string, string> {
  if (!isObject(v)) return {};
  return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string').map(([k, s]) => [k, s.trim()]));
}

function described(texts: Record<string, string>, languages: readonly string[]): string | null {
  if (texts.generic) return texts.generic;
  for (const language of languages) if (texts[language]) return texts[language];
  return Object.values(texts)[0] ?? null;
}

/**
 * Reads one template file. `evccClass` is the directory it comes from
 * (`charger`, `meter`, `vehicle`…): evcc says the class by the place of the
 * file, not in it. `languages` orders the descriptions a model is read
 * from when the file gives no `generic` one.
 *
 * Refuses by name: `template_invalid` (not YAML, or not a mapping),
 * `template_missing` (no `template` name), `products_missing` (no product
 * with a brand).
 */
export function readEvccTemplate(text: string, evccClass: string, options: { languages?: readonly string[] } = {}): EvccTemplate {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    throw new Error(`template_invalid: ${(e as Error).message.split('\n')[0]}`);
  }
  if (!isObject(raw)) throw new Error('template_invalid: a template is a YAML mapping');
  const template = typeof raw.template === 'string' ? raw.template.trim() : '';
  if (!template) throw new Error('template_missing: the file names no template');

  const languages = options.languages ?? [];
  const products: EvccProduct[] = (Array.isArray(raw.products) ? raw.products : [])
    .filter(isObject)
    .filter((p) => typeof p.brand === 'string' && p.brand.trim().length > 0)
    .map((p) => {
      const texts = descriptions(p.description);
      return { brand: (p.brand as string).trim(), model: described(texts, languages), descriptions: texts };
    });
  if (products.length === 0) throw new Error(`products_missing: template ${template} names no product with a brand`);

  const requirements = isObject(raw.requirements) ? raw.requirements : {};
  const evccRequirements = strings(requirements.evcc);
  const params = Array.isArray(raw.params) ? raw.params.filter(isObject) : [];
  const usage = params.find((p) => p.name === 'usage');
  const discovery = isObject(raw.discovery) ? raw.discovery : {};

  return {
    class: evccClass,
    template,
    group: typeof raw.group === 'string' ? raw.group : null,
    covers: strings(raw.covers),
    products,
    capabilities: strings(raw.capabilities),
    usages: usage ? strings(usage.choice) : [],
    evccRequirements,
    sponsored: evccRequirements.includes('sponsorship'),
    requirements: descriptions(requirements.description),
    discovery: {
      mdns: strings(discovery.mdns),
      hostname: strings(discovery.hostname),
      mac: strings(discovery.mac).map((m) => m.replace(/[^0-9a-f]/gi, '').toUpperCase()),
    },
  };
}

/**
 * The connectors each brand can be reached through, from the templates
 * read: every template that names a product of the brand, once, in the
 * order the templates come. A brand is matched as written, case aside, and
 * keyed as the first template writes it.
 */
export function connectorsByBrand(templates: readonly EvccTemplate[]): Map<string, EvccConnector[]> {
  const byKey = new Map<string, { brand: string; connectors: EvccConnector[] }>();
  for (const t of templates) {
    for (const brand of new Set(t.products.map((p) => p.brand))) {
      const key = brand.toLowerCase();
      const entry = byKey.get(key) ?? { brand, connectors: [] };
      byKey.set(key, entry);
      if (!entry.connectors.some((c) => c.class === t.class && c.template === t.template)) {
        entry.connectors.push({ class: t.class, template: t.template, group: t.group, sponsored: t.sponsored });
      }
    }
  }
  return new Map([...byKey.values()].map((e) => [e.brand, e.connectors]));
}
