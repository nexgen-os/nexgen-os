# 0010 — The billing bridge: one module reaches the invoicing side

> Status: accepted · 13/10/2026, rewritten 19/10/2026 and 21/10/2026 · a record of the modules

## Context

Ekwo OS is the open-source invoicing and bookkeeping core built on the
same playbook: companies, contacts, products, documents (quotes, invoices,
credit notes), entries, tax, electronic invoicing, with a pack per country.
A description of places meets invoicing at a few points: who an
organisation or a participant legally is, and how an amount a run computed
(a settlement, a share of a community's production) becomes an invoice.
Both cores used the schema `public` and tables of the same names
(`contacts`, `documents`, `projects`, `modules`), so they could not share a
database as they were.

## Decision

**Legal identity and invoicing are Ekwo's.** Nexgen OS computes what is
owed, as a run; Ekwo OS issues the invoice, its tax, its electronic
invoicing, its payment and its ledger entry. Nexgen OS keeps no second
ledger.

**One schema per core, one per module, `public` for the installation.** The
core of Nexgen OS lives in the schema `nexgen`, so that it shares a database
with Ekwo OS in `public` when an installation wants one transaction from
settlement to invoice; a connection reads it with `nexgen` on its search
path.

**The bridge is one module, `billing`, and the participant is the one who
is billed.** The module holds what links the two: the Ekwo company of an
organisation, the Ekwo contact of a contact, the personal details of a
contact that the invoicing side manages, and the Ekwo invoices issued for
or to a participant of the core. A participant's billing contact is its
own `contact_id`. When Ekwo shares the database, the module's keys are real
foreign keys to Ekwo's tables; when it runs elsewhere, the same columns are
plain references and the module reaches Ekwo through its API, the Ekwo
instance being a source with the name of its key. The core names no
product and holds no column of the bridge; why the participant is the
anchor, and why the bridge stays a module, is
[0043](0043-the-participant-is-billed.md).

## What it forbids

- An invoice, a tax line or a ledger entry in Nexgen OS.
- A column of the core that names Ekwo, or that holds a contact's email or
  telephone.
- Ekwo as a module of Nexgen OS, or the reverse: each core has its own
  installations, rights and releases.

## What it replaced

The core in `public`, and the bridge columns (`ekwo_company_id`,
`ekwo_contact_id`) and contact details on the core's own tables; then a
bridge of the organisation only, under another name, before the
participant became the one who is billed (21/10/2026, [0043](0043-the-participant-is-billed.md)).

## See also

- [The README, "Invoicing, and Ekwo OS"](../../README.md#invoicing-and-ekwo-os) — where the line is, in plain words.
- [0043](0043-the-participant-is-billed.md) — the participant is billed, Ekwo OS keeps the invoice.
- Inherits Ekwo OS 0051 (*A module has its own schema*), with a reasoned
  divergence: the core of Nexgen OS is in `nexgen`, where Ekwo's is in
  `public`.
- [0032](0032-a-module-has-its-own-schema.md) — the rules of a module.
- [`docs/nexgen-os-and-nexgen.md`](../nexgen-os-and-nexgen.md).
