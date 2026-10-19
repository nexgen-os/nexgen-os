"""The refusals of Nexgen OS, by their name.

Every refusal of the database starts with a name (``series_not_found``,
``time_zone_required``, ``invalid_value``...); the name says what to fix.
``NexgenError`` carries it as ``code``, with the database's message and its
SQLSTATE, so that a caller branches on the name and never on the wording.
"""

from __future__ import annotations

import re
from typing import Optional

_NAMED = re.compile(r"^([a-z][a-z0-9_]*)(?::|$)")


class NexgenError(Exception):
    """A refusal, named: ``code`` is the name the database (or the client) gave it."""

    def __init__(self, code: str, message: str, sqlstate: Optional[str] = None):
        super().__init__(f"{code}: {message}" if message and not message.startswith(code) else message or code)
        self.code = code
        self.message = message
        self.sqlstate = sqlstate


def named(error: Exception) -> Exception:
    """The ``NexgenError`` of a database error whose message starts with a name; any other error as it is."""
    diag = getattr(error, "diag", None)
    message = getattr(diag, "message_primary", None) or str(error).strip()
    match = _NAMED.match(message)
    if not match:
        return error
    return NexgenError(match.group(1), message, getattr(error, "sqlstate", None))
