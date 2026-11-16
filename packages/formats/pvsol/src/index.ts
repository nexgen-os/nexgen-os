/**
 * `@nexgen-os/pvsol` — a PV*SOL study (.pvprj) read into a plain project.
 *
 * A .pvprj file is a ZIP archive written by PV*SOL premium (Valentin
 * Software). What this library reads in it, and how, was settled on studies
 * PV*SOL premium 2025 and 2026 saved:
 *
 * - `Project.xml`: the project, its arrays (`Modulfelder`) with their tilt,
 *   azimuth and modules, its inverters, its losses, and a load profile the
 *   person imported, kept as base64 of a gzip stream of float64 little
 *   endian values in watts, one per step;
 * - `DB.json`: the products the study uses, of which the rated power of a
 *   module (`SpecifiedOutputPower`, in watts);
 * - `SimResults.xml`: what PV*SOL simulated, energies in joules and
 *   temperatures in kelvin, read in kWh and °C;
 * - a weather file (`*.wbv`, licensed with PV*SOL): named, never read.
 *
 * PV*SOL gives an azimuth in degrees clockwise from north, the convention of
 * Nexgen OS: it is kept as it is. Nothing is computed beyond the units the
 * format defines: a figure missing from the file is null, and a disagreement
 * inside the file (a load profile whose values do not add up to its declared
 * total) is reported as a problem, never corrected.
 *
 * MIT; no dependency, no database, no network.
 */

import { child, children, num, parseXml, text, zipEntries, type XmlNode } from './archive.js';
import { gunzipSync } from 'node:zlib';

/** The versions of PV*SOL whose studies this library was settled on; another one reads, with a warning. */
export const PVSOL_TESTED_PROGRAMS = ['PV*SOL premium 2025', 'PV*SOL premium 2026'];

const J_PER_KWH = 3_600_000;

export interface PvsolModule {
  manufacturer: string | null;
  model: string | null;
  /** The rated power of one module at STC, in W; null when `DB.json` does not give it. */
  power_w: number | null;
}

export interface PvsolArrayResults {
  /** AC energy of the array over the year, kWh. */
  energy_kwh: number | null;
  /** kWh per kWp over the year. */
  specific_yield_kwh_per_kwp: number | null;
  performance_ratio: number | null;
  /** Irradiation on the plane of the array, 12 monthly values in kWh/m². */
  poa_monthly_kwh_m2: number[] | null;
}

export interface PvsolArray {
  /** PV*SOL's id of the array (`ModulfeldID`). */
  id: string;
  name: string;
  tilt_deg: number | null;
  /** Degrees clockwise from true north, as PV*SOL writes it. */
  azimuth_deg: number | null;
  module_count: number;
  module: PvsolModule;
  /** module_count × the module's power, kWp; null when the power is unknown. */
  power_kwp: number | null;
  results: PvsolArrayResults | null;
}

export interface PvsolInverter {
  manufacturer: string | null;
  model: string | null;
  count: number;
}

export interface PvsolLoadProfile {
  name: string | null;
  /** The step of the values, in minutes. */
  step_minutes: number;
  /** Mean power over each step, W, the first step starting the year. */
  values_w: number[];
  /** The total PV*SOL declares, kWh. */
  declared_total_kwh: number | null;
}

export interface PvsolLosses {
  /** Fractions, 0.02 for 2 %. */
  spectral: number | null;
  ac_cabling: number | null;
  mismatch: number | null;
  diodes: number | null;
  soiling: number | null;
  /** The ground's reflectance over the year. */
  albedo: number | null;
  bifacial: boolean;
}

export interface PvsolResults {
  /** AC energy of the system over the year, kWh. */
  production_kwh: number | null;
  /** DC energy entering the inverters, kWh. */
  inverter_input_kwh: number | null;
  consumption_kwh: number | null;
  self_consumed_kwh: number | null;
  /** Energy taken from the grid, kWh. */
  offtake_kwh: number | null;
  /** Energy fed into the grid, kWh. */
  injection_kwh: number | null;
  /** Share of the production consumed on site, 0 to 1. */
  self_consumption_rate: number | null;
  /** Share of the consumption covered by the production, 0 to 1. */
  self_sufficiency_rate: number | null;
  /** Global horizontal irradiation, 12 monthly values in kWh/m². */
  ghi_monthly_kwh_m2: number[] | null;
  /** Mean ambient temperature, 12 monthly values in °C. */
  temperature_monthly_c: number[] | null;
}

