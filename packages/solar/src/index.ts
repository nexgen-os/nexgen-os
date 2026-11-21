// `@nexgen-os/solar`: the computations of a PV yield as plain functions of
// numbers and series, MIT (decision 0063) — the PVWatts DC model, the Faiman
// cell temperature, the typical year chosen month by month by
// Finkelstein-Schafer, the exceedance levels and the normal quantile under
// them, and the local standard time they cut days and years in. No database,
// no network, no dependency. The `solar` module of an installation (AGPL-3.0)
// computes its estimates with these functions and writes them with their
// provenance.
export * from './exceedance.js';
export * from './pvwatts.js';
export * from './series.js';
export * from './time.js';
