// An R63 or R64 file of Enedis as the series of a meter: `readMeterFile()`
// and `meterSeriesOfR6x()` live in `@nexgen-os/connector`, MIT, so that a
// connector relaying the files reads them without the core (decision 0064);
// the core re-exports them, one definition for both.
export { meterSeriesOfR6x, readMeterFile } from '@nexgen-os/connector';