export interface PvsolProblem {
  code: 'program_untested' | 'array_empty' | 'module_power_missing' | 'power_disagrees' | 'load_profile_count' | 'load_profile_total' | 'load_profile_unreadable' | 'not_simulated' | 'results_unreadable' | 'products_unreadable';
  level: 'warning';
  message: string;
}

export interface PvsolStudy {
  /** The program that last saved the study, `PV*SOL premium 2026 (R1)`. */
  program: string | null;
  schema_version: number | null;
  /** Whether the program is one of `PVSOL_TESTED_PROGRAMS`. */
  tested: boolean;
  project: {
    title: string | null;
    author: string | null;
    /** YYYY-MM-DD, from the date PV*SOL writes in .NET's invariant culture. */
    commissioning_date: string | null;
    /** The address of the system, its lines joined by commas. */
    site_address: string | null;
    customer_company: string | null;
    customer_contact: string | null;
  };
  /** The rated power the study declares for the whole system, kWp, when it does. */
  declared_power_kwp: number | null;
  arrays: PvsolArray[];
  inverters: PvsolInverter[];
  load_profile: PvsolLoadProfile | null;
  losses: PvsolLosses;
  results: PvsolResults | null;
  /** The weather file the archive carries, by name: licensed with PV*SOL, never read. */
  weather_file: string | null;
  problems: PvsolProblem[];
}

/** Whether a file name is a PV*SOL study's. */
export function isPvsolFileName(name: string): boolean {
  return /\.pvprj$/i.test(name);
}

/**
 * Reads the bytes of a .pvprj file. Throws `pvsol_unreadable: …` when it is
 * not a ZIP archive holding a well-formed `Project.xml`; anything else it
 * cannot read is a problem of the study, and a figure it lacks is null.
 */
