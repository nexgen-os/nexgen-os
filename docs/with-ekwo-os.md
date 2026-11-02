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
| Schemas | `nexgen`, and one per module (`actions`, `battery`, `billing`, `building`, `charging`, `community`, `consumption`, `grid`, `kpis`, `solar`, `weather`) | `ekwo` since Ekwo OS 0.23 (`public` from 0.17 to 0.22), and one per module (`crm`, `assets`, `tax`, `budgets`, `einvoicing`…) |
| Installer | `npx nexgen-os init`, `migrate`, `doctor` | `npx ekwo-os init`, `migrate`, `doctor` |
| History of what was applied | `nexgen.schema_migrations` | `supabase_migrations.schema_migrations` |
| Rights | granted by name, in the migration that creates the object ([0037](decisions/0037-the-schema-grants-its-own-rights.md)) | the same rule (Ekwo OS 0003), and the surface of its schema closed to `anon` (Ekwo OS 0002) |
| Who belongs | `nexgen.organisation_members` | `ekwo.company_members` |

Each installer applies only its own files, reads only its own history and
checks only its own schemas: `nexgen-os doctor` reads Ekwo's tables only
through the `billing` module's `billing.unlinked_keys()`, and `ekwo doctor`
never looks at `nexgen`. Neither creates, alters or grants
anything in the other's schemas.

**Reserved.** The schema name `ekwo` belongs to Ekwo OS, and so does the
prefix `ekwo.` of the settings its functions read. No module of Nexgen OS
takes it, nor the name of a schema an Ekwo OS module uses. `public` is the
installation's: Nexgen OS creates nothing there, and Ekwo OS kept its core
there until its 0.23.

**Where Ekwo OS lives.** Ekwo OS moved its core from `public` to `ekwo` in
its 0.23.0 (its decision 0090, migration
`20261028040000_the_socle_moves_to_its_schema`). Nexgen OS never assumes
either: the `billing` module finds the schema by Ekwo's own marker, its
`ekwo_schema_version()` function beside its `instance` table, looked for in
`ekwo` first and then in `public`, and in no other schema
(`billing.ekwo_schema()`, the rule Ekwo OS gives its own clients). Every
function of the module that reads an Ekwo table names it there
(`billing.ekwo_table()`), so an installation of Ekwo OS 0.17 to 0.22, in
`public`, and one of 0.23 or later, in `ekwo`, both work. The module's
migration `0002_ekwo_schema` brought this; before it, the module looked in
`public` only.

## Installing both

The order does not matter: the test below installs both ways and finds the
same objects on each side. On one Supabase project, with PostGIS enabled:

```sh
# The invoicing and bookkeeping core, in ekwo; it asks for what it needs (its guide lists the flags).
npx ekwo-os init
npx ekwo-os doctor

# The description of places, in nexgen, with the bridge module.
npx nexgen-os init --dry-run --modules billing --packs <cc>
npx nexgen-os init --modules billing --packs <cc>
npx nexgen-os doctor
```

`EKWO_DB_URL` and `NEXGEN_DB_URL` are the same connection string; neither is
written to a file. `--packs` names the countries of the installation's
places, and there is no default; without `--modules`, `init` installs every
module shipped. Then, in *Project settings → Data API → Exposed schemas*,
add `ekwo`, `nexgen` and the module schemas, so that one client reaches both
cores with the same signed-in session; `ekwo doctor` names `ekwo` while it
is not exposed (`ekwo_exposed`).

**An installation that holds Ekwo OS in `public`.** Bring Nexgen OS to the
release that carries `billing` 0002 (`npx nexgen-os migrate`) before, or
with, the `ekwo migrate` that moves Ekwo OS to `ekwo`: the module reads
either layout, and the foreign keys it added follow Ekwo's tables when they
move. With an older `billing` beside a moved Ekwo OS, the module finds no
Ekwo OS: `billing.tax_of()` answers the pack's rate, and a link is not
checked against Ekwo's rows.

## One source on a shared database

When both cores share the database, each fact has one source: the side
that keeps it is the one read, and the other holds nothing of it. Nexgen OS
keeps its own copy of a fact only when it runs alone, or while a party is
not linked to Ekwo OS; linking a party moves the fact to Ekwo OS
(`billing.link_organisation()`, `billing.link_contact()`), and
`nexgen-os doctor` names what is still held on both sides
(`billing_held_twice`).

