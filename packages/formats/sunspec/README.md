# `@nexgen-os/sunspec` — SunSpec Modbus ⇄ plain shapes

Reads what a SunSpec device — an inverter, a meter, a battery, a tracker —
holds in its Modbus registers into plain shapes any tool can use, and gives
the registers that set a value back. The information models the SunSpec
Alliance publishes are included, all 112 of them. MIT for the code,
Apache-2.0 for the models (`NOTICE`); no dependency, no Modbus connection,
no clock, no database.

| SunSpec | Shape | Notes |
|---|---|---|
| the map: `SunS` at a base address (40000, 50000 or 0), then models until `0xFFFF` | `ModelBlock[]` | `readModelBlocks()`: each model's id, the address of its id register, its length and its registers; `suns_missing` without the marker, `map_truncated` with the address to read up to |
| a model's registers | `ModelValue` | `readModel()`: every point with its address, raw value, value scaled by its scale factor (`raw x 10^sf`), units, enum symbol, bitfield flags, and whether it may be written; groups by name, a repeating group as a list |
| a device | `DeviceValue` | `readDevice()`: every model it holds, and the blocks of the models no definition knows |
| a point to set | `RegisterWrite` | `writePoint()`: the address and the registers of one "write multiple registers", the value scaled back by the scale factor the device gave |

```ts
import { readDevice, pointOf, writePoint } from '@nexgen-os/sunspec';

const { models } = readDevice(registers, 40000);      // registers read from 40000, "SunS" first
const inverter = models.find((m) => m.id === 103)!;   // three-phase inverter
inverter.points.W;                                    // { value: 3250, units: 'W', sf: 0, … }
pointOf(models.find((m) => m.id === 160)!, 'module[2].DCW'); // the second MPPT input
const controls = models.find((m) => m.id === 123)!;
writePoint(controls, 'WMaxLimPct', 60);               // { address, registers: [600] } with WMaxLimPct_SF = -1
```

A repeating group is counted as its model says: by a point (`N`, `NCrv`,
`NPt`…) or, when its count is 0, by what the model's length leaves. Paths
count repeats from 1, as SunSpec does (`Crv[1].Pt[3].V`).

What a device does not implement reads as `null`, by the values SunSpec
reserves for it (`0x8000` for an `int16` or a scale factor, `0xFFFF` for a
`uint16`, an enum or a bitfield, 0 for an accumulator, NaN for a float, an
empty string). A point whose scale factor is not implemented keeps its
`raw` and has no `value`: the package does not guess the scale.

`writePoint()` refuses by name: `point_unknown`, `point_read_only` (the
model says `R`), `scale_factor_unimplemented`, and `value_out_of_range`
with the range of the type in the point's units. An enum may be written by
its symbol (`'ENABLED'`); `null` writes "not implemented".

A model a device carries and the published definitions do not — a vendor's
own — is kept in `unknown`, and read with the caller's definition, in the
same shape as the published ones (`[...MODELS, mine]`).

What it never does: open a Modbus connection, choose a base address for
the caller, decide a limit, or convert a unit the model does not define.
Reading and writing over Modbus TCP or RTU is a connector's job.

## The models it is written from

`src/models.ts` is written by `scripts/models.mjs` from the JSON files of
[sunspec/models](https://github.com/sunspec/models) (Apache-2.0), at the
commit its first lines name. The tests read three devices whose registers
and values come from the SunSpec Alliance's own reader,
[pysunspec2](https://github.com/sunspec/pysunspec2)
(`tests/fixtures/make-fixtures.py`): a three-phase hybrid inverter with its
MPPT inputs, meter and battery (models 1, 103, 120, 123, 124, 160, 203,
802), a DER of IEEE 1547-2018 (models 701 to 713) and an inverter with
ride-through curves (model 129). Every value this package reads equals the
one pysunspec2 computes, except where a scale factor is not implemented:
pysunspec2 leaves the raw value, this package says `null`.