export function readPvsolStudy(bytes: Uint8Array): PvsolStudy {
  const entries = zipEntries(bytes);
  const problems: PvsolProblem[] = [];
  const warn = (code: PvsolProblem['code'], message: string) => problems.push({ code, level: 'warning', message });

  const projectEntry = entries.get('project.xml');
  if (!projectEntry) throw new Error('pvsol_unreadable: the archive holds no Project.xml, so it is not a PV*SOL study');
  const root = parseXml(projectEntry.read().toString('utf8'), 'Project.xml');

  const program = children(child(root, 'ProgramsUsedToEditProject'), 'Program').map((p) => p.text.trim()).find(Boolean)
    ?? text(root, 'Applikation');
  const tested = program !== null && PVSOL_TESTED_PROGRAMS.some((p) => program.startsWith(p));
  if (!tested) warn('program_untested', `the study was saved by ${program ?? 'an unnamed program'}, not one of ${PVSOL_TESTED_PROGRAMS.join(', ')}: check what was read`);

  const data = child(root, 'ProjektdatenV1');
  const customer = child(child(data, 'KundenAdresse'), 'CustomerDetails');
  const project = {
    title: text(data, 'Projekttitel'),
    author: text(data, 'Bearbeiterin'),
    commissioning_date: invariantDate(text(data, 'InbetriebnahmeDatum')),
    site_address: text(child(data, 'AnlagenStandort'), 'Anschrift')?.split(/\s*\r?\n\s*/).filter(Boolean).join(', ') ?? null,
    customer_company: text(customer, 'Unternehmen'),
    customer_contact: text(customer, 'Ansprechpartner'),
  };

  const products = json<{ PVModules?: Array<{ Id?: string; SpecifiedOutputPower?: number }> }>(entries, 'db.json', warn);
  const economics = json<{ PVLeistung?: number }>(entries, 'oecforecast.json', warn);
  const powerOf = new Map<string, number>();
  for (const m of products?.PVModules ?? []) if (m.Id && typeof m.SpecifiedOutputPower === 'number') powerOf.set(m.Id, m.SpecifiedOutputPower);

  const arrays: PvsolArray[] = [];
  for (const field of children(child(root, 'PVModule'), 'Modulfelder')) {
    const id = text(field, 'ModulfeldID') ?? `array-${arrays.length + 1}`;
    const name = text(field, 'Modulname') ?? id;
    const moduleCount = Math.round(num(field, 'Modulanzahl') ?? 0);
    if (moduleCount <= 0) { warn('array_empty', `the array ${name} has no module and is left aside`); continue; }
    const power = powerOf.get(text(field, 'ModulID') ?? '') ?? null;
    if (power === null) warn('module_power_missing', `the power of the modules of ${name} is not in DB.json`);
    arrays.push({
      id, name,
      tilt_deg: num(field, 'Modulneigung'),
      azimuth_deg: num(field, 'Modulausrichtung'),
      module_count: moduleCount,
      module: { manufacturer: text(field, 'ModulHersteller'), model: text(field, 'ModulName'), power_w: power },
      power_kwp: power === null ? null : round(moduleCount * power / 1000, 6),
      results: null,
    });
  }

  const declared = typeof economics?.PVLeistung === 'number' && economics.PVLeistung > 0 ? economics.PVLeistung : null;
  if (declared !== null && arrays.length > 0 && arrays.every((a) => a.power_kwp !== null)) {
    const sum = arrays.reduce((s, a) => s + a.power_kwp!, 0);
    if (Math.abs(sum - declared) / declared > 0.02) warn('power_disagrees', `the arrays add up to ${round(sum, 3)} kWp, the study declares ${declared} kWp`);
  }

  const inverters = new Map<string, PvsolInverter>();
  for (const w of children(child(child(root, 'Wechselrichter'), 'Verschaltung'), 'WRObj')) {
    const manufacturer = text(w, 'InverterHersteller');
    const model = text(w, 'InverterName');
    const count = num(w, 'Haeufigkeit') ?? 1;
    const key = `${manufacturer}\u0000${model}`;
    const known = inverters.get(key);
    if (known) known.count += count;
    else inverters.set(key, { manufacturer, model, count });
  }

  let loadProfile: PvsolLoadProfile | null = null;
  for (const group of children(child(root, 'Verbrauch'), 'VerbrauchGruppen')) {
    for (const definition of children(group, 'Verbrauchsdefinition')) {
      const imported = child(definition, 'ImportierteProfile');
      if (imported && !loadProfile) loadProfile = readLoadProfile(imported, warn);
    }
  }

  const bifacialModel = text(child(child(child(root, 'PVModule'), 'Modulfelder'), 'Bifaciality'), 'BacksideIrradianceModel');
  const simulation = child(child(root, 'PVModule2'), 'VerlusteSimulation');
  const losses: PvsolLosses = {
    spectral: num(child(root, 'Meteo'), 'VerlusteDurchSpektrumsAbweichung'),
    ac_cabling: num(child(root, 'ACNetz'), 'Gesamtverlust'),
    mismatch: num(simulation, 'MismatchHersteller'),
    diodes: num(simulation, 'VerlusteInDioden'),
    soiling: num(simulation, 'VerschmutzungJahreswert'),
    albedo: num(simulation, 'AlbedoJahreswert'),
    bifacial: bifacialModel !== null && bifacialModel.toLowerCase() !== 'none',
  };

  let results: PvsolResults | null = null;
  const sim = entries.get('simresults.xml');
  if (!sim) warn('not_simulated', 'the study holds no SimResults.xml: it was saved before a simulation');
  else {
    try {
      results = readResults(parseXml(sim.read().toString('utf8'), 'SimResults.xml'), arrays);
    } catch (e) {
      warn('results_unreadable', (e as Error).message);
    }
  }

  const weather = [...entries.values()].find((e) => /\.wbv$/i.test(e.name));
  return {
    program, schema_version: num(root, 'Versionsnummer'), tested, project,
    declared_power_kwp: declared, arrays, inverters: [...inverters.values()],
    load_profile: loadProfile, losses, results,
    weather_file: weather ? weather.name.slice(weather.name.lastIndexOf('/') + 1) : null,
    problems,
  };
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/** `04/16/2026 00:00:00` (month first, as .NET's invariant culture writes it) as `2026-04-16`; null otherwise. */
function invariantDate(value: string | null): string | null {
  const m = value === null ? null : /^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(value);
  return m ? `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}` : null;
}

function json<T>(entries: ReturnType<typeof zipEntries>, file: string, warn: (code: PvsolProblem['code'], message: string) => void): T | null {
  const entry = entries.get(file);
  if (!entry) return null;
  try {
    return JSON.parse(entry.read().toString('utf8').replace(/^﻿/, '')) as T;
  } catch (e) {
    warn('products_unreadable', `${entry.name} is not JSON: ${(e as Error).message}`);
    return null;
  }
}

function readLoadProfile(node: XmlNode, warn: (code: PvsolProblem['code'], message: string) => void): PvsolLoadProfile | null {
  const encoded = child(node, 'Values')?.text.replace(/\s+/g, '');
  if (!encoded) return null;
  const step = num(node, 'Intervall') ?? 60;
  const count = num(node, 'NoOfValues');
  const declared = num(node, 'TotalConsumption');
  let raw: Buffer;
  try {
    // .NET writes the whole buffer, zeros after the gzip member included; zlib stops at the member's end.
    raw = gunzipSync(Buffer.from(encoded, 'base64'));
  } catch (e) {
    warn('load_profile_unreadable', `the load profile is not a gzip stream: ${(e as Error).message}`);
    return null;
  }
  const values: number[] = [];
  for (let at = 0; at + 8 <= raw.length; at += 8) values.push(raw.readDoubleLE(at));
  if (count !== null && values.length !== count) warn('load_profile_count', `the load profile holds ${values.length} values, it declares ${count}`);
  if (declared !== null && declared > 0) {
    const total = values.reduce((s, w) => s + w, 0) * step / 60 / 1000;
    if (Math.abs(total - declared) / declared > 0.01) warn('load_profile_total', `the load profile adds up to ${round(total, 1)} kWh, it declares ${declared} kWh`);
  }
  return { name: text(node, 'Name'), step_minutes: step, values_w: values, declared_total_kwh: declared };
}

function yearly(node: XmlNode | null, name: string): number | null {
  const raw = child(child(node, name), 'YearlyValue')?.text.trim();
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) ? value : null;
}

