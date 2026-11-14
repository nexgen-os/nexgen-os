// SunSpec Modbus, read into plain shapes and written back.
//
// A SunSpec device (an inverter, a meter, a battery, a tracker…) exposes its
// registers as a chain of information models after the marker "SunS", at
// one of the base addresses 40000, 50000 or 0: each model starts with its
// id and its length in registers, and the chain ends with the id 0xFFFF.
// What each register of a model holds — its name, type, scale factor,
// units, whether it may be written — is said by the model definitions the
// SunSpec Alliance publishes (src/models.ts, Apache-2.0).
//
// Everything here is a pure function on 16-bit registers: no Modbus
// connection, no clock, no database. A value is read in the units the model
// says, scaled by its scale factor as SunSpec defines (value = raw x 10^sf);
// a register the device does not implement reads as null.

import { MODELS } from './models.js';

export { MODELS };

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export type PointType =
  | 'int16' | 'int32' | 'int64' | 'raw16' | 'uint16' | 'uint32' | 'uint64'
  | 'acc16' | 'acc32' | 'acc64' | 'bitfield16' | 'bitfield32' | 'bitfield64'
  | 'enum16' | 'enum32' | 'float32' | 'float64' | 'string' | 'pad'
  | 'ipaddr' | 'ipv6addr' | 'eui48' | 'sunssf' | 'count';

export interface SymbolDefinition { name: string; value: number }

export interface PointDefinition {
  name: string;
  type: PointType | string;
  /** Registers it takes. */
  size: number;
  /** The name of the scale factor point, or a fixed scale factor. */
  sf?: string | number;
  units?: string;
  access?: 'R' | 'RW' | string;
  mandatory?: 'M' | 'O' | string;
  static?: 'S' | 'D' | string;
  value?: number | string;
  count?: number;
  label?: string;
  symbols?: SymbolDefinition[];
}

export interface GroupDefinition {
  name: string;
  type: 'group' | 'sync' | string;
  /** Repeats: a number, the name of the point that holds it, or 0 to fill what the model's length leaves. */
  count?: number | string;
  label?: string;
  points: PointDefinition[];
  groups?: GroupDefinition[];
}

export interface ModelDefinition { id: number; group: GroupDefinition }

