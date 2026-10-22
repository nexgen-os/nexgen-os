# `nexgen-os` — the Python client

A Python package, `nexgen_os`, that reads the model of a Nexgen OS
installation and attaches what you know to it, with its source. It reads
the way the model is read (`attributes_of`, `resample` and the series
reads, `participant_of`, `country_of`), writes values the one way they are
written (`store`), and computes nothing: a figure is a run of a module, and
a program connector (`packages/connectors/`) is where a computation of your own goes. Requires
Python 3.9 or later and [psycopg 3](https://www.psycopg.org/psycopg3/);
Arrow, pandas and Polars are optional extras.

```bash
pip install -e "packages/python[binary]"   # psycopg with its binary build; drop [binary] to use your libpq
pip install -e "packages/python[pandas]"   # or [arrow], [polars]: to_arrow(), to_pandas(), to_polars() on a result
export NEXGEN_DB_URL='postgresql://…'  # the project's connection string, never written to a file
```

```python
from datetime import datetime, timezone
from nexgen_os import Nexgen, NexgenError

with Nexgen.connect() as nexgen:                 # NEXGEN_DB_URL, or Nexgen.connect(url)
    for participant in nexgen.participants():
        print(participant["name"], participant["country"], participant["time_zone"])

    participant = nexgen.participants()[0]["id"]
    nexgen.attach("participant", participant, "annual_consumption", 41000, source="2025 invoices",
                  valid_from=datetime(2025, 1, 1, tzinfo=timezone.utc),
                  valid_to=datetime(2026, 1, 1, tzinfo=timezone.utc))
    print(nexgen.attributes_of(participant, datetime(2025, 6, 1, tzinfo=timezone.utc)))

    try:
        days = nexgen.resample(series_id, datetime(2026, 6, 1, tzinfo=timezone.utc),
                               datetime(2026, 7, 1, tzinfo=timezone.utc), "1 day")
    except NexgenError as refused:
        print(refused.code)                      # time_zone_required, series_not_found…

    meter = {"object_id": meter_id, "quantity_code": "offtake_energy", "step": "15 minutes", "source_code": hub}
    nexgen.store(meter, [(datetime(2026, 6, 1, 0, 0, tzinfo=timezone.utc), 250.0)], unit="Wh")
    frame = nexgen.resample(series_id, start, end, "1 hour").to_pandas()   # with the pandas extra
```

## What it does

| Call | Reads or writes |
|---|---|
| `schema_version()` | `nexgen_schema_version()` |
| `organisations()`, `participants(organisation_id=None)` | the organisations and the participants, with their place, the connection may read |
| `attributes_of(object_id, at=None)` | every attribute holding at a moment |
| `resample(series_id, start, end, step, time_zone=None, issued_before=None)` | a series on a regular step over `[start, end)`, the amount of each bucket (a register's consumption), as `Bucket(start, value, samples, expected, quality)`; `step` is an interval (`"15 minutes"`, `"1 day"`) or a `timedelta` |
| `window(series_id, start, end, limit=100000)`, `latest(series_ids)` | the stored values in time order (a register's index); the last value of each series |
| `fill(series_id, start, end, step, method="linear")`, `coverage(series_id, start, end)` | every bucket with its gaps filled on read and flagged estimated; the gaps of a regular series |
| `forecast_at(series_id, start, end, as_of=None, horizon=None)`, `export_rows(series_ids, start, end)` | a forecast as it was known; the rows of a Parquet file |
| `store(series, values, *, unit=None, issued_at=None)` | the one write path: a series id or its identity, `(at, value[, quality])` tuples in `unit`; returns `Stored(series_id, changed)` |
| `convert_unit(value, from_unit, to_unit)` | a conversion of the core's `units` vocabulary |
| `participant_of(kind, object_id)`, `country_of(kind, object_id)` | the participant an object belongs to, the country of its place |
| `attach(kind, object_id, property_code, value, *, source=None, source_code=None, valid_from=None, valid_to=None)` | one attribute, with its period and where it comes from; returns its id |

Values are in the unit of the property's quantity (`quantities`), series
values are dated at the start of their interval, instants are
`datetime` with a time zone (UTC as they come back). Every read returns
`Rows`, a list of dataclasses; `rows.to_arrow()`, `rows.to_pandas()` and
`rows.to_polars()` give the same rows as columns when the extra is
installed, and refuse with `extra_required` otherwise.

## Rights and refusals

The client has no rights of its own: it sees and changes what the role of
its connection may, under row level security. Every refusal of the
database comes back as a `NexgenError` whose `code` is its name
(`invalid_value`, `overlapping_value`, `property_not_applicable`,
`series_not_found`, `time_zone_required`…), with the database's `message`
and its `sqlstate`. Three refusals are the client's own: `db_url_required`
(no connection string), `source_required` (an attribute without a
source is never attached) and `extra_required` (a dataframe asked without
its extra).

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
