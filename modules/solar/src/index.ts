// The code of the solar module, as a package (`@nexgen-os/solar`): what an
// application imports to compute what the module computes, against a database
// where the module is installed. Each computation writes its estimate with its
// inputs and its provenance (decision 0012); the pure functions under it — the
// PVWatts model, the Faiman cell temperature, the typical year chosen month by
// month by Finkelstein-Schafer, the exceedance quantiles — are exported too, so
// that one implementation serves every caller.
export * from './estimates.js';
export * from './exceedance.js';
export * from './inverter.js';
export * from './performance.js';
export * from './products.js';
export * from './pvwatts.js';
export * from './size.js';
export * from './yield.js';
