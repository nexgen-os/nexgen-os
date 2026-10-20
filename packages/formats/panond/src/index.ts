// PAN and OND product files → plain products.
//
// A PAN file describes a PV module and an OND file an inverter, in the text
// format PVsyst writes since version 6 and manufacturers publish with their
// datasheets. They are the way a product's physics travels between PVsyst,
// PV*SOL, SAM and pvlib. They are read here, never written (decision 0012).
//
// A module reads as a product (manufacturer, model, unit power, surface)
// and its physics: the PVsyst one-diode model in pvlib's key names, so that
// pvlib uses it as it is. PVsyst does not store the light current
// and the saturation current of the diode; they are solved here from the
// short-circuit current and the open-circuit voltage at standard test
// conditions, with the file's series and shunt resistances and diode factor,
// so that the model gives back the file's Isc and Voc exactly.
//
// An inverter reads the same way, with the model `ond`: the file's own
// keys, efficiency curves included, as pvlib's `read_panond` gives them.
//
// Prices, currencies and price dates that a file may carry are left out:
// the line between open and paid data runs on prices, never on physics.
//
// The library imports nothing, opens no connection and calls no network:
// adding a product to a directory is an importer's job.
//
// SPDX-License-Identifier: MIT

/** A PVsyst object as read: its type, then its keys; blocks nest. */
export interface PanOndObject {
  _type: string;
  [key: string]: PanOndValue;
}
export type PanOndValue = string | number | number[] | PanOndObject;

/** The pvlib parameters of the PVsyst one-diode model (`pvlib.pvsystem.calcparams_pvsyst`). */
export interface PvsystModuleParameters {
  gamma_ref: number;
  mu_gamma: number;
  I_L_ref: number;
  I_o_ref: number;
  R_sh_ref: number;
  R_sh_0: number;
  R_sh_exp: number;
  R_s: number;
  /** A/°C. */
  alpha_sc: number;
  cells_in_series: number;
  /** eV; given for silicon, left to pvlib's default otherwise. */
  EgRef?: number;
}

interface ProductFile {
  manufacturer: string;
  model_ref: string;
  unit_power_kw: number | null;
  unit_surface_m2: number | null;
}

export interface ModuleFile extends ProductFile {
  kind: 'module';
  model: 'pvsyst';
  parameters: PvsystModuleParameters;
  /** `metadata.pan`: the whole file as read, prices left out. */
  metadata: { pan: PanOndObject };
}

export interface InverterFile extends ProductFile {
  kind: 'inverter';
  model: 'ond';
  /** The file's keys as read, the commercial block apart. */
  parameters: PanOndObject;
  /** `metadata.ond`: the commercial block (data source, dimensions, remarks), prices left out. */
  metadata: { ond: PanOndObject };
}

const BOLTZMANN = 1.380649e-23;
const ELEMENTARY_CHARGE = 1.602176634e-19;
const SILICON_BAND_GAP_EV = 1.121;
const PRICE_KEYS = /^(Price|Currency|PriceDate)/i;

// ---------------------------------------------------------------------------
// The text format
// ---------------------------------------------------------------------------

/**
 * A PAN or OND file as a tree: `Key=Value` lines, blocks opened by a line
 * whose next line is indented deeper and closed by `End of …`. Numbers and
 * lists of numbers (`880.0,1174.0,1300.0,`, `Point_3=30.0,1.00000`) are read
 * as numbers; everything else stays text.
 */
export function parsePanOnd(text: string): PanOndObject {
  if (text.includes('\u0000')) {
    throw new Error('panond_binary_unsupported: a binary PAN or OND file (PVsyst before version 6); export it again as text from PVsyst');
  }
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const first = /^\s*PVObject_\s*=\s*(\S+)/.exec(lines[0] ?? '');
  if (!first) throw new Error('panond_unreadable: a PAN or OND file starts with PVObject_=');
  const root: PanOndObject = { _type: first[1] };
  const stack: PanOndObject[] = [root];
  const indent = (l: string) => l.length - l.trimStart().length;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (/^End of /i.test(trimmed)) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const eq = trimmed.indexOf('=');
    const key = (eq < 0 ? trimmed : trimmed.slice(0, eq)).split(',')[0].trim();
    const raw = eq < 0 ? '' : trimmed.slice(eq + 1).trim();
    const next = lines[i + 1];
    const opens = next !== undefined && indent(next) > indent(line) && !/^End of /i.test(next.trim());
    const into = stack[stack.length - 1];
    if (opens) {
      const block: PanOndObject = { _type: raw };
      into[key] = block;
      stack.push(block);
    } else {
      into[key] = value(raw);
    }
  }
  return root;
}

function value(raw: string): string | number | number[] {
  const number = /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
  if (number.test(raw)) return Number(raw);
  const parts = raw.replace(/,\s*$/, '').split(',').map((p) => p.trim());
  if (parts.length > 1 && parts.every((p) => number.test(p))) return parts.map(Number);
  return raw;
}

