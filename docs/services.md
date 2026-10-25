# What is open, and what is a service around it

*Everything in this repository is AGPL-3.0 (the core and the modules) or MIT
(the format libraries and the connectors), and always will be. This page
says where this repository stops, so that nobody confuses the open
foundation with a commercial product built on it.*

**Nexgen OS** is the open-source foundation: a world model for energy
assets — organisations, projects, participants, their meters, devices and
series — and the open source operating system built on it, driven by AI
agents that work as users of the model. It is a
schema, vocabularies, modules, packs, format libraries and connectors — a
reference language for describing places, what is on them and what they
produce. It belongs to the project and its organisation on GitHub; anyone
can install it, read it, extend it.

**A platform built on it** — an application, studies, reports, licensed
data, agents and the people who answer — speaks its language and reads and
writes the same tables as every other installation. Such a platform is
**not** part of this repository, and nothing here describes, limits or
promises what it does.

## Where the line falls

The line is operational, or contractual: never functional. It is not about
which features are good enough to charge for. It is about what requires
somebody to operate something continuously, or to hold a licence, on your
behalf. The test, applied without exception:

> **Does it keep working on its own, with us or without us?**

If yes, it is in this repository and no key gates it: a yield computed from
open weather, a CityJSON file read into buildings, an address found in an
open register, a settlement computed from meter readings.

If no, it is a service someone operates or licenses:

| What a service provides | What has to be kept alive or licensed |
|---|---|
| a hosted platform | the application, its hosting, its backups, its updates, its support |
| licensed data | weather under licence, a solar API's roof layers, commercial map and geocoding services, company and cartography datasets — each a connector of the same open interface, with a key and terms that are not the project's to give |
| a curated product catalogue | prices, installed costs, supplier references, verified datasheets — the physics of a product stays open |
| surveys and media | drone flights, photogrammetry, 3D scenes and films |
| fine yield studies | engines that model near shading in 3D, run as a profile whose results land in the open model like any other |
| a central system for charging stations | the WebSocket each station keeps open over OCPP, its authentication, the commands sent on time — built on the open library [`@nexgen-os/ocpp`](../packages/formats/ocpp/README.md) and the functions of the [`charging`](../modules/charging/README.md) module |
| agents and people | agents run for an organisation — the same kind anyone can run on their own installation with the model of their choice — and the people who answer |

## What comes back to the repository

A connector's interface, a format reader, a yield profile's parameters, a
country pack: when something built for a service keeps working on its own,
it is published here. A platform built on Nexgen OS has no private schema
in your database.

## What is never sold

- a licence key to unlock a table, a function or a module of this
  repository;
- your data, your descriptions or your series, to anyone;
- the physics: how a yield, a loss, a sharing key or an indicator is
  computed is in this repository, with its decision and its test.

## Help and services

The foundation is free to install and to own. Installing, extending and
integrating it, writing a module or a pack for a country, and training a
team are services anyone may offer; the maintainers' contact is in the
repository's profile on GitHub. Nothing in the foundation is held back to
make a service necessary.
