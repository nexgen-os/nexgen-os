// `@nexgen-os/connector`: what a connector of Nexgen OS speaks, MIT
// (decision 0064) — the point it is asked about, the series it brings back,
// the interface of a weather source, the shape of a place and the interface
// of a geocoder, a meter data hub and the mandate it reads under, an
// operator's meter file and the readings of a P1 port as the series of a
// meter, the meters and devices a stream of readings lands on, what a
// charging station's connector read of a charger, a refusal
// by name, the `sources` row it ships, the subset of `fetch` it calls and the
// azimuth counted from south that weather and PV services expect. Types and
// pure functions only: no database, no network. `@nexgen-os/core` re-exports
// every name of this package, so that a connector and an installation share
// one definition, and a connector that imports this package instead of the
// core runs without the core's AGPL.
export * from './charger.js';
export * from './fetch.js';
export * from './measured.js';
export * from './meter.js';
export * from './meter-file.js';
export * from './meter-p1.js';
export * from './place.js';
export * from './refusal.js';
export * from './source.js';
export * from './weather.js';
