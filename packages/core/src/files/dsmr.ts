// The readings of a P1 port as the series of a meter: `meterSeriesOfDsmr()`
// lives in `@nexgen-os/connector`, MIT, so that a connector that receives
// them (`mqtt`) maps them without the core (decision 0064); the core
// re-exports it, one definition for both.
export { meterSeriesOfDsmr, type DsmrMeterSeries } from '@nexgen-os/connector';
