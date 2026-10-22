# 0046 — A key acts as its issuer, and an agent reaches the database as the person

> Status: accepted

## Context

Decision [0039](0039-an-agent-is-a-user-of-the-model.md) lets an agent in
as the person who asked it, by their session or "a key the person issued".
The key did not exist, and neither did the server an agent connects to. Ekwo
OS has both: `api_keys` with a prefix, a hash, capabilities, an expiry, a
last use and a withdrawal; an MCP server over stdio and over Streamable
HTTP that refuses a `service_role` key and passes refusals on by name. Its
server reaches the books through PostgREST, because every gesture of
accounting is a function of the schema.

The energy model is not only functions of the schema. To size, to estimate a
yield, to settle a sharing or to import a file is code of a module or of
`@nexgen-os/core`, written against one seam, a database connection (`Db`),
and reading many rows. None of it runs over PostgREST.

## Decision

**A key acts as the person who issued it, within the organisation it was
issued on.** `create_api_key()` is an owner's gesture; the secret is shown
once and kept as its sha256. `use_api_key()`, at the top of a transaction,
refuses an unknown, revoked or expired key and one whose issuer left the
organisation, records the use, and puts the issuer in the claims of the
transaction: `auth.uid()` is that person and every policy binds as for them.
The two role helpers (`organisation_role()`, `project_role()`) stop at the
key's organisation. A key carries `read`, and `write` when it may write;
without `write` the transaction is made read only, so the database refuses
the write, not a tool.

**The MCP server and the command line reach the database through one seam,
as the person.** One connection (`NEXGEN_DB_URL`), and every transaction
acts as somebody: a key of Nexgen OS (`NEXGEN_API_KEY`), a person's session
verified by the installation's own Supabase Auth (`NEXGEN_ACCESS_TOKEN`), or
the user named by `NEXGEN_ACT_AS_USER_ID` for a self-hosted installation.
The claims and the `authenticated` role are set in each transaction; a
connection that would act as nobody is refused. A `service_role` key is
refused in every slot, with Ekwo OS's words.

**Read only unless the person allows writing.** An agent reads by default.
Writing is allowed by the person: `NEXGEN_WRITE=1` in the environment they
wrote, a key with `write`, or the scope `energy.write` on the token they
approved. The transaction is read only otherwise, whatever the tool.

**One code path for a gesture.** What the MCP tools and the command line do
is one set of functions in `@nexgen-os/core` (`gestures/`), each calling the
schema's function for its gesture or the module that computes it; neither
surface writes SQL of its own.

## What it forbids

- A key wider than its issuer, a key that issues keys, a key outside its
  organisation.
- A surface that runs as the owner of the database because nobody was named.
- A tool that checks rights the database already checks.

## What it leaves open

- The PostgREST route of Ekwo OS's server: it comes when the gestures that
  are code today are reachable as functions of the schema.
- The hosted server is an operated service: the package says how anyone
  hosts it (`packages/mcp/README.md`), and the repository holds no
  deployment.

## See also

- Ekwo OS 0053, 0062 and 0064, whose shape this keeps.
- [`packages/mcp/README.md`](../../packages/mcp/README.md).