/** The points of a `TCubicProfile` block, `NPtsEff` of them, as [x, y] pairs. */
export function profilePoints(block: PanOndValue | undefined): [number, number][] {
  if (!block || typeof block !== 'object' || Array.isArray(block)) return [];
  const count = typeof block.NPtsEff === 'number' ? block.NPtsEff : Infinity;
  const out: [number, number][] = [];
  for (let n = 1; n <= count; n++) {
    const p = block[`Point_${n}`];
    if (!Array.isArray(p) || p.length < 2) break;
    out.push([p[0], p[1]]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// PAN: a PV module
// ---------------------------------------------------------------------------

/** A PAN file as a module of the directory with its PVsyst one-diode physics in pvlib's keys. */
export function readPan(text: string): ModuleFile {
  const pan = parsePanOnd(text);
  if (pan._type !== 'pvModule') throw new Error(`pan_unreadable: the file describes a ${pan._type}, not a pvModule`);
  const commercial = commercialOf(pan, 'pan');
  const n = (key: string) => {
    const v = pan[key];
    if (typeof v !== 'number') throw new Error(`pan_unreadable: no ${key} in the file`);
    return v;
  };
  const isc = n('Isc');
  const voc = n('Voc');
  const rs = n('RSerie');
  const rsh = n('RShunt');
  const gamma = n('Gamma');
  const cells = n('NCelS');
  const tref = (typeof pan.TRef === 'number' ? pan.TRef : 25) + 273.15;
  const { I_L_ref, I_o_ref } = diodeCurrents({ isc, voc, rs, rsh, nNsVth: gamma * cells * (BOLTZMANN * tref) / ELEMENTARY_CHARGE });

  const technology = typeof pan.Technol === 'string' ? pan.Technol : '';
  const parameters: PvsystModuleParameters = {
    gamma_ref: gamma,
    mu_gamma: typeof pan.muGamma === 'number' ? pan.muGamma : 0,
    I_L_ref: round(I_L_ref, 8),
    I_o_ref: Number(I_o_ref.toPrecision(8)),
    R_sh_ref: rsh,
    // PVsyst's defaults when an older file leaves them out: Rsh(0) = 4 Rsh, exponent 5.5.
    R_sh_0: typeof pan.Rp_0 === 'number' ? pan.Rp_0 : rsh * 4,
    R_sh_exp: typeof pan.Rp_Exp === 'number' ? pan.Rp_Exp : 5.5,
    R_s: rs,
    alpha_sc: round(n('muISC') / 1000, 9),
    cells_in_series: cells,
  };
  if (/^mtSi|^mtHIT/i.test(technology)) parameters.EgRef = SILICON_BAND_GAP_EV;

  const width = num(commercial.Width);
  const height = num(commercial.Height);
  return {
    kind: 'module',
    manufacturer: commercial.manufacturer,
    model_ref: commercial.model,
    unit_power_kw: typeof pan.PNom === 'number' ? round(pan.PNom / 1000, 6) : null,
    unit_surface_m2: width !== null && height !== null ? round(width * height, 3) : null,
    model: 'pvsyst',
    parameters,
    metadata: { pan: withoutPrices(pan) },
  };
}

/**
 * The light current and the diode's saturation current at the reference
 * conditions, from the two points every PAN file gives: at short circuit
 * (V = 0, I = Isc) and at open circuit (V = Voc, I = 0), the one-diode
 * equation is linear in both currents.
 */
export function diodeCurrents(p: { isc: number; voc: number; rs: number; rsh: number; nNsVth: number }): { I_L_ref: number; I_o_ref: number } {
  const atShortCircuit = Math.expm1((p.isc * p.rs) / p.nNsVth);
  const atOpenCircuit = Math.expm1(p.voc / p.nNsVth);
  const I_o_ref = (p.isc - (p.voc - p.isc * p.rs) / p.rsh) / (atOpenCircuit - atShortCircuit);
  if (!(I_o_ref > 0)) throw new Error('pan_inconsistent: the file\'s Isc, Voc and resistances give no diode');
  return { I_L_ref: I_o_ref * atOpenCircuit + p.voc / p.rsh, I_o_ref };
}

// ---------------------------------------------------------------------------
// OND: an inverter
// ---------------------------------------------------------------------------

/** An OND file as an inverter of the directory with its keys and efficiency curves. */
export function readOnd(text: string): InverterFile {
  const ond = parsePanOnd(text);
  if (ond._type !== 'pvGInverter') throw new Error(`ond_unreadable: the file describes a ${ond._type}, not a pvGInverter`);
  const commercial = commercialOf(ond, 'ond');
  const converter = ond.Converter;
  if (!converter || typeof converter !== 'object' || Array.isArray(converter)) throw new Error('ond_unreadable: no Converter block in the file');
  const { PVObject_Commercial: block, ...parameters } = ond;
  return {
    kind: 'inverter',
    manufacturer: commercial.manufacturer,
    model_ref: commercial.model,
    unit_power_kw: num(converter.PNomConv),
    unit_surface_m2: null,
    model: 'ond',
    parameters: parameters as PanOndObject,
    metadata: { ond: withoutPrices(block as PanOndObject) },
  };
}

// ---------------------------------------------------------------------------
// Small things
// ---------------------------------------------------------------------------

function commercialOf(root: PanOndObject, format: 'pan' | 'ond'): PanOndObject & { manufacturer: string; model: string } {
  const c = root.PVObject_Commercial;
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error(`${format}_unreadable: no PVObject_Commercial block in the file`);
  const manufacturer = c.Manufacturer === undefined ? '' : String(c.Manufacturer).trim();
  const model = c.Model === undefined ? '' : String(c.Model).trim();
  if (!manufacturer || !model) throw new Error(`${format}_unreadable: the file names no manufacturer or no model`);
  return { ...c, manufacturer, model };
}

function withoutPrices(o: PanOndObject): PanOndObject {
  const out: PanOndObject = { _type: o._type };
  for (const [k, v] of Object.entries(o)) {
    if (k === '_type' || PRICE_KEYS.test(k)) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? withoutPrices(v) : v;
  }
  return out;
}

function num(v: PanOndValue | undefined): number | null {
  return typeof v === 'number' ? v : null;
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
