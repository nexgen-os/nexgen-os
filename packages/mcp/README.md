# @nexgen-os/mcp

The [Model Context Protocol](https://modelcontextprotocol.io) server for
[Nexgen OS](https://github.com/nexgen-os/nexgen-os). It lets an AI agent
work on the energy assets in your own Postgres: find an organisation and its
projects, add a participant with its place, declare its meter, install its
devices, import its readings, size a PV system or a battery, estimate a
yield, settle a sharing, read the indicators and propose what to do —
**as you**, under the row level security of your own installation
([decision 0039](../../docs/decisions/0039-an-agent-is-a-user-of-the-model.md),
[decision 0046](../../docs/decisions/0046-a-key-acts-as-its-issuer-an-agent-reaches-the-database-as-the-person.md)).

There are two ways to reach it, and they are the same server: started by a
client over stdio, or reached by URL over Streamable HTTP. It follows the
shape and the conventions of the MCP server of
[Ekwo OS](https://github.com/Ekwo-ai/ekwo-os), so one person configures
both the same way.

## Locally, over stdio

```sh
npx -y @nexgen-os/mcp@latest
```

For a client that launches its own servers — Claude Desktop, Claude Code,
any editor that reads `.mcp.json`:

```json
{
  "mcpServers": {
    "nexgen": {
      "command": "npx",
      "args": ["-y", "@nexgen-os/mcp@latest"],
      "env": {
        "NEXGEN_DB_URL": "postgresql://…",
        "NEXGEN_API_KEY": "ngk_…"
      }
    }
  }
}
```

The key is issued by a person who holds `members.manage` on the organisation (an owner), signed in:
`nexgen-os key create --organisation <id> --name "My agent"` (add `--write`
for a key that writes). Keep `@latest` in the command: from inside a clone
of the repository, a bare `npx @nexgen-os/mcp` finds the unbuilt workspace.

From a clone of the repository, `npx tsx modules/mcp.ts` starts the same
server with the computations of the modules shipped there (sizing, yields,
settlements), which the package on npm does not carry yet.

## What it is, and what it is not

The server holds no privileges of its own. Every tool runs in one
transaction that first says who it acts as, then takes the `authenticated`
role, so everything it can do is exactly what that person can do: a viewer
reads and cannot write, a member of one organisation does not see another.
None of that is checked in this package — the policies of the schema
decide, and this server reports what they answered.

Three things it will never do:

- **Write a figure.** A yield, a sizing, a settlement and an indicator are
  computed by their module and kept with their provenance; the tools call
  the module and read back what it kept. Every write goes through the
  schema's function for its gesture (`create_project()`, `join_project()`,
  `declare_meter()`, `install_device()`, `store()`, `kpis.compute()`,
  `actions.propose()`…); no tool writes SQL of its own.
- **Write when you did not allow it.** It reads by default. Writing is
  allowed by the person: `NEXGEN_WRITE=1` in the environment they wrote, a
  key with `write`, or the scope `energy.write` on the connection they
  approved. Otherwise the transaction is read only, and the database itself
  refuses the write (`read_only`).
- **Use a `service_role` key.** It would work, and that is the objection: it
  bypasses every policy, so the agent would answer for organisations its
  user was never invited to. The server refuses to start with one, in any
  slot.

## Configuration

One connection, and exactly one person to act as.

| Variable | Meaning |
|---|---|
| `NEXGEN_DB_URL` | The connection string of the database (on Supabase: the session pooler or the direct connection) |
| `NEXGEN_API_KEY` | A key of Nexgen OS (`ngk_…`): its issuer, within the key's organisation, read only unless the key carries `write` |
| `NEXGEN_ACCESS_TOKEN` | A person's session on the installation, verified by its Supabase Auth with the two below |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | The project and its anon (publishable) key, to verify a session. A `service_role` key is refused |
| `NEXGEN_ACT_AS_USER_ID` | The `auth.users` id of a person, for a self-hosted installation whose owner holds the connection anyway |
| `NEXGEN_WRITE` | `1` lets the agent write; it reads otherwise |
| `NEXGEN_GEOCODERS` | Optional. The geocoders an address may be sent to, by connector (`ban,photon`); none by default, and an address is then refused as `geocoder_not_configured` while a place given as a point is not. Each is keyed by the countries and regions its `sources` row serves, so the register of the country is asked first ([`geocoders.ts`](../core/src/geocoders.ts)) |
| `NEXGEN_GEOCODER_USER_AGENT` | The user agent a public instance asks for (Nominatim) |
| `NEXGEN_ENGINE_<NAME>` | The command of a program connector (`pvlib`, a sharing program): a tool names an engine, never its command |

**Started with nothing set**, the server still starts, still lists its
tools, and every call answers `not_configured` with the variables to set.
Only absence is forgiven: a `service_role` key, two people to act as or a
malformed id are refused at start.

## Over HTTP: hosting it for others

The hosted server is an operated service, not part of this repository; this
section says how anyone hosts one. `nexgen-mcp --http` serves the
**Streamable HTTP** transport of MCP at `<origin>/mcp`:

```sh
NEXGEN_DB_URL='postgresql://…' SUPABASE_URL='https://<ref>.supabase.co' \
SUPABASE_ANON_KEY='<anon key>' NEXGEN_MCP_ORIGIN='https://mcp.example.org' \
npx -y @nexgen-os/mcp@latest --http --port 8787
```

It is **stateless**: each request builds a server, answers in JSON and
closes it, with no session id and nothing kept, so it runs on a function
platform, behind a load balancer, or in one process. A `GET` on the
endpoint is `405`: this server never speaks first. `handleHttpRequest()`
(a web `Request` in, a `Response` out) and `handleNodeRequest()` (for
`node:http`) are the same handler, for a host that mounts it itself.

**Who a request acts as is decided per request**, from its bearer:

- **A key of Nexgen OS** (`Authorization: Bearer ngk_…`), presented to the
  database by `use_api_key()`: its issuer, within its organisation.
- **A person's access token**, verified by the installation's Supabase Auth;
  it writes only when the token carries the scope `energy.write`.

### Authorization: what a remote client discovers

A remote client — claude.ai, or any other that adds servers by URL —
follows the [authorization part of the MCP
specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization),
as it does for Ekwo OS's hosted server:

1. A request without a bearer is answered `401` with
   `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource", scope="energy"`.
2. `/.well-known/oauth-protected-resource` is the protected-resource
   metadata of **RFC 9728**: the resource `<origin>/mcp`, its authorization
   server, the scopes `energy` (read) and `energy.write` (write).
3. The authorization server publishes its metadata (**RFC 8414**), with a
   registration endpoint where the client registers itself (**RFC 7591**,
   so it needs no credentials of its own), then sends the person to approve
   the connection — and choose whether the agent may write.

By default the authorization server is **the installation's own Supabase
Auth** (`<SUPABASE_URL>/auth/v1`), its OAuth 2.1 server with dynamic client
registration turned on in the project's authentication settings; the
tokens it issues are the person's sessions, which this server verifies.
A host that is its own authorization server names itself instead
(`authorizationServers`) and serves its metadata here through
`authorizationServerMetadata()`: the code flow with PKCE `S256`, public
clients, refresh tokens, and its registration endpoint. Either way the
database stays the only place that decides what may be read or written.

An agent without a browser can start from
`<origin>/.well-known/oauth-protected-resource`.

## The tools

Every tool runs as the person. Read tools are annotated `readOnlyHint`;
`actions_validate` and `revoke_api_key` are annotated destructive, so a
client can ask before calling them.

| Tool | What it does |
|---|---|
| `status` | The schema version, who you act as, the modules installed, the organisations you read with your role |
| `list_organisations` · `list_projects` · `list_participants` · `list_meters` · `list_devices` · `list_series` | The six objects of the core, filtered by their parent |
| `get_object` | One object by its kind and id, with its attributes in force (`attributes_of()`) |
| `read_series` | The values of a series per bucket of a regular step (`resample()`) |
| `parameter_of` | A parameter of an object through the cascade of defaults (`parameter_of()`); null when nothing decides it |
| `list_api_keys` | The keys of an organisation you manage (`members.manage`), never a secret |
| `create_project` | Opens a project in an organisation, in the country the person names (`create_project()`) |
| `add_participant` | A participant joins a project with its place (`join_project()`), given as a point or found through the configured geocoder chain |
| `declare_meter` | A meter by its identifier in a scheme, which checks it (`declare_meter()`) |
| `install_device` | A device, from a product of the catalogue or with a stated power (`install_device()`) |
| `store_series` | Values through `store()`, each dated at the start of its interval, with their source |
| `import_series` | The readings of a file read by its format library — `homeassistant` — written through `store()` |
| `create_api_key` · `revoke_api_key` | A key issued by a person who holds `members.manage`, signed in, with capabilities they hold (`data.read`, `data.write`…), and its withdrawal; a key does not issue keys |
| `list_modules` | The modules installed and the tools each adds here |

**The modules.** A module installed on the database gets its tools, under
its code as a prefix; a module that is not installed offers none.

| Module | Tools |
|---|---|
| `kpis` | `kpis_of` (the indicators of an object, `kpis.of()`), `kpis_compute` (one kept as a figure, `kpis.compute()`) |
| `solar` | `solar_estimates`, `solar_size` (a named criterion, [0045](../../docs/decisions/0045-to-size-is-one-gesture.md)), `solar_estimate_yield` (a named profile) |
| `battery` | `battery_estimates`, `battery_size` |
| `charging` | `charging_sessions`, `charging_limit`, `charging_size` |
| `community` | `community_settlements`, `community_settle` (by the sharing engine the person configured) |
| `actions` | `actions_of_project`, `actions_propose` (`source = 'agent'`, resting on an estimate), `actions_validate` |

Sizing, yields and settlements are code of their module rather than
functions of the schema. A host hands them in (`buildServer(session, {
computations })`); `modules/computations.ts` is that list for the modules of
this repository, and without it these tools answer `computation_not_loaded`.

## Conventions

- **Refusals travel unchanged.** `time_zone_required:`, `read_only:`,
  `api_key_revoked:` and the rest arrive with the message the database
  raised, plus a sentence saying what to do. They are answers, not obstacles
  to route around ([0038](../../docs/decisions/0038-everything-raises-by-name.md)).
- **Dates are ISO**, a value is dated at the start of its interval, an
  azimuth is in degrees clockwise from true north. Identifiers are uuids.
- **Nothing is assumed**: a country, a currency, a time zone, a sizing
  criterion is the person's, or a pack's.
- **The schema is checked first**: a database older than `nexgenOs.schemaMin`
  is refused by name (`schema_too_old`).

## Testing it

The automated tests run every kind of tool against the real schema in
Postgres compiled to WebAssembly (`tests/mcp/`), the OAuth discovery
documents and the refusals included. By hand: install on a project you can
throw away (`npx nexgen-os init`), issue a key, point a client at it with
the block above, and ask for a first session — "list my organisations",
"add a participant at this address to the project", "declare its meter",
"import these readings", "size a PV system for 80 % self-consumption".

## Licence

[AGPL-3.0-only](../../LICENSE).
