"""A client of a Nexgen OS installation, over its Postgres connection.

It reads the model the one way the model is read (``attributes_of``,
``resample``, ``site_of``, ``country_of``) and attaches an attribute with its
period and its source. It computes nothing: a figure is a run of a module.
It sees and changes what its connection's role may, under row level
security; it has no rights of its own.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Union

from .errors import NexgenError, named

Step = Union[str, timedelta]


@dataclass(frozen=True)
class Bucket:
    """One step of a resampled series: its start, its value in the quantity's unit, and how many readings made it."""

    start: datetime
    value: Optional[float]
    samples: int


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
            """select bucket, value, samples
                 from nexgen.resample(%s::uuid, %s::timestamptz, %s::timestamptz, %s::interval, %s, %s::timestamptz)""",
            (series_id, start, end, step, time_zone, issued_before),
        )
        return [Bucket(r["bucket"], r["value"], r["samples"]) for r in rows]

    def site_of(self, object_id: str) -> Optional[str]:
        """The site an object is on, whatever its kind; ``None`` for an object that is not somewhere."""
        site = self._one("select nexgen.site_of(%s::uuid)", (object_id,))
        return None if site is None else str(site)

    def country_of(self, object_id: str) -> Optional[str]:
        """The country of the site an object is on (ISO 3166-1 alpha-2), None when it is on none."""
        return self._one("select nexgen.country_of(%s::uuid)", (object_id,))

    # -- attaching ---------------------------------------------------------

    def attach(
        self,
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
        """Attaches an attribute to an object, over a period, with where it comes from; returns its id.

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
                          (object_id, property_code, value, source, source_code, valid_from, valid_to, scenario_id)
                   values (%s::uuid, %s, %s, %s, %s, %s::timestamptz, %s::timestamptz, %s::uuid)
                   returning id""",
                (object_id, property_code, Jsonb(value), source, source_code, valid_from, valid_to, scenario_id),
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
