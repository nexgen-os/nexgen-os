# The optional hosted edition

*Everything in this repository is AGPL-3.0 (the core and the modules) or MIT
(the format libraries and the connectors), and always will be. This page is
about what is **not** in it, so that you know before you buy — and so that
you know what you never have to buy.*

The hosted edition is **Nexgen**, the application WeSmart runs at
[nexgen.wesmart.com](https://nexgen.wesmart.com), and the services around it,
operated by **WeSmart** (Newide in Belgium, AI4Energy in France). They are not part of
this repository, they carry no licence of this repository, and **nothing
here needs them.** An installation that never hears of the hosted edition
describes its places, computes its yields, runs its studies and exports
everything, for as long as its database runs.

## Where the line falls

The line is operational, or contractual: never functional. It is not about
which features are good enough to charge for. It is about what requires
somebody to operate something continuously, or to hold a licence, on your
behalf. The test, applied without exception:

> **Does it keep working on its own, with us or without us?**

If yes, it is in this repository and no key gates it: a yield computed from
open weather, a CityJSON file read into buildings, an address found in an
open register, a settlement computed from meter readings.

If no, it is a service, because something has to be kept alive or paid for:

| Service | What has to be kept alive or licensed |
|---|---|
| the hosted database and application | a Supabase project, its backups, its updates, the Nexgen application on top |
| licensed data | weather under licence (Meteonorm, Solargis), a solar API's roof layers, commercial map and geocoding services, company and cartography datasets of WeSmart Data — each a connector of the same open interface, with a key and terms that are not ours to give |
| a curated product catalogue | prices, installed costs, supplier references, verified datasheets — the physics of a product stays open |
| surveys and media | drone flights, photogrammetry, 3D scenes and films, rendered on a farm |
| fine yield studies | the engines of partners that model near shading in 3D, run as a profile whose results land here like any other |
| agents and support | the hosted agents that read your places and prepare your studies, and the people who answer |

## What comes back to the repository

A connector's interface, a format reader, a yield profile's parameters, a
country pack: when a service produces something that keeps working on its
own, it is published here. The hosted edition reads and writes the same
tables as every other installation; it has no private schema in your
database.

## What will never be sold

- a licence key to unlock a table, a function or a module of this
  repository;
- your data, your descriptions or your series, to anyone;
- the physics: how a yield, a loss, a sharing key or an indicator is
  computed is in this repository, with its decision and its test.
