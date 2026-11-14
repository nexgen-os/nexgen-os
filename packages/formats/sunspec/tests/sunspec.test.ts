// Three SunSpec devices as registers, each read by the SunSpec Alliance's own
// reader (pysunspec2, tests/fixtures/make-fixtures.py) and by this package:
// the same models, the same values with their scale factors, the same
// repeating groups. Then the map refused when it is not one, and values
// written back as registers.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MODELS, modelDefinition, pointOf, readDevice, readModel, readModelBlocks, writePoint,
  type GroupDefinition, type GroupValue, type ModelValue,
} from '@nexgen-os/sunspec';

interface Fixture { baseAddress: number; registers: number[]; models: { id: number; computed: Record<string, unknown> }[] }
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as Fixture;

/** A model read by this package, in the shape pysunspec2 gives: points by name, a repeating group as a list. */
function asReference(group: GroupValue, def: GroupDefinition): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of def.points) {
    if (p.type === 'pad') continue;
    const v = group.points[p.name]!;
    // pysunspec2 leaves a value raw when its scale factor is not implemented; this package says null.
    out[p.name] = p.sf !== undefined && v.sf === null && v.raw !== null ? v.raw : v.value;
  }
  for (const g of def.groups ?? []) {
    const list = group.groups[g.name]!.map((entry) => asReference(entry, g));
    out[g.name] = g.count === undefined ? list[0] : list;
  }
  return out;
}

function withoutPads(computed: Record<string, unknown>, def: GroupDefinition): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of def.points) if (p.type !== 'pad') out[p.name] = computed[p.name];
  for (const g of def.groups ?? []) {
    const v = computed[g.name];
    out[g.name] = Array.isArray(v) ? v.map((e) => withoutPads(e as Record<string, unknown>, g)) : withoutPads(v as Record<string, unknown>, g);
  }
  return out;
}

describe.each(['site', 'device_1547', 'inverter_123'])('the device %s, as the reference reads it', (name) => {
  const f = fixture(name);
  const device = readDevice(f.registers, f.baseAddress);

  it('holds the same models, in the same order, none unknown', () => {
    expect(device.models.map((m) => m.id)).toEqual(f.models.map((m) => m.id));
    expect(device.unknown).toEqual([]);
  });

  it('gives every point the value the reference computes', () => {
    device.models.forEach((model, i) => {
      const def = modelDefinition(model.id)!.group;
      expect(asReference(model, def)).toEqual(withoutPads(f.models[i]!.computed, def));
    });
  });
});

describe('a three-phase hybrid inverter with its meter and battery', () => {
  const f = fixture('site');
  const device = readDevice(f.registers, f.baseAddress);
  const model = (id: number) => device.models.find((m) => m.id === id)!;

  it('says who made it', () => {
    const common = model(1);
    expect(common.label).toBe('Common');
    expect([common.points.Mn!.value, common.points.Md!.value, common.points.SN!.value]).toEqual(['Example Inverters', 'HX-10K-3P', 'HX10K-000123']);
    expect(common.points.DA!.value).toBe(1);
  });

  it('reads its power, voltage and energy in their units, scaled', () => {
    const inv = model(103);
    expect(inv.address).toBe(40000 + 2 + 68);
    expect(inv.points.W).toMatchObject({ value: 3250, units: 'W', sf: 0, writable: false });
    expect(inv.points.PhVphA).toMatchObject({ raw: 2312, value: 231.2, units: 'V', sf: -1 });
    expect(inv.points.PF).toMatchObject({ raw: -985, value: -0.985 });
    expect(inv.points.WH).toMatchObject({ value: 12345678, units: 'Wh' });
  });

  it('names an enum by its symbol and a bitfield by its flags', () => {
    const inv = model(103);
    expect(inv.points.St).toMatchObject({ value: 4, symbol: 'MPPT' });
    expect(inv.points.Evt1!.flags).toEqual(['GROUND_FAULT', 'MANUAL_SHUTDOWN']);
  });

  it('reads what the device does not implement as null', () => {
    const inv = model(103);
    expect(inv.points.PPVphAB).toMatchObject({ raw: null, value: null });
    expect(model(1).points.Opt!.value).toBe('grid-tie');
    expect(model(802).points.WarrDt!.value).toBeNull();
  });

  it('reads the repeating groups the count of their model says', () => {
    const mppt = model(160);
    expect(mppt.groups.module!.map((m) => [m.points.IDStr!.value, m.points.DCV!.value, m.points.DCW!.value])).toEqual([['east', 411, 1693], ['west', 423, 1697]]);
    expect(pointOf(mppt, 'module[2].DCA')!.value).toBe(4.05);
    expect(pointOf(mppt, 'module[3].DCA')).toBeNull();
  });

  it('keeps the sign of what a meter measures and the registers of its energy', () => {
    const meter = model(203);
    expect(meter.points.W!.value).toBe(-2780);
    expect([meter.points.TotWhImp!.value, meter.points.TotWhExp!.value]).toEqual([5873100, 2104500]);
  });

  it('gives the state of charge of its battery', () => {
    const battery = model(802);
    expect(battery.points.SoC).toMatchObject({ value: 64.5, units: '%WHRtg' });
    expect(battery.points.ChaSt!.symbol).toBe('HOLDING');
  });
});

