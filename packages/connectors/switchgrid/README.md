# `@nexgen-os/switchgrid`

[Switchgrid](https://www.switchgrid.tech) as a meter data connector of Nexgen
OS, on its **API v0** (`https://api.switchgrid.tech`, header
`x-api-version: v0`; [specification](https://app.switchgrid.tech/docs/fr/v0/spec)).
Switchgrid is an intermediary: it collects the customer's consent on its own
page, attests it to the operator, and relays the operator's meter data as
the operator's raw files. MIT.

## The path of a load curve

1. **Consent.** `ask({ contracts, … })` (`POST /ask`) opens a request; the
   customer signs on `signingUrl` (two months to do so). The installation
   records a mandate on the meter (`grid.request_mandate()`), with the ask's
   id as its `external_reference`.
2. **Wait for the data to open.** The mandate is approved on the webhook
   event **`ask.contract_access_granted`** (`mandateStatusOf()` says
   `approved`), **not on `ask.accepted`**, which only says the mandate is
   signed: an order placed then is refused upstream ("No PRM was found to
   have a valid consent"). `ask.revoked` revokes it (`grid.revoke_mandate()`),
   and Switchgrid may erase the data. Switchgrid signs no webhook: the URL
   carries a token the installation chose, compared by
   `webhookTokenMatches()` in constant time.
3. **Read.** `collectMeterReadings(db, switchgrid({ token }), { connectorId,
   meterId, from, to, step })` of `@nexgen-os/core` asks the one mandate
   check (`grid.authorise_reading()`) first, then calls `readings()`, which:
   - refuses without the mandate the check returned (`mandate_missing`), or
     when it names no ask;
   - orders an **R63** (`POST /integration/enedis/order`; `R63_SYNC` for a
     week or less), one order per direction (`SOUTIRAGE`, and `INJECTION`
     for a meter that does both: an injection request on a meter without an
     injection contract fails alone, and is skipped);
   - waits for the order (`awaitOrder()`: `order_failed`, `order_timeout`);
   - downloads the files of `dataUrls` at once (the links last 15 minutes);
   - reads each with [`@nexgen-os/enedis-r6x`](../../formats/enedis-r6x/README.md),
     with the time zone and the quality table of the operator's hub from its
     pack row (`grid.operators.meter_data`), never from this code;
   - returns the series of the meter, which `collectMeterReadings()` stores
     with the source `switchgrid`.

| From the file | Series of the meter |
|---|---|
| `PA` `CONS` / `PROD` | `offtake_power` / `injection_power`, kW, the file's step (5 to 60 minutes) |
| `PRI` / `PRC` `CONS` | `reactive_power_inductive` / `_capacitive`, kvar |
| `E` | `voltage`, V |

Each value is dated at the start of its step in UTC, with the quality the
pack maps its letter to; a step the file does not carry is stored missing.

## Configuration

An organisation's `connectors` row names the source `switchgrid`, its
token by `secret_ref` (the vault holds it; the caller resolves it and passes
it as `token`, the connector reads no environment), and in `config`
`{ "environment": "test" }` for Switchgrid's test world
(`switchgrid-test-env: true`: no operator called, nothing billed, dummy
data; an ask made there never moves to production).

## Its source

The package ships its `sources` row, [`source.json`](source.json)
(`switchgridSource`; write it with `registerSource()` of the core): kind
`api`, `auth = 'mandate'`, the countries it serves declared there, not
redistributable, kept as long as the customer's consent holds (no fixed
number of days: the mandate's end is the end of what may be kept). It is not
a pack's row: Switchgrid is a commercial intermediary.

## What is not done yet

- The answers in `tests/fixtures` are built after the examples of the
  specification, not recorded: record them in the test world at the first
  run and keep them beside these; the tests must pass unchanged.
- The order body (`askId` and `requests`) follows the shape of the API this
  one replaces; check it against the v0 specification at the first run.
- Indexes (R64), daily energy (R65), maximum power (R66), technical data
  (C68) and gas are ordered by `order()` as they are, but not mapped to
  series yet.

## Licence

MIT.
