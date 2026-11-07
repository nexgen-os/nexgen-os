/**
 * `@nexgen-os/solar` — the `solar` module of Nexgen OS, as a library.
 *
 * Pure functions, which read no database and no network:
 *
 * - the `pvwatts` yield physics (`./pvwatts`): Faiman cell temperature,
 *   the PVWatts DC model, the loss chain, the energy of an array hour by
 *   hour, and the typical year chosen month by month by the
 *   Finkelstein-Schafer statistic;
 * - P50 and the exceedance levels of yearly totals (`./exceedance`):
 *   normal distribution, interannual variability over the horizon and the
 *   named components in quadrature;
 * - the Sandia inverter fitted from an OND file (`./inverter`);
 * - the EPW and TMY3 weather file readers of `@nexgen-os/weather-files`,
 *   re-exported so that one install reads the weather and computes from it.
 *
 * And the gestures of the module on a database of Nexgen OS, which write
 * their figures to the `solar` schema with their inputs and provenance:
 * `estimateYield()`, `exceedance()`, `size()`, `performanceIndicators()`,
 * `importProduct()`. The schema itself is shipped in `supabase/migrations/`
 * and installed by `npx nexgen-os init`.
 */
export * from './pvwatts.js';
export * from './exceedance.js';
export * from './inverter.js';
export * from './estimates.js';
export * from './yield.js';
export * from './size.js';
export * from './performance.js';
export * from './products.js';
export {
  readEpw,
  readTmy3,
  writeEpw,
  WEATHER_QUANTITIES,
  type ReadOptions,
  type WeatherFile,
  type WeatherFileLocation,
  type WeatherFileWarning,
  type WeatherPoint,
  type WeatherQuantity,
  type WeatherSeries,
  type WeatherYear,
} from '@nexgen-os/weather-files';
