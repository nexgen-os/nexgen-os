// PAN and OND files read into plain products with no database: a module's
// PVsyst one-diode model in pvlib's keys, solved so that it gives back the
// file's Isc, Voc and nominal power; an inverter's keys and efficiency
// curves as the file has them; prices left out.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parsePanOnd, profilePoints, readOnd, readPan, type PanOndObject, type PvsystModuleParameters } from '@nexgen-os/panond';

const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

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

describe('the PVsyst text format', () => {
  it('reads blocks, numbers, lists of numbers and text, through a byte order mark and Windows line ends', async () => {
    const ond = parsePanOnd(await fixture('example-inverter.OND'));
    expect(ond._type).toBe('pvGInverter');
    const converter = ond.Converter as Record<string, unknown>;
    expect(converter._type).toBe('TConverter');
    expect(converter.PNomConv).toBe(10);
    expect(converter.PInEffMax).toBe(5000);
    expect(converter.VNomEff).toEqual([300, 600, 850]);
    expect(converter.MonoTri).toBe('Tri');
    expect(ond.Comment).toBe('Example Power\tEP-10K\tManufacturer 2025');
    expect((ond.PVObject_Commercial as Record<string, unknown>).Remarks).toEqual({ _type: '2', Str_1: 'Protection: -25 - +60, IP 65', Str_2: '' });
    expect(ond.NbMPPT).toBe(2);
    expect(profilePoints(converter.ProfilPIO as never)).toEqual([[40, 0], [520, 488], [1030, 1000], [2050, 2006], [5080, 4990], [10200, 10000], [11220, 11000]]);
  });

  it('refuses what is not a PVsyst text file, by name', () => {
    expect(() => parsePanOnd('hello')).toThrow(/^panond_unreadable/);
    expect(() => parsePanOnd('\u0000\u0001PVObject')).toThrow(/^panond_binary_unsupported/);
  });
});

describe('a PAN file', () => {
  it('gives the product: manufacturer, model, unit power and surface', async () => {
    const pan = readPan(await fixture('example-module.PAN'));
    expect([pan.kind, pan.manufacturer, pan.model_ref, pan.unit_power_kw, pan.unit_surface_m2, pan.model]).toEqual(['module', 'Example Solar', 'ES-M108-430', 0.43, 1.953, 'pvsyst']);
  });

  it("gives the PVsyst one-diode model in pvlib's keys, with the currents solved from Isc and Voc", async () => {
    const { parameters: p } = readPan(await fixture('example-module.PAN'));
    expect(p).toMatchObject({ gamma_ref: 1, mu_gamma: -0.0002, R_sh_ref: 400, R_sh_0: 1600, R_sh_exp: 5.5, R_s: 0.153, alpha_sc: 0.00695, cells_in_series: 54, EgRef: 1.121 });
    expect(current(p, 0)).toBeCloseTo(13.9, 6);
    expect(current(p, 38.9)).toBeCloseTo(0, 5);
    let pmax = 0;
    for (let v = 0; v <= 38.9; v += 0.01) pmax = Math.max(pmax, v * current(p, v));
    expect(pmax).toBeGreaterThan(430 * 0.995);
    expect(pmax).toBeLessThan(430 * 1.005);
  });

  it('keeps the whole file in the metadata, the incidence profile included, and leaves the price out', async () => {
    const pan = readPan(await fixture('example-module.PAN'));
    const commercial = pan.metadata.pan.PVObject_Commercial as Record<string, unknown>;
    expect(commercial.DataSource).toBe('Manufacturer 2025');
    expect(Object.keys(commercial)).not.toEqual(expect.arrayContaining(['Price']));
    expect(commercial).not.toHaveProperty('Currency');
    expect(commercial).not.toHaveProperty('PriceDate');
    expect(pan.metadata.pan.BifacialityFactor).toBe(0.8);
    expect(profilePoints((pan.metadata.pan.PVObject_IAM as PanOndObject).IAMProfile)).toEqual([[0, 1], [40, 0.99], [60, 0.96], [80, 0.66], [90, 0]]);
  });

  it('refuses an inverter file, and a file without its numbers', async () => {
    const ondText = await fixture('example-inverter.OND');
    expect(() => readPan(ondText)).toThrow(/^pan_unreadable: the file describes a pvGInverter/);
    const text = (await fixture('example-module.PAN')).replace(/\s*Voc=38\.90/, '');
    expect(() => readPan(text)).toThrow(/^pan_unreadable: no Voc/);
  });
});

describe('an OND file', () => {
  it('gives the inverter with its keys and efficiency curves, the commercial block apart and without its currency', async () => {
    const ond = readOnd(await fixture('example-inverter.OND'));
    expect([ond.kind, ond.manufacturer, ond.model_ref, ond.unit_power_kw, ond.model]).toEqual(['inverter', 'Example Power', 'EP-10K', 10, 'ond']);
    expect(ond.parameters).not.toHaveProperty('PVObject_Commercial');
    expect(ond.parameters.Night_Loss).toBe(1.5);
    expect((ond.parameters.Converter as Record<string, unknown>).EfficEuro).toBe(97.6);
    expect(ond.metadata.ond).toMatchObject({ Manufacturer: 'Example Power', Width: 0.48 });
    expect(ond.metadata.ond).not.toHaveProperty('Currency');
    const panText = await fixture('example-module.PAN');
    expect(() => readOnd(panText)).toThrow(/^ond_unreadable/);
  });
});
