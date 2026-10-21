"""A client of a Nexgen OS installation, over its Postgres connection.

It reads the model the one way the model is read (``attributes_of``,
``resample``, ``site_of``, ``country_of``, and the series reads ``window``,
``latest``, ``fill``, ``coverage``, ``forecast_at``, ``export_rows``),
writes values the one way they are written (``store``), and attaches an
attribute with its period and its source. Every method is one call of the
SQL function of the same name. It computes nothing: a figure is a run of a
module. Reads return rows (dataclasses); ``to_arrow()``, ``to_pandas()``
and ``to_polars()`` on the result need the optional extras
(``nexgen-os[arrow]``, ``[pandas]``, ``[polars]``).
It sees and changes what its connection's role may, under row level
security; it has no rights of its own.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Union

from .errors import NexgenError, named
from .frames import Rows

Step = Union[str, timedelta]
#: A value to store: ``(at, value)``, ``(at, value, quality)`` or a mapping with those keys.
Value = Union[Sequence[Any], Mapping[str, Any]]


@dataclass(frozen=True)
class Bucket:
    """One step of a resampled series: its start, its value in the quantity's unit, how many readings made it,
    how many a regular series expects in it, and the worst quality among them."""

    start: datetime
    value: Optional[float]
    samples: int
    expected: Optional[int] = None
    quality: Optional[int] = None


@dataclass(frozen=True)
class Reading:
    """One stored value: its instant (UTC), its value in the quantity's unit, its quality code."""

    at: datetime
    value: float
    quality: int


@dataclass(frozen=True)
class SeriesReading:
    """One stored value of one of several series."""

    series_id: str
    at: datetime
    value: float
    quality: int


@dataclass(frozen=True)
class Gap:
    """A run of values a regular series expects and does not have."""

    start: datetime
    end: datetime
    missing: int


@dataclass(frozen=True)
class ForecastValue:
    """One value of a forecast, with the time it was issued."""

    at: datetime
    value: float
    issued_at: datetime


@dataclass(frozen=True)
class Stored:
    """What ``store()`` did: the series written, and the rows that changed."""

    series_id: str
    changed: int


