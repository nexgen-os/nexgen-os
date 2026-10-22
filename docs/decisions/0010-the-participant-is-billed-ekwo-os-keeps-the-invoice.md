# 0010 — The participant is billed, Ekwo OS keeps the invoice: one thin bridge module

> Status: accepted · a record of the modules

## Context

Ekwo OS is the open-source invoicing and bookkeeping core built on the
same playbook: companies, contacts, products, documents (quotes, invoices,
credit notes), entries, tax, electronic invoicing, with a pack per country.
A description of places meets invoicing at a few points: who an
organisation or a participant legally is, and how an amount a run computed
(a settlement, a share of a community's production) becomes an invoice.

In an energy community the bills are issued per participant: what a
consumer owes for the energy it received, what a producer is owed, and the
bills between two participants of the same community. The contact who
answers for the participant (`participants.contact_id`) holds the legal
identity a bill needs — the company name, the tax number, the bank
account, the address — and Ekwo OS keeps that contact and the invoice.

Both cores use short names of the same words (`contacts`, `documents`,
`projects`, `modules`). And Ekwo OS is optional: it may share the database,
run on another one, or be reached through its API
([`docs/with-ekwo-os.md`](../with-ekwo-os.md)). A core column pointing at an
Ekwo table would make every installation carry it, and would break the day
an installation bills from an Ekwo OS hosted elsewhere.

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

**The participant is the one who is billed.** An Ekwo invoice issued for or
to a participant is a row of `billing.invoices`, keyed by the Ekwo id, with
the participant, the counterparty participant of a bill inside a community,
`sale` or `purchase` from the participant's point of view, the period it
covers and the settlement run its amounts came from. Its billing contact is
the participant's own `contact_id`; `billing.record_invoice()` refuses a
participant that names none (`participant_contact_missing`), and
`billing.invoices_of()` lists a participant's invoices for a page or an
agent that knows nothing of Ekwo.

**The bridge is one module, `billing`, and a thin one.** It holds pointers
and gestures: the Ekwo company of an organisation, the Ekwo contact of a
contact and the personal details of a contact that the invoicing side
manages, the Ekwo invoices of a participant. The invoice, its amounts, its
currency, its tax, its lines, its status and the legal identity of the
contact stay Ekwo's, one source of truth; they are read from Ekwo by the
id. The invoice is issued in Ekwo OS, and the bridge records it.

**The keys are direct when the cores share a database.** When Ekwo's tables
are there, `billing.reference_ekwo()` adds real foreign keys from the
module's Ekwo ids to `public.companies`, `public.contacts` and
`public.documents`, the table where Ekwo OS keeps its invoices; the
module's migration runs it, and the installation runs it again when Ekwo OS
is installed second. Otherwise the ids are plain uuids, and
`nexgen-os doctor` names every row whose Ekwo id is not in Ekwo OS
(`billing_key_unlinked`). This module does not reach an Ekwo OS on another
database: `billing.verify_remote_invoice()` refuses with
`ekwo_remote_not_supported`.

## What it forbids

- An invoice, a tax line or a ledger entry in Nexgen OS; an amount, a
  currency, a tax number, a bank account or an address of a contact.
- A column of the core that names Ekwo, that points at one of its tables,
  or that holds a contact's email or telephone.
- A second contact table, or a second contact column on the participant:
  the billing contact is `participants.contact_id`.
- Issuing an invoice from the `billing` module.
- Ekwo as a module of Nexgen OS, or the reverse: each core has its own
  installations, rights and releases.

## See also

- [The README, "Invoicing, and Ekwo OS"](../../README.md#invoicing-and-ekwo-os) — where the line is, in plain words.
- Inherits Ekwo OS 0051 (*A module has its own schema*), with a reasoned
  divergence: the core of Nexgen OS is in `nexgen`, where Ekwo's is in
  `public`.
- [0032](0032-a-module-has-its-own-schema.md) — the rules of a module.
- [0042](0042-a-module-starts-from-an-object-of-the-core.md) — a module
  starts from an object of the core; `billing.invoices` is a secondary table
  of the participant.
- [`modules/billing/README.md`](../../modules/billing/README.md) — the
  tables and the gestures.
- [`docs/with-ekwo-os.md`](../with-ekwo-os.md) — the two cores on one
  database.