function monthly(node: XmlNode | null, name: string, unit: (v: number) => number): number[] | null {
  const values = children(child(node, name), 'MonthlyValues').map((m) => Number(child(m, 'value')?.text.trim() ?? 'NaN'));
  return values.length === 12 && values.every(Number.isFinite) ? values.map(unit) : null;
}

const kwh = (joules: number | null) => (joules === null ? null : joules / J_PER_KWH);
const perM2 = (joules: number) => joules / J_PER_KWH;
const celsius = (kelvin: number) => round(kelvin - 273.15, 6);

/**
 * The results of a simulation. The energy balances of the inverters
 * (`EnergiebilanzResultsWr`) come as the whole system first and then each
 * inverter: the largest is the system's. The irradiation on the plane of
 * the arrays (`PVModuleResult`) comes in the order of the arrays of
 * `Project.xml`; their energy (`ModulflaechenResults`) names its array.
 */
function readResults(root: XmlNode, arrays: PvsolArray[]): PvsolResults {
  const largest = (name: string) => {
    const values = children(root, 'EnergiebilanzResultsWr').map((b) => yearly(b, name)).filter((v): v is number => v !== null);
    return values.length === 0 ? null : kwh(Math.max(...values));
  };
  const planes = children(root, 'PVModuleResult');
  const byArea = new Map(children(root, 'ModulflaechenResults').map((a) => [child(a, 'Guid_Area')?.text.trim() ?? '', a]));
  arrays.forEach((array, i) => {
    const area = byArea.get(array.id) ?? null;
    const poa = monthly(planes[i] ?? null, 'EinstrahlungGeneigt', perM2);
    if (area === null && poa === null) return;
    array.results = {
      energy_kwh: yearly(area, 'PVEnergyAC'),
      specific_yield_kwh_per_kwp: yearly(area, 'SpecificAnnualEnergyYield'),
      performance_ratio: yearly(area, 'PerformanceRatio'),
      poa_monthly_kwh_m2: poa,
    };
  });
  const consumption = child(root, 'VerbrauchResults');
  const meteo = child(root, 'MeteoResults');
  return {
    production_kwh: largest('EB_WR5_PVEnergieAC'),
    inverter_input_kwh: largest('EB_WR0_EingangsEnergie'),
    consumption_kwh: kwh(yearly(consumption, 'Verbrauch')),
    self_consumed_kwh: kwh(yearly(consumption, 'Eigenverbrauch')),
    offtake_kwh: kwh(yearly(consumption, 'Netzbezug')),
    injection_kwh: kwh(yearly(consumption, 'Netzeinspeisung')),
    self_consumption_rate: yearly(consumption, 'Eigenverbrauchsanteil'),
    self_sufficiency_rate: yearly(consumption, 'Solaredeckungsrate'),
    ghi_monthly_kwh_m2: monthly(meteo, 'EinstrahlungHor', perM2),
    temperature_monthly_c: monthly(meteo, 'Aussentemperatur', celsius),
  };
}
