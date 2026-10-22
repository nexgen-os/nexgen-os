"""Rows, and the same rows as an Arrow table or a dataframe.

Every read of the client returns ``Rows``: a list of dataclasses, which
needs nothing beyond the client. ``to_arrow()``, ``to_pandas()`` and
``to_polars()`` give the same rows as columns, through the optional extras
``nexgen-os[arrow]``, ``nexgen-os[pandas]`` and ``nexgen-os[polars]``;
nothing is computed on the way, the columns are the fields of the rows.
"""

from __future__ import annotations

from dataclasses import fields, is_dataclass
from typing import Any, Dict, List

from .errors import NexgenError


def _require(module: str, extra: str) -> Any:
    try:
        return __import__(module)
    except ImportError as error:
        raise NexgenError("extra_required", f'{module} is not installed: pip install "nexgen-os[{extra}]"') from error


class Rows(list):
    """The rows of a read, as dataclasses; convertible to columns."""

    def columns(self) -> Dict[str, List[Any]]:
        """The rows as one list per field, in the order of the fields."""
        if not self:
            return {}
        first = self[0]
        names = [f.name for f in fields(first)] if is_dataclass(first) else list(first)
        return {name: [getattr(r, name) if is_dataclass(r) else r[name] for r in self] for name in names}

    def to_arrow(self) -> Any:
        """The rows as a ``pyarrow.Table`` (extra ``arrow``)."""
        pyarrow = _require("pyarrow", "arrow")
        return pyarrow.table(self.columns())

    def to_pandas(self) -> Any:
        """The rows as a ``pandas.DataFrame`` (extra ``pandas``); instants stay timezone-aware, in UTC."""
        pandas = _require("pandas", "pandas")
        return pandas.DataFrame(self.columns())

    def to_polars(self) -> Any:
        """The rows as a ``polars.DataFrame`` (extra ``polars``)."""
        polars = _require("polars", "polars")
        return polars.DataFrame(self.columns())
