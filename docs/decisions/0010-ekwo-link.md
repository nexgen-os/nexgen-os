# 0010 — The accounting bridge: one module reaches the accounting side

> Status: accepted · 13/10/2026, rewritten 19/10/2026 · a record of the modules

## Context

Ekwo OS is the open-source accounting core built on the same playbook:
companies, contacts, products, documents (quotes, invoices, credit notes),
entries, tax, electronic invoicing, with a pack per country. A description
of places meets accounting at a few points: who an organisation or a
contact legally is, and how an amount a run computed (a settlement, a
share of a community's production) becomes an invoice. Both cores used
the schema `public` and tables of the same names (`contacts`, `documents`,
`projects`, `modules`), so they could not share a database as they were.

## Decision

**Legal identity and invoicing are Ekwo's.** Nexgen OS computes what is
owed, as a run; Ekwo OS issues the invoice, its tax, its electronic
invoicing, its payment and its accounting entry. Nexgen OS keeps no second
ledger.

**One schema per core, one per module, `public` for the installation.** The
core of Nexgen OS lives in the schema `nexgen`, so that it shares a database
with Ekwo OS in `public` when an installation wants one transaction from
settlement to invoice; a connection reads it with `nexgen` on its search
path.

**The bridge is one module, `accounting`.** It holds what links the two: the Ekwo
company of an organisation, the Ekwo contact of a contact, the documents a
run's amounts became, and the personal details of a contact that
accounting manages. When Ekwo shares the database, its keys are real
foreign keys; when it runs elsewhere, the same columns are plain
references and the module reaches Ekwo through its API, the Ekwo instance
being a source with the name of its key. The core names no product and
holds no column of the bridge.

## What it forbids

- An invoice, a tax line or an accounting entry in Nexgen OS.
- A column of the core that names Ekwo, or that holds a contact's email or
  telephone.
- Ekwo as a module of Nexgen OS, or the reverse: each core has its own
  installations, rights and releases.

## What it replaced

The core in `public`, and the bridge columns (`ekwo_company_id`,
`ekwo_contact_id`) and contact details on the core's own tables.

## See also

- Inherits Ekwo OS 0051 (*A module has its own schema*), with a reasoned
  divergence: the core of Nexgen OS is in `nexgen`, where Ekwo's is in
  `public`.
- [0032](0032-a-module-has-its-own-schema.md) — the rules of a module.
- [`docs/nexgen-os-and-nexgen.md`](../nexgen-os-and-nexgen.md).
