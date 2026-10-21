# 0043 — The participant is billed, Ekwo OS keeps the invoice

> Status: accepted · 21/10/2026

## Context

Since [0042](0042-a-module-starts-from-an-object-of-the-core.md) the
participant of a project is an object of the core, with the contact who
answers for it (`participants.contact_id`). In an energy community the
bills are issued per participant: what a consumer owes for the energy it
received, what a producer is owed, and the bills between two participants
of the same community. The contact holds the legal identity the bill needs
— the company name, the VAT number, the bank account, the address — and
Ekwo OS keeps that contact and the invoice
([0010](0010-ekwo-link.md)). The bridge module linked only the
organisation and its contacts to Ekwo; a participant's bills had no place.

The question was asked whether the core itself could reference Ekwo's
tables, since whoever bills installs both cores side by side. It cannot:
Ekwo OS is optional, and it may run on another database or behind its API
([`docs/with-ekwo-os.md`](../with-ekwo-os.md)). A core column pointing at
an Ekwo table would make every installation carry it, and would break the
day an installation bills from a hosted Ekwo.

## Decision

**The participant is the one who is billed.** An Ekwo invoice issued for or
to a participant is a row of `billing.invoices`, keyed by the Ekwo id, with
the participant, the counterparty participant of a bill inside a community,
`sale` or `purchase` from the participant's point of view, the period it
covers and the settlement run its amounts came from. Its billing contact is
the participant's own `contact_id`; `billing.record_invoice()` refuses a
participant that names none (`participant_contact_missing`), and
`billing.invoices_of()` lists a participant's invoices for a page or an
agent that knows nothing of Ekwo.

**The bridge is a module, and a thin one.** `billing` holds pointers and
gestures: the Ekwo company of an organisation, the Ekwo contact of a
contact, the Ekwo invoices of a participant. The invoice, its amounts, its
currency, its tax, its lines, its status and the legal identity of the
contact stay Ekwo's, one source of truth; they are read from Ekwo by the id.
Issuing the invoice from a settlement line is the invoicing bridge of the
`contracts` module, which then records it here.

**The keys are direct when the cores share a database.** When Ekwo's tables
are there, `billing.reference_ekwo()` adds real foreign keys from the
module's Ekwo ids to `public.companies`, `public.contacts` and
`public.documents`, the table where Ekwo OS keeps its invoices; the
module's migration runs it, and the installation runs it again when Ekwo OS
is installed second. Otherwise the ids are plain uuids, and
`nexgen-os doctor` names every row whose Ekwo id is no longer in Ekwo OS
(`billing_key_unlinked`). An Ekwo OS on another database is reached through
its API by the same bridge of the `contracts` module; until then
`billing.verify_remote_invoice()` refuses with `ekwo_remote_not_supported`.

## What it forbids

- An amount, a currency, a tax, a VAT number, a bank account, an address
  or an invoice line in Nexgen OS.
- A column of the core that names Ekwo, or that points at one of its
  tables.
- A second contact table, or a second contact column on the participant:
  the billing contact is `participants.contact_id`.
- Issuing an invoice from the `billing` module.

## What it replaced

The `accounting` module, a bridge of the organisation only: the Ekwo
company of an organisation and the Ekwo contact of a contact, with no place
for a participant's invoices and no foreign key to Ekwo's tables. It was
renamed `billing`, with no alias since nothing of it was released
([0033](0033-a-module-code-outlives-its-names.md) is about released codes).

## See also

- [0010](0010-ekwo-link.md) — the billing bridge: one module reaches the
  invoicing side.
- [0042](0042-a-module-starts-from-an-object-of-the-core.md) — a module
  starts from an object of the core; `billing.invoices` is a secondary table
  of the participant.
- [`modules/billing/README.md`](../../modules/billing/README.md) — the
  tables and the gestures.
- [`docs/with-ekwo-os.md`](../with-ekwo-os.md) — the two cores on one
  database.
