# Nexgen OS and Nexgen: what is open, what is WeSmart's

*Everything in this repository is AGPL-3.0 (the core and the modules) or MIT
(the format libraries and the connectors), and always will be. This page
says where this repository stops, so that nobody confuses the open
foundation with the commercial product built on it.*

**Nexgen OS** is the open-source foundation: a schema, vocabularies, modules,
packs, format libraries and connectors — a reference language for describing
places, what is on them and what they produce. It belongs to the project
and its organisation on GitHub; anyone can install it, read it, extend it.

**Nexgen** is the commercial platform of WeSmart (Newide in Belgium,
AI4Energy in France): the application, the studies, the reports, the data
connections, the agents and the services WeSmart sells to project holders,
installers, cities and communities. Nexgen is built on Nexgen OS and speaks
its language; it is **not** part of this repository, it is **not** open
source, and nothing here describes, limits or promises what Nexgen does.
Nexgen keeps its own name, its own terms and its own roadmap, as WeSmart's
product.

## Where the line falls

The line is operational, or contractual: never functional. It is not about
which features are good enough to charge for. It is about what requires
somebody to operate something continuously, or to hold a licence, on your
behalf. The test, applied without exception:

> **Does it keep working on its own, with us or without us?**

If yes, it is in this repository and no key gates it: a yield computed from
open weather, a CityJSON file read into buildings, an address found in an
open register, a settlement computed from meter readings.

If no, it is something WeSmart operates or licenses within Nexgen:

| What Nexgen provides | What has to be kept alive or licensed |
|---|---|
| the platform itself | the application, its hosting, its backups, its updates, its support |
| licensed data | weather under licence (Meteonorm, Solargis), a solar API's roof layers, commercial map and geocoding services, company and cartography datasets of WeSmart Data — each a connector of the same open interface, with a key and terms that are not ours to give |
| a curated product catalogue | prices, installed costs, supplier references, verified datasheets — the physics of a product stays open |
| surveys and media | drone flights, photogrammetry, 3D scenes and films, rendered on a farm |
| fine yield studies | the engines of partners that model near shading in 3D, run as a profile whose results land in the open model like any other |
| agents and people | the agents WeSmart runs for its customers — the same kind anyone can run on their own installation with the model of their choice — and the people who answer |

## What comes back to the repository

A connector's interface, a format reader, a yield profile's parameters, a
country pack: when something WeSmart builds for Nexgen keeps working on its
own, it is published here. Nexgen reads and writes the same tables as every
other installation of Nexgen OS; it has no private schema in your database.

## What will never be sold

- a licence key to unlock a table, a function or a module of this
  repository;
- your data, your descriptions or your series, to anyone;
- the physics: how a yield, a loss, a sharing key or an indicator is
  computed is in this repository, with its decision and its test.

## Help and services

The foundation is free to install and to own. The team that writes it is
WeSmart's, and its time is for sale: an account on Nexgen
([nexgen.wesmart.com](https://nexgen.wesmart.com)) gives the platform built on
this base, and WeSmart ([wesmart.com/nexgen](https://wesmart.com/nexgen), a call
at [cal.com/fpbordes/30min](https://cal.com/fpbordes/30min)) installs,
extends and integrates the foundation, writes a module or a pack for a
country, and trains a team. That is how the foundation is paid for; nothing
in it is held back to make it necessary.
