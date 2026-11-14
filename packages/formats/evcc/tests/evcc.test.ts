// Nine templates of evcc, copied as they are at commit c0e578a of
// evcc-io/evcc (MIT, its licence beside them in fixtures/LICENSE), read into
// plain shapes with no database: the products, the class and group, the
// capabilities and uses, the discovery, the sponsorship.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { connectorsByBrand, readEvccTemplate, type EvccTemplate } from '@nexgen-os/evcc';

const file = (path: string) => readFileSync(new URL(`./fixtures/${path}.yaml`, import.meta.url), 'utf8');
const read = (path: string): EvccTemplate => readEvccTemplate(file(path), path.split('/')[0]!);

describe('a charging station template', () => {
  it('reads its products, capabilities, discovery and sponsorship', () => {
    const t = read('charger/go-e-v3');
    expect(t).toMatchObject({ class: 'charger', template: 'go-e-v3', group: null, covers: ['go-e-gemini'], sponsored: true, usages: [] });
    expect(t.products).toHaveLength(7);
    expect(t.products[0]).toEqual({ brand: 'go-e', model: 'Charger Gemini flex 2.0', descriptions: { generic: 'Charger Gemini flex 2.0' } });
    expect(t.capabilities).toEqual(['rfid', '1p3p', 'dim']);
    expect(t.discovery).toEqual({ mdns: ['_go-e_go-eCharger._tcp'], hostname: ['go-echarger*'], mac: ['D455AD', '98FC841'] });
    expect(Object.keys(t.requirements)).toEqual(['de', 'en']);
  });

  it('keeps every requirement evcc names, sponsorship among them', () => {
    expect(read('charger/ocpp-zaptec')).toMatchObject({ evccRequirements: ['sponsorship', 'skiptest'], sponsored: true });
    expect(read('charger/easee').sponsored).toBe(true);
  });

  it('reads a heating template, its brands without a model kept with a null model', () => {
    const t = read('charger/luxtronik');
    expect(t).toMatchObject({ group: 'heating', sponsored: false, evccRequirements: [] });
    expect(t.products.find((p) => p.brand === 'alpha innotec')).toEqual({ brand: 'alpha innotec', model: null, descriptions: {} });
    expect(new Set(t.products.map((p) => p.brand)).size).toBe(8);
  });

  it('reads a switch socket template, found by its host name', () => {
    expect(read('charger/mystrom')).toMatchObject({ group: 'switchsockets', discovery: { mdns: [], hostname: ['mystrom-*'], mac: [] } });
  });
});

describe('a meter template', () => {
  it('reads the uses its usage parameter offers', () => {
    expect(read('meter/fronius-gen24')).toMatchObject({ usages: ['grid', 'pv', 'battery'], capabilities: ['battery-control', 'curtail'] });
    expect(read('meter/dsmr')).toMatchObject({ usages: ['grid'], products: [{ brand: 'DSMR', model: null }] });
  });

  it('reads a model described per language from the language asked for, else the first given', () => {
    const text = file('meter/sma-hybrid');
    expect(readEvccTemplate(text, 'meter').products[0]!.model).toBe('Smart Energy Hybrid-Wechselrichter');
    expect(readEvccTemplate(text, 'meter', { languages: ['en'] }).products[0]!.model).toBe('Smart Energy Hybrid Inverter');
    expect(readEvccTemplate(text, 'meter').discovery.mac).toEqual(['0015BB', '0040AD']);
  });
});

describe('what is not a template', () => {
  it('is refused by name', () => {
    expect(() => readEvccTemplate('template: [', 'charger')).toThrow(/^template_invalid/);
    expect(() => readEvccTemplate('- a\n- b\n', 'charger')).toThrow(/^template_invalid/);
    expect(() => readEvccTemplate('products:\n  - brand: A\n', 'charger')).toThrow(/^template_missing/);
    expect(() => readEvccTemplate('template: a\nproducts:\n  - description:\n      generic: X\n', 'charger')).toThrow(/^products_missing/);
  });
});

describe('the connectors of a brand', () => {
  it('lists every template that names a product of the brand, once', () => {
    const templates = ['charger/go-e-v3', 'charger/luxtronik', 'charger/easee', 'meter/fronius-gen24', 'vehicle/renault'].map(read);
    const extra = readEvccTemplate('template: ocpp-goe\nproducts:\n  - brand: GO-E\n    description:\n      generic: Charger (OCPP)\n', 'charger');
    const brands = connectorsByBrand([...templates, extra]);
    expect(brands.get('go-e')).toEqual([
      { class: 'charger', template: 'go-e-v3', group: null, sponsored: true },
      { class: 'charger', template: 'ocpp-goe', group: null, sponsored: false },
    ]);
    expect(brands.get('Nibe')).toEqual([{ class: 'charger', template: 'luxtronik', group: 'heating', sponsored: false }]);
    expect(brands.get('Renault')).toEqual([{ class: 'vehicle', template: 'renault', group: null, sponsored: false }]);
    expect(brands.has('GO-E')).toBe(false);
  });
});