| Fact | On a shared database | Nexgen OS alone | Read through |
|---|---|---|---|
| Legal numbers of a company or a person (registration number, VAT number, the identifiers of a register) | Ekwo OS: `companies` and `contacts` (`registration_number`, `vat_number`, `identifiers` keyed by scheme), matched by their ISO 6523 code (`identifier_schemes.icd`, the party and VAT schemes of Ekwo's `country_defaults`) | the identifiers of the organisation under a scheme with an ISO 6523 code (`enterprise_number` 0208, `siren` 0002, `siret` 0009) | `billing.legal_identifiers(kind, id)` |
| How a contact is reached (email, phone) | Ekwo OS: `contacts.email`, `contacts.phone` | `billing.contacts.email`, `phone`, while the contact is not linked | `billing.reach_of(contact)` |
| VAT on energy | Ekwo OS's tax of the code the pack names (`vat_code_electricity`: `BE-S-06`, `FR-S-20`, the codes of Ekwo's `taxes.json`), at its rate on the day | the rate of the pack (`vat_rate_electricity`), as a ratio, for a simulation | `billing.tax_of(participant, day)`; `billing.record_invoice()` refuses the invoice of a settlement taxed otherwise (`invoice_tax_mismatch`) |
| Currencies | each core its own table, seeded from one list (below) | `nexgen.currencies` | each core's own functions |
| Exchange rates | Ekwo OS (`currency_rates`) | none yet: a figure stays in the currency of its place ([road to 1.0](road-to-1.0.md)) | Ekwo OS |
| IBAN and payments | Ekwo OS | none: Nexgen OS keeps no bank account and no payment | Ekwo OS |
| Legal forms | Ekwo OS (`companies.legal_form`) | none | Ekwo OS |
| Fiscal year | Ekwo OS | none | Ekwo OS |

The last four stay Ekwo OS's on every installation. The VAT rate a pack
keeps is the rate of the law, for a simulation that runs without Ekwo OS;
the tax of an invoice is never that ratio but Ekwo's tax, by its code, at
the rate Ekwo holds on the day. Check digits are validated once, by Ekwo
OS: Nexgen OS compares legal numbers by their letters and digits only.

## Names and shapes both cores share

What both cores describe, they describe with the same names, so that a row
of one reads the same in the other:

- **the address lines**: `participants.address_line1` (the street and
  number) and `address_line2` (building, floor, unit, box), as Ekwo OS's
  `contacts` and `companies`, in `place_of()`, `join_project()`,
  `locate_participant()`, the geocoders and the GeoJSON of a place;
- **a document**: `documents.byte_size`, `checksum` (`sha256:<hex>`) and
  `uploaded_by`, as Ekwo OS's `attachments`;
- **an invitation**: the columns of Ekwo OS's `company_invitations`
  (`email`, `role`, `token_hash`, `invited_by`, `expires_at`,
  `accepted_at`, `accepted_by`, `revoked_at`) and its gestures,
  `invite_member()`, `accept_invitation()`, `revoke_invitation()`; the token
  is returned once and kept as its sha256, and re-inviting an address
  revokes the invitation still open to it. Nexgen OS's own:
  `accept_invitations()` at sign-in, an invitation that shares one project,
  roles without capabilities. A public link onto a document, Ekwo OS's
  `document_shares`, has no counterpart yet; a Nexgen OS publication
  ([0015](decisions/0015-publications.md)) will take the same columns
  (`token_hash`, `expires_at`, `revoked_at`, `created_by`, `view_count`);