describe('the map', () => {
  const f = fixture('site');

  it('cuts the registers into models with their addresses', () => {
    const blocks = readModelBlocks(f.registers, 40000);
    expect(blocks.map((b) => [b.id, b.address, b.length])).toEqual([
      [1, 40002, 66], [103, 40070, 50], [120, 40122, 26], [123, 40150, 24], [124, 40176, 24], [160, 40202, 48], [203, 40252, 105], [802, 40359, 62],
    ]);
    expect(blocks[0]!.registers.length).toBe(68);
  });

  it('refuses a map without its marker, and one cut short, by name', () => {
    expect(() => readModelBlocks([0, 0, 1, 66], 40000)).toThrow(/^suns_missing/);
    expect(() => readModelBlocks(f.registers.slice(0, 100), 40000)).toThrow(/^map_truncated: .* address 40122$/);
  });

  it('keeps a model it has no definition of, and reads it with the caller\'s', () => {
    const own = [0x5375, 0x6e53, 64999, 2, 7, 0xffff, 0xffff, 0];
    const device = readDevice(own, 0);
    expect(device.unknown).toEqual([{ id: 64999, address: 2, length: 2, registers: [64999, 2, 7, 0xffff] }]);
    const definitions = [...MODELS, {
      id: 64999,
      group: {
        name: 'example', type: 'group', points: [
          { name: 'ID', type: 'uint16', size: 1 }, { name: 'L', type: 'uint16', size: 1 },
          { name: 'Level', type: 'uint16', size: 1, sf: 'Level_SF', units: 'Pct' }, { name: 'Level_SF', type: 'sunssf', size: 1 },
        ],
      },
    }];
    expect(readDevice(own, 0, definitions).models[0]!.points.Level!.value).toBe(0.7);
  });

  it('refuses a model whose length does not hold its points', () => {
    const block = readModelBlocks(f.registers, 40000)[5]!;
    expect(() => readModel({ ...block, length: 47, registers: block.registers.slice(0, 49) })).toThrow(/^model_length_invalid/);
    expect(() => readModel({ id: 64999, address: 0, length: 0, registers: [64999, 0] })).toThrow(/^model_unknown/);
  });

  it('carries every model the SunSpec Alliance publishes', () => {
    expect(MODELS.length).toBe(112);
    expect([1, 103, 160, 203, 701, 704, 802].every((id) => modelDefinition(id))).toBe(true);
  });
});

describe('writing a value', () => {
  const device = readDevice(fixture('site').registers, 40000);
  const model = (id: number) => device.models.find((m) => m.id === id)! as ModelValue;

  it('gives the registers that limit the active power, scaled back', () => {
    const controls = model(123);
    expect(writePoint(controls, 'WMaxLimPct', 60)).toEqual({ address: controls.points.WMaxLimPct!.address, registers: [600] });
    expect(writePoint(controls, 'WMaxLim_Ena', 'ENABLED')).toEqual({ address: controls.points.WMaxLim_Ena!.address, registers: [1] });
    expect(writePoint(controls, 'OutPFSet', -0.95).registers).toEqual([0x10000 - 950]);
  });

  it('gives the registers of a battery\'s charge limit and reserve', () => {
    const storage = model(124);
    expect(writePoint(storage, 'WChaMax', 3000).registers).toEqual([300]);
    expect(writePoint(storage, 'MinRsvPct', 12.5).registers).toEqual([125]);
    expect(writePoint(storage, 'InWRte', null).registers).toEqual([0x8000]);
  });

  it('reads back what it writes', () => {
    const f = fixture('site');
    const storage = model(124);
    const w = writePoint(storage, 'MinRsvPct', 20);
    const registers = [...f.registers];
    registers.splice(w.address - 40000, w.registers.length, ...w.registers);
    expect(readDevice(registers, 40000).models.find((m) => m.id === 124)!.points.MinRsvPct!.value).toBe(20);
  });

  it('refuses what may not be written, by name', () => {
    const controls = model(123);
    expect(() => writePoint(model(103), 'W', 1000)).toThrow(/^point_read_only/);
    expect(() => writePoint(controls, 'Nothing', 1)).toThrow(/^point_unknown/);
    expect(() => writePoint(controls, 'WMaxLimPct', 7000)).toThrow(/^value_out_of_range: WMaxLimPct takes 0 to 6553.4 % WMax, not 7000$/);
    expect(() => writePoint(controls, 'WMaxLim_Ena', 'SOMETIMES')).toThrow(/^value_out_of_range/);
    expect(() => writePoint(controls, 'VArWMaxPct', -3276.8 * 10)).toThrow(/^value_out_of_range/);
  });

  it('refuses a scaled value whose scale factor the device does not give', () => {
    const f = fixture('site');
    const block = readModelBlocks(f.registers, 40000).find((b) => b.id === 123)!;
    const registers = [...block.registers];
    registers[registers.length - 3] = 0x8000; // WMaxLimPct_SF not implemented
    const controls = readModel({ ...block, registers });
    expect(controls.points.WMaxLimPct).toMatchObject({ raw: 1000, value: null, sf: null });
    expect(() => writePoint(controls, 'WMaxLimPct', 60)).toThrow(/^scale_factor_unimplemented/);
  });
});
