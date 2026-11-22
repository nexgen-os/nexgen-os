// `@nexgen-os/connector`: what a connector of Nexgen OS speaks, MIT
// (decision 0064) — the point it is asked about, the series it brings back,
// the interface of a weather source, the shape of a place and the interface
// of a geocoder, a meter data hub and the mandate it reads under, what a
// charging station's connector read of a charger, a refusal
// by name, the `sources` row it ships, the subset of `fetch` it calls and the
// azimuth counted from south that weather and PV services expect. Types and
// pure functions only: no database, no network. `@nexgen-os/core` re-exports
// every name of this package, so that a connector and an installation share
// one definition, and a connector that imports this package instead of the
// core runs without the core's AGPL.
export * from './charger.js';
export * from './fetch.js';
export * from './meter.js';
export * from './place.js';
export * from './refusal.js';
export * from './source.js';
export * from './weather.js';