/** The definition of a model by its id, among the published ones or the caller's. */
export function modelDefinition(id: number, definitions: readonly ModelDefinition[] = MODELS): ModelDefinition | null {
  return definitions.find((m) => m.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// The map of a device: "SunS", then models until 0xFFFF
// ---------------------------------------------------------------------------

/** "SunS" in two registers, at the base address of every SunSpec device. */
export const SUNS_MARKER: readonly [number, number] = [0x5375, 0x6e53];
/** Where a device may start its map, in the order a client looks. */
export const BASE_ADDRESSES: readonly number[] = [40000, 50000, 0];
export const END_MODEL_ID = 0xffff;

export interface ModelBlock {
  id: number;
  /** Modbus address of the model's id register. */
  address: number;
  /** Its length in registers, id and length excluded, as the device says it. */
  length: number;
  /** The registers of the model, id and length included. */
  registers: number[];
}

/**
 * Cuts the registers read from a base address — "SunS" first — into the
 * models they hold, up to the end model. Refuses `suns_missing` when the
 * marker is not there, and `map_truncated`, with the address to read up to,
 * when the chain runs past the registers given.
 */
export function readModelBlocks(registers: readonly number[], baseAddress = 40000): ModelBlock[] {
  if (registers[0] !== SUNS_MARKER[0] || registers[1] !== SUNS_MARKER[1]) {
    throw new Error(`suns_missing: no "SunS" marker at address ${baseAddress}`);
  }
  const blocks: ModelBlock[] = [];
  let i = 2;
  for (;;) {
    if (i + 2 > registers.length) throw truncated(baseAddress + i + 2);
    const id = registers[i]!;
    const length = registers[i + 1]!;
    if (id === END_MODEL_ID) return blocks;
    if (i + 2 + length > registers.length) throw truncated(baseAddress + i + 2 + length);
    blocks.push({ id, address: baseAddress + i, length, registers: registers.slice(i, i + 2 + length) });
    i += 2 + length;
  }
}

const truncated = (address: number) => new Error(`map_truncated: the map goes on past the registers given; read up to address ${address}`);

// ---------------------------------------------------------------------------
// A model's registers → its points
// ---------------------------------------------------------------------------

export type Value = number | bigint | string | null;

export interface PointValue {
  name: string;
  type: string;
  /** Modbus address of its first register. */
  address: number;
  size: number;
  /** As the registers hold it; null when the device does not implement it. */
  raw: Value;
  /** Scaled by its scale factor; null when not implemented, or when its scale factor is not. */
  value: Value;
  /** The scale factor applied, null when the point has none. */
  sf: number | null;
  units: string | null;
  /** The symbol of an enum, by name. */
  symbol: string | null;
  /** The set bits of a bitfield, by name. */
  flags: string[];
  writable: boolean;
}

export interface GroupValue {
  name: string;
  points: Record<string, PointValue>;
  /** Each group by its name; a repeating group is a list, its first entry is number 1 in SunSpec's words. */
  groups: Record<string, GroupValue[]>;
}

export interface ModelValue extends GroupValue {
  id: number;
  label: string | null;
  address: number;
  length: number;
}

export interface DeviceValue {
  models: ModelValue[];
  /** Models the definitions do not know, kept as their blocks. */
  unknown: ModelBlock[];
}

/**
 * Reads a model from its block. Refuses `model_unknown` when no definition
 * has its id, and `model_length_invalid` when its length does not hold its
 * points and whole repeating groups.
 */
export function readModel(block: ModelBlock, definitions: readonly ModelDefinition[] = MODELS): ModelValue {
  const def = modelDefinition(block.id, definitions);
  if (!def) throw new Error(`model_unknown: no definition of model ${block.id}`);
  const reader = new Reader(block, def);
  const group = reader.group(def.group, 0, [], block.length + 2);
  if (reader.end !== block.length + 2) {
    throw new Error(`model_length_invalid: model ${block.id} at ${block.address} says ${block.length} registers, its points take ${reader.end - 2}`);
  }
  return { id: def.id, label: def.group.label ?? null, address: block.address, length: block.length, ...group };
}

/** Every model of a device from the registers read from its base address. */
export function readDevice(registers: readonly number[], baseAddress = 40000, definitions: readonly ModelDefinition[] = MODELS): DeviceValue {
  const out: DeviceValue = { models: [], unknown: [] };
  for (const block of readModelBlocks(registers, baseAddress)) {
    if (modelDefinition(block.id, definitions)) out.models.push(readModel(block, definitions));
    else out.unknown.push(block);
  }
  return out;
}

/** A point of a model by its path: `W`, `module[2].DCW`, `Crv[1].Pt[3].V` (repeats counted from 1). */
export function pointOf(model: GroupValue, path: string): PointValue | null {
  let group: GroupValue = model;
  const parts = path.split('.');
  for (const part of parts.slice(0, -1)) {
    const m = /^([^[\]]+)(?:\[(\d+)\])?$/.exec(part);
    const list = m ? group.groups[m[1]!] : undefined;
    const next = list?.[(m?.[2] ? Number(m[2]) : 1) - 1];
    if (!next) return null;
    group = next;
  }
  return group.points[parts[parts.length - 1]!] ?? null;
}

class Reader {
  end = 0;
  constructor(private readonly block: ModelBlock, private readonly def: ModelDefinition) {}

  /** Reads a group at an offset; `scope` holds the groups around it, the closest last. */
  group(def: GroupDefinition, offset: number, scope: GroupValue[], modelEnd: number): GroupValue {
    const out: GroupValue = { name: def.name, points: {}, groups: {} };
    const chain = [...scope, out];
    let at = offset;
    for (const p of def.points) {
      if (p.type !== 'pad') out.points[p.name] = this.point(p, at);
      at += p.size;
    }
    // Scale factors first known once every point of the group is read.
    for (const p of def.points) if (p.type !== 'pad' && p.sf !== undefined) scale(out.points[p.name]!, p, chain);
    for (const g of def.groups ?? []) {
      const n = this.count(g, chain, modelEnd - at);
      const list: GroupValue[] = [];
      for (let k = 0; k < n; k++) {
        const entry = this.group(g, at, chain, modelEnd);
        at = this.end;
        list.push(entry);
      }
      out.groups[g.name] = list;
    }
    this.end = at;
    return out;
  }

  private count(def: GroupDefinition, chain: GroupValue[], left: number): number {
    if (def.count === undefined) return 1;
    if (typeof def.count === 'string') {
      const holder = find(chain, def.count);
      const n = holder?.raw;
      if (typeof n !== 'number') throw new Error(`model_length_invalid: model ${this.def.id} counts ${def.name} by ${def.count}, which it does not implement`);
      return n;
    }
    if (def.count > 0) return def.count;
    // 0: as many as the model's length leaves room for.
    const size = groupSize(def);
    if (size === null || size === 0) throw new Error(`model_unknown: model ${this.def.id} repeats ${def.name}, whose size depends on its data`);
    if (left % size !== 0) throw new Error(`model_length_invalid: model ${this.def.id} at ${this.block.address} leaves ${left} registers for groups of ${size}`);
    return left / size;
  }

  private point(p: PointDefinition, at: number): PointValue {
    const regs = this.block.registers.slice(at, at + p.size);
    if (regs.length < p.size) throw new Error(`model_length_invalid: model ${this.def.id} at ${this.block.address} ends before ${p.name}`);
    const raw = decode(p, regs);
    const symbols = p.symbols ?? [];
    const isEnum = p.type.startsWith('enum');
    const isBits = p.type.startsWith('bitfield');
    return {
      name: p.name,
      type: p.type,
      address: this.block.address + at,
      size: p.size,
      raw,
      value: raw,
      sf: null,
      units: p.units ?? null,
      symbol: isEnum && raw !== null ? symbols.find((s) => s.value === Number(raw))?.name ?? null : null,
      flags: isBits && raw !== null ? symbols.filter((s) => (BigInt(raw) >> BigInt(s.value)) & 1n).map((s) => s.name) : [],
      writable: p.access === 'RW',
    };
  }
}

function find(chain: GroupValue[], name: string): PointValue | null {
  for (let i = chain.length - 1; i >= 0; i--) {
    const p = chain[i]!.points[name];
    if (p) return p;
  }
  return null;
}

function scale(point: PointValue, def: PointDefinition, chain: GroupValue[]): void {
  let sf: number | null;
  if (typeof def.sf === 'number') sf = def.sf;
  else {
    const holder = find(chain, def.sf!);
    sf = typeof holder?.raw === 'number' ? holder.raw : null;
  }
  point.sf = sf;
  if (point.raw === null) return;
  point.value = sf === null ? null : applyScale(point.raw, sf);
}

function applyScale(raw: Value, sf: number): Value {
  if (typeof raw === 'bigint') raw = Number(raw);
  if (typeof raw !== 'number' || sf === 0) return raw;
  return sf > 0 ? raw * 10 ** sf : Number((raw * 10 ** sf).toFixed(-sf));
}

/** Size of a group in registers, or null when it holds a repeat counted by its data. */
function groupSize(def: GroupDefinition): number | null {
  let size = def.points.reduce((s, p) => s + p.size, 0);
  for (const g of def.groups ?? []) {
    if (g.count !== undefined && g.count !== 1) return null;
    const inner = groupSize(g);
    if (inner === null) return null;
    size += inner;
  }
  return size;
}

// ---------------------------------------------------------------------------
// Types ⇄ registers
// ---------------------------------------------------------------------------

const UNIMPLEMENTED: Record<string, bigint> = {
  int16: 0x8000n, sunssf: 0x8000n, uint16: 0xffffn, count: 0xffffn, enum16: 0xffffn, bitfield16: 0xffffn, acc16: 0n,
  int32: 0x80000000n, uint32: 0xffffffffn, enum32: 0xffffffffn, bitfield32: 0xffffffffn, acc32: 0n, ipaddr: 0n,
  int64: 0x8000000000000000n, uint64: 0xffffffffffffffffn, bitfield64: 0xffffffffffffffffn, acc64: 0n, ipv6addr: 0n,
  float32: 0x7fc00000n, float64: 0x7ff8000000000000n,
};

const bits = (regs: readonly number[]): bigint => regs.reduce((acc, r) => (acc << 16n) | BigInt(r & 0xffff), 0n);

const signed = new Set(['int16', 'int32', 'int64', 'sunssf']);

function decode(p: PointDefinition, regs: readonly number[]): Value {
  const t = p.type;
  if (t === 'string') {
    const bytes = Buffer.from(regs.flatMap((r) => [(r >> 8) & 0xff, r & 0xff]));
    const end = bytes.indexOf(0);
    const text = bytes.subarray(0, end < 0 ? bytes.length : end).toString('utf8');
    return text === '' ? null : text;
  }
  if (t === 'raw16') return regs[0]!;
  if (t === 'eui48') {
    const b = bits(regs) & 0xffffffffffffn;
    if (b === 0xffffffffffffn) return null;
    return b.toString(16).padStart(12, '0').match(/../g)!.join(':').toUpperCase();
  }
  const b = bits(regs);
  if (UNIMPLEMENTED[t] !== undefined && b === UNIMPLEMENTED[t]) return null;
  if (t === 'float32' || t === 'float64') {
    const buf = Buffer.alloc(8);
    if (t === 'float32') {
      buf.writeUInt32BE(Number(b));
      const f = buf.readFloatBE(0);
      return Number.isNaN(f) ? null : f;
    }
    buf.writeBigUInt64BE(b);
    const f = buf.readDoubleBE(0);
    return Number.isNaN(f) ? null : f;
  }
  if (t === 'ipaddr') return [24, 16, 8, 0].map((s) => Number((b >> BigInt(s)) & 0xffn)).join('.');
  if (t === 'ipv6addr') return regs.map((r) => r.toString(16)).join(':');
  const width = BigInt(16 * regs.length);
  let n = b;
  if (signed.has(t) && b >> (width - 1n) === 1n) n = b - (1n << width);
  return Number.isSafeInteger(Number(n)) ? Number(n) : n;
}

// ---------------------------------------------------------------------------
// A value → the registers to write
// ---------------------------------------------------------------------------

export interface RegisterWrite {
  /** Modbus address of the first register. */
  address: number;
  /** What to write there, in one "write multiple registers". */
  registers: number[];
}

/**
 * The registers that set a point of a model read before: the value in the
 * point's units, scaled back by the scale factor the device gave and
 * rounded to the resolution it allows; an enum may be named by its symbol;
 * null writes "not implemented". Refuses `point_unknown`, `point_read_only`,
 * `scale_factor_unimplemented` and `value_out_of_range` (with the range of
 * the type in the point's units).
 */
export function writePoint(
  model: ModelValue, path: string, value: number | string | null, definitions: readonly ModelDefinition[] = MODELS,
): RegisterWrite {
  const p = pointOf(model, path);
  const def = p && definitionOf(modelDefinition(model.id, definitions)?.group, path);
  if (!p || !def) throw new Error(`point_unknown: no point ${path} in model ${model.id}`);
  if (!p.writable) throw new Error(`point_read_only: ${path} may not be written`);
  return { address: p.address, registers: encode(p, def, path, value) };
}

function definitionOf(group: GroupDefinition | undefined, path: string): PointDefinition | null {
  const parts = path.split('.');
  for (const part of parts.slice(0, -1)) {
    const name = part.replace(/\[\d+\]$/, '');
    group = group?.groups?.find((g) => g.name === name);
  }
  return group?.points.find((p) => p.name === parts[parts.length - 1]) ?? null;
}

const RANGES: Record<string, [bigint, bigint]> = {
  int16: [-0x8000n, 0x7fffn], uint16: [0n, 0xffffn], count: [0n, 0xffffn], enum16: [0n, 0xffffn], bitfield16: [0n, 0xffffn], acc16: [0n, 0xffffn], raw16: [0n, 0xffffn],
  int32: [-0x80000000n, 0x7fffffffn], uint32: [0n, 0xffffffffn], enum32: [0n, 0xffffffffn], bitfield32: [0n, 0xffffffffn], acc32: [0n, 0xffffffffn],
  int64: [-0x8000000000000000n, 0x7fffffffffffffffn], uint64: [0n, 0xffffffffffffffffn], bitfield64: [0n, 0xffffffffffffffffn], acc64: [0n, 0xffffffffffffffffn],
  sunssf: [-10n, 10n],
};

function encode(p: PointValue, def: PointDefinition, path: string, value: number | string | null): number[] {
  const words = (b: bigint) => Array.from({ length: p.size }, (_, i) => Number((b >> BigInt(16 * (p.size - 1 - i))) & 0xffffn));
  if (value === null) {
    if (p.type === 'string' || p.type === 'ipv6addr') return words(0n);
    if (p.type === 'eui48') return words(0xffffffffffffn);
    const u = UNIMPLEMENTED[p.type];
    if (u === undefined) throw new Error(`value_out_of_range: ${path} has no "not implemented" value`);
    return words(u);
  }
  if (p.type === 'string') {
    if (typeof value !== 'string') throw new Error(`value_out_of_range: ${path} is a string`);
    const bytes = Buffer.from(value, 'utf8');
    if (bytes.length > p.size * 2) throw new Error(`value_out_of_range: ${path} holds ${p.size * 2} bytes, not ${bytes.length}`);
    const padded = Buffer.alloc(p.size * 2);
    bytes.copy(padded);
    return Array.from({ length: p.size }, (_, i) => padded.readUInt16BE(i * 2));
  }
  if (typeof value === 'string') {
    const symbol = p.type.startsWith('enum') ? def.symbols?.find((s) => s.name === value) : undefined;
    if (!symbol) throw new Error(`value_out_of_range: ${path} has no symbol ${value}`);
    return encode(p, def, path, symbol.value);
  }
  if (p.type === 'float32' || p.type === 'float64') {
    const buf = Buffer.alloc(8);
    if (p.type === 'float32') buf.writeFloatBE(value);
    else buf.writeDoubleBE(value);
    return Array.from({ length: p.size }, (_, i) => buf.readUInt16BE(i * 2));
  }
  if (def.sf !== undefined && p.sf === null) throw new Error(`scale_factor_unimplemented: ${path} is scaled by ${def.sf}, which the device does not give`);
  const sf = p.sf ?? 0;
  const n = sf < 0 ? value * 10 ** -sf : value / 10 ** sf;
  const range = RANGES[p.type];
  if (!range || !Number.isFinite(n)) throw new Error(`value_out_of_range: ${path} of type ${p.type} takes no number`);
  const r = BigInt(Math.round(n));
  // The value that means "not implemented" is not a value one sets.
  const width = BigInt(16 * p.size);
  const asBits = r < 0n ? r + (1n << width) : r;
  const u = UNIMPLEMENTED[p.type];
  const lo = u === undefined || u !== (range[0] < 0n ? range[0] + (1n << width) : range[0]) ? range[0] : range[0] + 1n;
  const hi = u === range[1] ? range[1] - 1n : range[1];
  if (r < lo || r > hi || asBits === u) {
    const at = (b: bigint) => (sf < 0 ? Number((Number(b) * 10 ** sf).toFixed(-sf)) : Number(b) * 10 ** sf);
    throw new Error(`value_out_of_range: ${path} takes ${at(lo)} to ${at(hi)}${p.units ? ` ${p.units}` : ''}, not ${value}`);
  }
  return words(asBits);
}
