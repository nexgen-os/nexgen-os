# With Ekwo OS — two cores on one database

Nexgen OS describes places, devices and series and computes what is owed, as
a calculation. [Ekwo OS](https://github.com/Ekwo-ai/ekwo-os), the open invoicing and bookkeeping core
built on the same playbook, issues the invoice, its tax, its electronic
invoicing and its ledger entry ([decision 0010](decisions/0010-the-participant-is-billed-ekwo-os-keeps-the-invoice.md)).
Each is installed, upgraded and released on its own; both may live in the
same Supabase project, so that a settlement and the invoice it becomes are
one transaction away. This page says how, and what each side owns.

## Who owns what

| | Nexgen OS | Ekwo OS |
|---|---|---|
| Schemas | `nexgen`, and one per module (`billing`, `building`, `community`, `consumption`, `grid`, `planning`, `solar`, `weather`) | `public`, and one per module (`crm`, `assets`, `tax`, `budgets`, `einvoicing`) |
| Installer | `npx nexgen-os init`, `migrate`, `doctor` | `npx ekwo-os init`, `migrate`, `doctor` |
| History of what was applied | `nexgen.schema_migrations` | `supabase_migrations.schema_migrations` |
| Rights | granted by name, in the migration that creates the object ([0037](decisions/0037-the-schema-grants-its-own-rights.md)) | the same rule (Ekwo OS 0003), and the surface of `public` closed to `anon` (Ekwo OS 0002) |
| Who belongs | `nexgen.organisation_members` | `public.company_members` |

Each installer applies only its own files, reads only its own history and
checks only its own schemas: `nexgen-os doctor` reads `public` only through
the `billing` module's `billing.unlinked_keys()`, and `ekwo doctor` never
looks at `nexgen`. Neither creates, alters or grants
anything in the other's schemas.

**Reserved.** The schema name `ekwo` belongs to Ekwo OS, and so does the
prefix `ekwo.` of the settings its functions read. No module of Nexgen OS
takes it, nor the name of a schema an Ekwo OS module uses.

## Installing both

The order does not matter: the test below installs both ways and finds the
same objects on each side. On one Supabase project, with PostGIS enabled:

```sh
# The invoicing and bookkeeping core, in public; it asks for what it needs (its guide lists the flags).
npx ekwo-os init --db-url "$EKWO_DB_URL"

# The description of places, in nexgen, with the bridge module.
npx nexgen-os init --dry-run
npx nexgen-os init --modules billing --packs <cc>
npx nexgen-os doctor
```

`EKWO_DB_URL` and `NEXGEN_DB_URL` are the same connection string; neither is
written to a file. Then, in *Project settings → Data API → Exposed schemas*,
keep `public` and add `nexgen` and the module schemas, so that one client
reaches both cores with the same signed-in session.

## The bridge: the `billing` module

The core of Nexgen OS names no product and holds no personal contact data.
The [`billing`](../modules/billing/README.md) module keeps, beside the
core and keyed by the same ids, what links the two
([decision 0010](decisions/0010-the-participant-is-billed-ekwo-os-keeps-the-invoice.md)):

| Table | Holds |
|---|---|
| `billing.organisations` | the Ekwo company an organisation is: `ekwo_company_id`, one each |
| `billing.contacts` | the Ekwo contact a contact is, and the email and phone it is reached at |
| `billing.invoices` | the Ekwo invoices issued for or to a participant: the Ekwo id, the counterparty participant, `sale` or `purchase`, the period, the settlement |

The participant is the one who is billed, and its billing contact is the
core's `participants.contact_id`; the amounts, the currency, the tax and the
lines are read from Ekwo by the invoice's id.

When both share the database, the Ekwo ids are real foreign keys:
`ekwo_company_id` to `public.companies`, `ekwo_contact_id` to
`public.contacts`, and the id of `billing.invoices` to `public.documents`.
The module's migration adds them when Ekwo OS is already there; when Ekwo OS
is installed second, the installation adds them with one statement:

```sql
select billing.reference_ekwo();
```

`nexgen-os doctor` names each row whose Ekwo id is not in Ekwo OS
(`billing_key_unlinked`). When Ekwo OS runs elsewhere, the columns are plain
references, and the module does not reach it:
`billing.verify_remote_invoice()` raises `ekwo_remote_not_supported`.

A person is a member on each side separately: an owner of a Nexgen OS
organisation and of the Ekwo company it is reads both, each under its own
row level security; a member of one side only sees nothing of the other.

## What the test checks

[`tests/cross-install.test.ts`](../tests/cross-install.test.ts) installs, on
PGlite with PostGIS in `extensions` as a Supabase project places it, the
Ekwo OS core migrations from the published `ekwo-os` package (pinned in
`package.json`, applied by Ekwo's own migration runner) and the Nexgen OS
core with the `billing` module (applied by `nexgen-os init`), in both
orders. It asserts that:

- each side creates the same objects whichever installs first, and no
  schema, relation, function or type is created by both;
- `public` (and `supabase_migrations`) hold only Ekwo's objects, `nexgen` and
  `billing` only Nexgen OS's;
- the second installation leaves every grant of the first as it was, Ekwo's
  revocations on `public` and its default privileges included, and each
  `doctor` reads the same before and after;
- the short names both use (`contacts`, `documents`, `modules`,
  `schema_migrations`, `member_role`, `set_updated_at`) live apart, each in
  its own schema;
- the module schemas of both releases are disjoint, and none is `ekwo`;
- a member of both sides reads its organisation and its company, a stranger
  neither; `billing.organisations` points at an Ekwo company;
- with Ekwo OS installed first, the module's migration adds the foreign keys
  to `public.companies`, `public.contacts` and `public.documents`; with
  Nexgen OS first, `billing.reference_ekwo()` adds them; a participant's
  invoice is recorded against an Ekwo document, an unknown one is refused,
  and `nexgen-os doctor` names a row whose Ekwo id is gone.

Everything above runs on PGlite: Ekwo OS needs no extension. What the test
does not cover: Ekwo OS's seeds and country packs, its own modules, and the
Supabase services outside Postgres (the Data API, authentication) — on a
real project, `nexgen-os doctor` and `ekwo doctor` check the installation.

## See also

- [Decision 0010](decisions/0010-the-participant-is-billed-ekwo-os-keeps-the-invoice.md) — legal identity and invoicing are Ekwo's.
- [Decision 0032](decisions/0032-a-module-has-its-own-schema.md) — a module has its own schema.
- [`packages/cli/README.md`](../packages/cli/README.md) — the Nexgen OS installer.
- [Ekwo OS installer](https://github.com/Ekwo-ai/ekwo-os/tree/main/packages/cli) — `npx ekwo-os init`.