class Nexgen:
    """The model of one installation, through a psycopg 3 connection.

    ``connect()`` opens it in autocommit: each call is its own statement, and a
    refusal leaves the connection usable. A connection given to the
    constructor is used as it is, inside whatever transaction its owner opened.
    """

    def __init__(self, connection: Any):
        self._connection = connection

    @classmethod
    def connect(cls, url: Optional[str] = None) -> "Nexgen":
        """Connects to ``url``, or to ``NEXGEN_DB_URL`` when none is given. The URL is never stored."""
        import psycopg

        url = url or os.environ.get("NEXGEN_DB_URL")
        if not url:
            raise NexgenError("db_url_required", "give a connection string or set NEXGEN_DB_URL")
        return cls(psycopg.connect(url, autocommit=True))

    def close(self) -> None:
        self._connection.close()

    def __enter__(self) -> "Nexgen":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    # -- reading -----------------------------------------------------------

    def schema_version(self) -> str:
        """The version of the schema installed, as ``nexgen_schema_version()`` says it."""
        return self._one("select nexgen.nexgen_schema_version()")

    def organisations(self) -> List[Dict[str, Any]]:
        """The organisations the connection may read."""
        return self._rows("select id, name from nexgen.organisations order by name, id")

    def sites(self, organisation_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """The sites the connection may read, of one organisation when given."""
        return self._rows(
            """select id, organisation_id, name, country, region, time_zone, location_precision
                 from nexgen.sites
                where %(organisation)s::uuid is null or organisation_id = %(organisation)s::uuid
                order by name, id""",
            {"organisation": organisation_id},
        )

    def attributes_of(self, object_id: str, at: Optional[datetime] = None, scenario_id: Optional[str] = None) -> Dict[str, Any]:
        """Every attribute of an object holding at ``at`` (now by default), in a scenario (``None`` = reality)."""
        return self._one(
            "select nexgen.attributes_of(%s::uuid, coalesce(%s::timestamptz, now()), %s::uuid)",
            (object_id, at, scenario_id),
        )

    def resample(
        self,
        series_id: str,
        start: datetime,
        end: datetime,
        step: Step,
        time_zone: Optional[str] = None,
        issued_before: Optional[datetime] = None,
    ) -> List[Bucket]:
        """A series on a regular step over ``[start, end)``, combined the way its quantity says.

        A step of a day or more is cut in the site's time zone (or ``time_zone``);
        a forecast gives its latest issue, or the latest before ``issued_before``.
        """
        rows = self._rows(
            """select bucket, value, samples, expected, quality
                 from nexgen.resample(%s::uuid, %s::timestamptz, %s::timestamptz, %s::interval, %s, %s::timestamptz)""",
            (series_id, start, end, step, time_zone, issued_before),
        )
        return Rows(Bucket(r["bucket"], r["value"], r["samples"], r["expected"], r["quality"]) for r in rows)

    def window(self, series_id: str, start: datetime, end: datetime, limit: int = 100000) -> List[Reading]:
        """The stored values over ``[start, end)`` in time order: how a register's index is read."""
        rows = self._rows(
            "select at, value, quality from nexgen.window(%s::uuid, %s::timestamptz, %s::timestamptz, %s)",
            (series_id, start, end, limit),
        )
        return Rows(Reading(r["at"], r["value"], r["quality"]) for r in rows)

    def latest(self, series_ids: Iterable[str]) -> List[SeriesReading]:
        """The latest value that is not missing of each series."""
        rows = self._rows(
            "select series_id, at, value, quality from nexgen.latest(%s::uuid[])", ([str(i) for i in series_ids],)
        )
        return Rows(SeriesReading(str(r["series_id"]), r["at"], r["value"], r["quality"]) for r in rows)

    def fill(
        self,
        series_id: str,
        start: datetime,
        end: datetime,
        step: Step,
        method: str = "linear",
        time_zone: Optional[str] = None,
    ) -> List[Bucket]:
        """Every bucket of ``[start, end)``, empty ones filled on read (``none``, ``zero``, ``previous``, ``linear``)
        and flagged estimated (1), or missing (3) when they cannot be. Nothing is written."""
        rows = self._rows(
            """select bucket, value, samples, expected, quality
                 from nexgen.fill(%s::uuid, %s::timestamptz, %s::timestamptz, %s::interval, %s, %s)""",
            (series_id, start, end, step, method, time_zone),
        )
        return Rows(Bucket(r["bucket"], r["value"], r["samples"], r["expected"], r["quality"]) for r in rows)

    def coverage(self, series_id: str, start: datetime, end: datetime) -> List[Gap]:
        """The gaps of a regular series over ``[start, end)``."""
        rows = self._rows(
            "select gap_from, gap_to, missing from nexgen.coverage(%s::uuid, %s::timestamptz, %s::timestamptz)",
            (series_id, start, end),
        )
        return Rows(Gap(r["gap_from"], r["gap_to"], r["missing"]) for r in rows)

    def forecast_at(
        self,
        series_id: str,
        start: datetime,
        end: datetime,
        as_of: Optional[datetime] = None,
        horizon: Optional[Step] = None,
    ) -> List[ForecastValue]:
        """A forecast as known at ``as_of``, or issued ``horizon`` before each instant, or its latest issue."""
        rows = self._rows(
            """select at, value, issued_at
                 from nexgen.forecast_at(%s::uuid, %s::timestamptz, %s::timestamptz, %s::timestamptz, %s::interval)""",
            (series_id, start, end, as_of, horizon),
        )
        return Rows(ForecastValue(r["at"], r["value"], r["issued_at"]) for r in rows)

    def export_rows(self, series_ids: Iterable[str], start: datetime, end: datetime) -> List[SeriesReading]:
        """The values of several series over ``[start, end)``, sorted by series and time: the rows of a Parquet file."""
        rows = self._rows(
            "select series_id, at, value, quality from nexgen.export_rows(%s::uuid[], %s::timestamptz, %s::timestamptz)",
            ([str(i) for i in series_ids], start, end),
        )
        return Rows(SeriesReading(str(r["series_id"]), r["at"], r["value"], r["quality"]) for r in rows)

    def convert_unit(self, value: float, from_unit: str, to_unit: str) -> float:
        """A value converted between two units of the core's vocabulary, by code or symbol."""
        return self._one("select nexgen.convert_unit(%s, %s, %s)", (value, from_unit, to_unit))

    def site_of(self, kind: str, object_id: str) -> Optional[str]:
        """The site an object (its kind and its id) is on; ``None`` for an object that is not somewhere."""
        site = self._one("select nexgen.site_of(%s, %s::uuid)", (kind, object_id))
        return None if site is None else str(site)

    def country_of(self, kind: str, object_id: str) -> Optional[str]:
        """The country of the site an object (its kind and its id) is on (ISO 3166-1 alpha-2), None when it is on none."""
        return self._one("select nexgen.country_of(%s, %s::uuid)", (kind, object_id))

    # -- writing values ----------------------------------------------------

    def store(
        self,
        series: Union[str, Mapping[str, Any]],
        values: Iterable[Value],
        *,
        unit: Optional[str] = None,
        issued_at: Optional[datetime] = None,
    ) -> Stored:
        """Writes values through ``store()``, the one write path.

        ``series`` is a series id, or its identity as the keys of
        ``series_ensure()`` (``object_kind``, ``object_id``, ``quantity_code``, ``kind``,
        ``value_kind``, ``step``, ``source_code``, ``name``...), created once.
        ``values`` are ``(at, value)`` or ``(at, value, quality)`` tuples, or
        mappings with those keys, in ``unit`` (the quantity's when ``None``).
        A forecast needs ``issued_at``.
        """
        from psycopg.types.json import Jsonb

        ats: List[Any] = []
        numbers: List[Optional[float]] = []
        qualities: List[Optional[int]] = []
        for v in values:
            if isinstance(v, Mapping):
                ats.append(v["at"])
                numbers.append(v["value"])
                qualities.append(v.get("quality"))
            else:
                ats.append(v[0])
                numbers.append(v[1])
                qualities.append(v[2] if len(v) > 2 else None)
        identity = None if isinstance(series, str) else Jsonb(dict(series))
        row = self._rows(
            """select series_id, changed
                 from nexgen.store(%s::uuid, %s::timestamptz[], %s::float8[], %s::smallint[], %s, %s::timestamptz, %s::jsonb)""",
            (
                series if isinstance(series, str) else None,
                ats,
                numbers,
                qualities if any(q is not None for q in qualities) else None,
                unit,
                issued_at,
                identity,
            ),
        )[0]
        return Stored(str(row["series_id"]), row["changed"])

    # -- attaching ---------------------------------------------------------

    def attach(
        self,
        kind: str,
        object_id: str,
        property_code: str,
        value: Any,
        *,
        source: Optional[str] = None,
        source_code: Optional[str] = None,
        valid_from: Optional[datetime] = None,
        valid_to: Optional[datetime] = None,
        scenario_id: Optional[str] = None,
    ) -> str:
        """Attaches an attribute to an object (its kind and its id), over a period, with where it comes from; returns its id.

        ``value`` is a JSON value in the unit of the property's quantity.
        A value without a source is refused (``source_required``): nothing is
        attached that nobody can trace back.
        """
        from psycopg.types.json import Jsonb

        if not (source or source_code):
            raise NexgenError("source_required", "an attribute is attached with its source: give source or source_code")
        return str(
            self._one(
                """insert into nexgen.attributes
                          (object_kind, object_id, property_code, value, source, source_code, valid_from, valid_to, scenario_id)
                   values (%s, %s::uuid, %s, %s, %s, %s, %s::timestamptz, %s::timestamptz, %s::uuid)
                   returning id""",
                (kind, object_id, property_code, Jsonb(value), source, source_code, valid_from, valid_to, scenario_id),
            )
        )

    # -- the one way a statement runs --------------------------------------

    def _rows(self, sql: str, params: Any = None) -> List[Dict[str, Any]]:
        from psycopg import ClientCursor
        from psycopg.rows import dict_row

        try:
            # Bound on the client and sent as one simple query: no prepared
            # statement, so a pooler in transaction mode serves it as is.
            with ClientCursor(self._connection, row_factory=dict_row) as cursor:
                cursor.execute(sql, params)
                return cursor.fetchall()
        except NexgenError:
            raise
        except Exception as error:
            raise named(error) from error

    def _one(self, sql: str, params: Any = None) -> Any:
        rows = self._rows(sql, params)
        if not rows:
            return None
        return next(iter(rows[0].values()))
