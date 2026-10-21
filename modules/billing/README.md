# `billing` — the bridge to the invoicing side

Status: shipped with schema 0.2, decision [0010](../../docs/decisions/0010-ekwo-link.md). Schema: `billing`.

Who a company or a person legally is, how to reach them and how they are
invoiced is kept by an invoicing application; Ekwo OS is the open one built
on the same playbook. The core names no product and keeps no personal
contact data: an organisation is a name, a contact is a name and a kind.
This module keeps, beside them and keyed by the same ids, what links them to
the invoicing side.

| Table | Holds |
|---|---|
| `billing.companies` | the Ekwo company an organisation is, one each |
| `billing.contacts` | the email and phone a contact is reached at, and the Ekwo contact it is; personal data, readable by the organisation's members only |

Install: `npx nexgen-os init --modules billing`.
