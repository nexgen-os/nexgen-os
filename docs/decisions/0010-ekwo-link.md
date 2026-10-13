# 0010 — Where Ekwo OS runs, and what the bridge is

**Proposed 13/10/2026, decided the same day: B, with A as the fallback.**

## Context

Ekwo OS is the open-source accounting core built on the same playbook:
companies, contacts, products, documents (quotes, invoices, credit notes),
entries, VAT, e-invoicing, with a pack per country. Nexgen OS already leans
on it: an organisation keeps its `ekwo_company_id`, a contact its
`ekwo_contact_id`, and the settlement lines a run of the `sharing` module
hands over keep the Ekwo document ids they became ([0006](0006-named-objects.md)).

What is not decided: whether the two cores share one database or run in
two, and what the bridge between them is made of.

Two facts shape the answer. Ekwo's core lives in the `public` schema
(`companies`, `contacts`, `documents`, `products`, `projects`, `modules`…)
with its modules in schemas of their own. Nexgen OS's core also lives in
`public`, with tables of the same names (`contacts`, `documents`,
`projects`, `modules`). As they are, the two cannot be installed in one
`public`. Ekwo is published (0.10.0, installations, packages); Nexgen OS is
not yet, so its tables can still move.

## Options

**A. Two databases, one API.** Each core keeps its own database. Nexgen OS
reads contacts and creates invoices through Ekwo's machine access (MCP or
REST, an API key kept as `sources.secret_ref`), and writes the ids back.
No shared transaction; a contact's display name is copied. Works for every
layout, including the two companies' platforms on different accounts.

**B. One database, two schemas.** Nexgen OS's core moves from `public` to a
schema of its own, `nexgen`, as its modules already are (`architecture`,
`solar`…); Ekwo stays in `public`. Real foreign keys
(`ekwo_company_id references public.companies`), one row level security
context, one transaction from settlement to invoice. The cost is the one
every module already pays — the schema exposed on PostgREST and named in the
client — and a rename that is cheap now and impossible once migrations are
published.

**C. Ekwo as a module of Nexgen OS.** Ruled out: Ekwo would depend on Nexgen
OS's organisations and security, while it is a product with its own
installations and roadmap. Nexgen OS as a module of Ekwo is ruled out for
the same reason.

## Recommendation

Do B's move now — the core in schema `nexgen` — and keep A as the path that
always works. The bridge is one module, `ekwo`, and one library:

- the module's migration looks for `public.companies`. When Ekwo shares the
  database it adds the foreign keys and a view, `ekwo.contacts`, that pages
  read; when it does not, the id columns stay plain references and the view
  reads a local copy of the names;
- `formats/ekwo` (MIT) turns settlement lines into Ekwo documents through
  the same calls in both cases, with two transports: SQL when Ekwo shares
  the database, HTTP against Ekwo's API otherwise, the Ekwo instance being
  a `sources` row with its base URL and the name of its key;
- Ekwo stays the one place that knows who someone legally is and what they
  are invoiced; Nexgen OS stores ids and the run that computed the amounts,
  never a second ledger.

## Decision

B, with A as the path that always works. The core lives in the schema
`nexgen` from its first migration; a connection reads it with `nexgen` on
its search path, and on PostgREST the schema is exposed and named by the
client, as for every module. The same question is open on the Ekwo side:
its core could move from `public` to a schema `ekwo` at its next breaking
release, which would make the convention uniform — one schema per core,
one per module, `public` for the installation.