- **the languages of Belgium**: `fr`, `nl`, `de`, in the order of Ekwo OS's
  pack; Ekwo OS adds `en`, a language of its invoices, and names `fr` its
  default, where the energy pack lists the official languages only and
  names no default ([pack `be`](../packs/be/README.md#the-languages)).

## One list of currencies

Both cores hold a `currencies` table with the same columns and constraints
(code, name, symbol, decimal places from 0 to 6, active): Ekwo OS in its
schema, Nexgen OS in `nexgen`, each read by its own functions through its
own search path. They stay one source because **the installers seed both
from one list**: the core seed of Nexgen OS holds, row for row, the ISO 4217
currencies Ekwo OS seeds (ISO 4217 list one as SIX publishes it for the
maintenance agency), plus `XXX`, ISO 4217's "no currency", the pattern the
units of a price are written in. A pack whose country's currency is not on
the list adds it (`identity.currency_details`), and never updates a row
either side holds. Nexgen OS does not read Ekwo's table: a database without
Ekwo OS needs its own, and a function of one core never resolves a table of
the other by its search path. The cross-install test applies Ekwo's seed
and checks the two lists are equal. Exchange rates are Ekwo's
(`currency_rates`); Nexgen OS holds none yet ([road to 1.0](road-to-1.0.md)).

## The bridge: the `billing` module

The core of Nexgen OS names no product and holds no personal contact data.
The [`billing`](../modules/billing/README.md) module keeps, beside the
core and keyed by the same ids, what links the two
([decision 0010](decisions/0010-the-participant-is-billed-ekwo-os-keeps-the-invoice.md)):

| Table | Holds |
|---|---|
| `billing.organisations` | the Ekwo company an organisation is: `ekwo_company_id`, one each |
| `billing.contacts` | the Ekwo contact a contact is, and the email and phone it is reached at while it is not linked to Ekwo OS on the same database |
| `billing.invoices` | the Ekwo invoices issued for or to a participant: the Ekwo id, the counterparty participant, `sale` or `purchase`, the period, the settlement |

The participant is the one who is billed, and its billing contact is the
core's `participants.contact_id`; the amounts, the currency, the tax and the
lines are read from Ekwo by the invoice's id.

When both share the database, the Ekwo ids are real foreign keys, to the
tables of the schema Ekwo OS lives in: `ekwo_company_id` to
`ekwo.companies`, `ekwo_contact_id` to `ekwo.contacts`, and the id of
`billing.invoices` to `ekwo.documents` (to `public.…` for Ekwo OS 0.17 to
0.22). Ekwo OS is recognised by its own marker — its `instance` table and
its `ekwo_schema_version()` function, in `ekwo` or in `public`
(`billing.ekwo_schema()`, `billing.ekwo_present()`) — never by a table
name: a database holding another application's `public.contacts` or
`public.documents` binds to nothing. The migration of
the module adds no key; `nexgen-os init` and `migrate` add them once the
migrations are applied, when Ekwo OS is there; when Ekwo OS is installed
second, the installation adds them with one statement:

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
`package.json`, 0.24.0, applied by Ekwo's own migration runner) and the
Nexgen OS core with the `billing` module (applied by `nexgen-os init`), in
both orders, with Ekwo OS in `ekwo` (all its migrations) and in `public`
(its migrations before the one that moves it, as Ekwo OS 0.17 to 0.22
leaves a database). It asserts, in each of the four cases, that:

- each side creates the same objects whichever installs first, and no
  schema, relation, function or type is created by both;
- `ekwo`, `public` and `supabase_migrations` hold only Ekwo's objects,
  `nexgen` and `billing` only Nexgen OS's;
- the `billing` module finds Ekwo OS where it lives, and `nexgen-os doctor`
  reports no problem;
- the second installation leaves every grant of the first as it was, Ekwo's
  revocations on its schemas and its default privileges included, and each
  `doctor` reads the same before and after;
- the short names both use (`contacts`, `currencies`, `documents`,
  `modules`, `products`, `schema_migrations`, `member_role`,
  `set_updated_at`, `accept_invitation`, `revoke_invitation`) live apart,
  each in its own schema;
- with Ekwo's seed applied, `nexgen.currencies` and Ekwo's `currencies`
  hold the same rows, `XXX` aside;
- the module schemas of both releases are disjoint, and none of Nexgen OS
  is `ekwo`;
- a member of both sides reads its organisation and its company, a stranger
  neither; `billing.organisations` points at an Ekwo company;
- with Ekwo OS installed first, `nexgen-os init` adds the foreign keys to
  Ekwo's `companies`, `contacts` and `documents`; with Nexgen OS first,
  `billing.reference_ekwo()` adds them; a participant's
  invoice is recorded against an Ekwo document, an unknown one is refused,
  and `nexgen-os doctor` names a row whose Ekwo id is gone;
- one source for each fact: a linked organisation's legal numbers are read
  from its Ekwo company by their ISO 6523 code, and its own are dropped (or
  the link refused when they differ); a linked contact is reached at what
  Ekwo holds, its own email and phone dropped and refused afterwards; the
  tax of a participant is Ekwo's tax of the code its pack names, at Ekwo's
  rate, an Ekwo tax out of force is refused rather than replaced by the
  pack's rate, and the invoice of a settlement taxed by another code is
  refused; `nexgen-os doctor` names what is held on both sides;
- Ekwo OS moving from `public` to `ekwo` with Nexgen OS beside it keeps the
  links and their foreign keys, which follow its tables; the module then
  finds it in `ekwo`, and `nexgen-os doctor` reports no problem.

Everything above runs on PGlite: Ekwo OS needs no extension. What the test
does not cover: Ekwo OS's seeds and country packs, its own modules, and the
Supabase services outside Postgres (the Data API, authentication) — on a
real project, `nexgen-os doctor` and `ekwo doctor` check the installation.

## See also

- [Decision 0010](decisions/0010-the-participant-is-billed-ekwo-os-keeps-the-invoice.md) — legal identity and invoicing are Ekwo's.
- [Decision 0032](decisions/0032-a-module-has-its-own-schema.md) — a module has its own schema.
- [`packages/cli/README.md`](../packages/cli/README.md) — the Nexgen OS installer.
- [Ekwo OS installer](https://github.com/Ekwo-ai/ekwo-os/tree/main/packages/cli) — `npx ekwo-os init`.
