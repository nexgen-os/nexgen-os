# `nexgen-os` — the Python client

A Python package, `nexgen_os`, that reads the model of a Nexgen OS
installation and attaches what you know to it, with its source. It reads
the way the model is read (`attributes_of`, `resample`, `site_of`,
`country_of`) and computes nothing: a figure is a run of a module, and an
engine (`engines/`) is where a computation of your own goes. Requires
Python 3.9 or later and [psycopg 3](https://www.psycopg.org/psycopg3/).

```bash
pip install -e "sdk/python[binary]"   # psycopg with its binary build; drop [binary] to use your libpq
export NEXGEN_DB_URL='postgresql://…'  # the project's connection string, never written to a file
```

```python
from datetime import datetime, timezone
from nexgen_os import Nexgen, NexgenError

with Nexgen.connect() as nexgen:                 # NEXGEN_DB_URL, or Nexgen.connect(url)
    for site in nexgen.sites():
        print(site["name"], site["country"], site["time_zone"])

    site = nexgen.sites()[0]["id"]
    nexgen.attach(site, "annual_consumption", 41000, source="2025 invoices",
                  valid_from=datetime(2025, 1, 1, tzinfo=timezone.utc),
                  valid_to=datetime(2026, 1, 1, tzinfo=timezone.utc))
    print(nexgen.attributes_of(site, datetime(2025, 6, 1, tzinfo=timezone.utc)))

    try:
        days = nexgen.resample(series_id, datetime(2026, 6, 1, tzinfo=timezone.utc),
                               datetime(2026, 7, 1, tzinfo=timezone.utc), "1 day")
    except NexgenError as refused:
        print(refused.code)                      # time_zone_required, series_not_found…
```

## What it does

| Call | Reads or writes |
|---|---|
| `schema_version()` | `nexgen_schema_version()` |
| `organisations()`, `sites(organisation_id=None)` | the organisations and sites the connection may read |
| `attributes_of(object_id, at=None, scenario_id=None)` | every attribute holding at a moment, in a scenario (`None` = reality) |
| `resample(series_id, start, end, step, time_zone=None, issued_before=None)` | a series on a regular step over `[start, end)`, as `Bucket(start, value, samples)`; `step` is an interval (`"15 minutes"`, `"1 day"`) or a `timedelta` |
| `site_of(object_id)`, `country_of(object_id)` | the site an object is on, the country whose rules apply |
| `attach(object_id, property_code, value, *, source=None, source_code=None, valid_from=None, valid_to=None, scenario_id=None)` | one attribute, with its period and where it comes from; returns its id |

Values are in the unit of the property's quantity (`quantities`), series
values are dated at the start of their interval, instants are
`datetime` with a time zone.

## Rights and refusals

The client has no rights of its own: it sees and changes what the role of
its connection may, under row level security. Every refusal of the
database comes back as a `NexgenError` whose `code` is its name
(`invalid_value`, `overlapping_value`, `property_not_applicable`,
`series_not_found`, `time_zone_required`…), with the database's `message`
and its `sqlstate`. Two refusals are the client's own: `db_url_required`
(no connection string) and `source_required` (an attribute without a
source is never attached).

`Nexgen.connect()` opens the connection in autocommit: each call is its own
statement and a refusal leaves the connection usable. A psycopg connection
given to `Nexgen(connection)` is used as it is, inside whatever transaction
its owner opened. Statements are bound on the client and sent as simple
queries, so a pooler in transaction mode (Supabase's on port 6543) serves
them.

## Tests

`tests/test_client.py` runs against a real installation: from the
repository root, `NEXGEN_SDK_PYTHON=<python with nexgen_os> npx vitest run
tests/sdk-python.test.ts` installs a fresh database, serves it over the
Postgres protocol and runs the client's tests against it (a `.venv-sdk` at
the root is found without the variable). The `sdk-python` job of CI does
the same on Python 3.12.

MIT, as the format libraries and the connectors: a client can live inside
any product.
