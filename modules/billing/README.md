# `billing` — the bridge to the invoicing side

Status: shipped with schema 0.3, decisions [0010](../../docs/decisions/0010-ekwo-link.md)
and [0043](../../docs/decisions/0043-the-participant-is-billed.md). Schema: `billing`.

Who a company or a person legally is, how to reach them and how they are
invoiced is kept by an invoicing application; Ekwo OS is the open one built
on the same playbook. The core names no product and keeps no personal
contact data: an organisation is a name, a contact is a name and a kind,
and a participant of a project names the contact who answers for it
(`participants.contact_id`), which is its billing contact. This module
keeps, beside them and keyed by the same ids, what links them to the
invoicing side: pointers and gestures, never an amount, a currency, a tax,
a VAT number, an IBAN or an invoice line, which are Ekwo's.

| Table | Holds |
|---|---|
| `billing.companies` | the Ekwo company an organisation is, one each |
| `billing.contacts` | the email and phone a contact is reached at, and the Ekwo contact it is; personal data, readable by the organisation's members only |
| `billing.invoices` | one row per Ekwo invoice issued for or to a participant: its Ekwo id, the participant, the counterparty participant of a bill inside a community, `sale` or `purchase` from the participant's point of view, the first and last day it covers, and the settlement run the amounts came from |

| Function | Does |
|---|---|
| `billing.link_company(organisation, ekwo_company)` | says which Ekwo company an organisation is (`organisation_not_found`, `ekwo_company_not_found`) |
| `billing.link_contact(contact, ekwo_contact)` | says which Ekwo contact a contact is (`contact_not_found`, `ekwo_contact_not_found`) |
| `billing.record_invoice(participant, ekwo_invoice, kind, from, to, counterparty, run)` | records an Ekwo invoice of a participant (`participant_not_found`, `participant_contact_missing`, `invoice_already_recorded`, `ekwo_invoice_not_found`) |
| `billing.invoices_of(participant)` | the invoices of a participant, by period, with their Ekwo ids: what a page or an agent lists without knowing Ekwo |
| `billing.reference_ekwo()` | adds the foreign keys to Ekwo's tables that exist; run by the migration, and again by the installation when Ekwo OS is installed after Nexgen OS |
| `billing.unlinked_keys()` | the rows whose Ekwo id is no longer in Ekwo OS, read by `nexgen-os doctor` (`billing_key_unlinked`) |
| `billing.verify_remote_invoice(source, ekwo_invoice)` | the same check against an Ekwo OS on another database, through its API: raises `ekwo_remote_not_supported` until the invoicing bridge of the contracts module completes it |

**When Ekwo OS shares the database**, the Ekwo ids are real foreign keys:
`billing.companies.ekwo_company_id` to `public.companies`,
`billing.contacts.ekwo_contact_id` to `public.contacts`, and
`billing.invoices.id` to `public.documents`, the one table where Ekwo OS
keeps its sales and purchase invoices and credit notes. The gestures check
the Ekwo id under the signed-in person's rights on Ekwo's side as well: a
person who records an invoice is a member of the Ekwo company that issued
it. **When it does not**, the same columns are plain uuids, and the
gestures accept any id.

**Issuing an invoice is not this module's.** Turning a settlement line into
an Ekwo invoice, through SQL or through Ekwo's API, is the invoicing bridge
of the `contracts` module, which then records it here with
`billing.record_invoice()`.

Install: `npx nexgen-os init --modules billing`.
