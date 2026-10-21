"""An example settlement engine: a fixed price times the volume a contract names.

Contract 1 (packages/connectors/README.md): the envelope arrives on stdin, the answer
leaves on stdout, stderr is a log. A refusal is `{"error": name, "detail":
text}` on stdout with exit code 1. Pure Python, no dependency: nothing here
reads a database, calls the network or writes a file.

Each contract names the series its volume is read from (a point of the
request and one of its quantities, kWh per step). At each step, the fixed
price that holds at the start of the step applies to the energy of the
step; consecutive steps under the same price make one line, with its
energy, its price and its amount, which the buyer pays the seller. A price
per MWh is divided by 1000 for energy in kWh. Amounts keep six decimals:
rounding to the minor unit of a currency is the invoice's.

This is the place to write your own settlement: replace `price_of()` to
read an index, a cap or a floor, or `volumes()` to match a point's energy
with its contracts in order of priority; keep the rest.
"""

import json
import platform
import sys
from datetime import datetime

from . import __version__

ENGINE = "settlement_example"
CONTRACT = 1
KINDS = ["settlement"]
PRICE_KINDS = ["fixed"]
VOLUME_BASES = ["pay_as_consumed", "pay_as_produced"]
UNITS = {"KiloW-HR": 1, "MegaW-HR": 1000}


class Refusal(Exception):
    """A refusal by name: `contracts_missing`, `price_missing`, `price_kind_unsupported`..."""

    def __init__(self, name, detail):
        super().__init__(f"{name}: {detail}")
        self.name = name
        self.detail = detail


def instant(text):
    """An ISO 8601 stamp with its offset; `Z` is read as UTC on every Python from 3.9."""
    try:
        at = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        raise Refusal("request_invalid", f"{text!r} is not an ISO 8601 instant")
    if at.tzinfo is None:
        raise Refusal("request_invalid", f"{text!r} has no offset")
    return at


def grid(points):
    """The stamps of the grid and, per point and quantity, its values on it."""
    stamps = None
    read = {}
    for p in points or []:
        values = {}
        for s in p.get("series", []):
            at = [v["at"] for v in s.get("values", [])]
            if stamps is None:
                stamps = at
            elif [instant(a) for a in at] != [instant(a) for a in stamps]:
                raise Refusal("series_misaligned", f"{s.get('quantity_code')} of point {p.get('id')} is not on the grid of the first series")
            values[s.get("quantity_code")] = [float(v["value"]) for v in s["values"]]
        read[p.get("id")] = values
    return stamps or [], read


def volumes(contracts, points):
    """Per contract, the values of the series it names; a series is settled by one contract only."""
    counted = {}
    out = {}
    for c in contracts:
        if c.get("volume_basis") not in VOLUME_BASES:
            raise Refusal("volume_basis_unsupported", f"{c.get('volume_basis')!r} of contract {c['id']}; this engine settles {', '.join(VOLUME_BASES)}")
        point = (c.get("volume") or {}).get("point")
        quantity = (c.get("volume") or {}).get("quantity_code")
        if point not in points:
            raise Refusal("point_unknown", f"contract {c['id']} reads point {point!r}, which the request does not hold")
        if quantity not in points[point]:
            raise Refusal("series_missing", f"point {point} has no {quantity} series")
        if (point, quantity) in counted:
            raise Refusal("volume_counted_twice", f"{quantity} of point {point} is read by contracts {counted[(point, quantity)]} and {c['id']}; matching a point's energy with several contracts is a cascade, which this engine does not do")
        counted[(point, quantity)] = c["id"]
        out[c["id"]] = points[point][quantity]
    return out


def price_of(contract, start, end):
    """The fixed signal that holds over the step [start, end): its index in the contract's signals."""
    holding = []
    for n, s in enumerate(contract.get("signals", [])):
        if s.get("kind") not in PRICE_KINDS:
            raise Refusal("price_kind_unsupported", f"{s.get('kind')!r} on contract {contract['id']}; this engine reads {', '.join(PRICE_KINDS)} prices")
        if s.get("per_unit") not in UNITS:
            raise Refusal("unit_unknown", f"{s.get('per_unit')!r} on contract {contract['id']}; prices are per {', '.join(UNITS)}")
        s_start = instant(s["starts_at"])
        s_end = instant(s["ends_at"]) if s.get("ends_at") else None
        if start < s_start < end or (s_end is not None and start < s_end < end):
            raise Refusal("signal_misaligned", f"a price of contract {contract['id']} starts or ends inside the step at {start.isoformat()}")
        if s_start <= start and (s_end is None or start < s_end):
            holding.append(n)
    if not holding:
        raise Refusal("price_missing", f"contract {contract['id']} has no price at {start.isoformat()}")
    if len(holding) > 1:
        raise Refusal("signals_overlap", f"contract {contract['id']} has {len(holding)} fixed prices at {start.isoformat()}")
    return holding[0]


def settlement(request):
    rules = request.get("rules") or {}
    if rules:
        raise Refusal("rule_unknown", f"{', '.join(sorted(rules))}; this engine applies no rule")
    contracts = request.get("contracts")
    if not isinstance(contracts, list) or not contracts:
        raise Refusal("contracts_missing", "the request has no contract")
    stamps, points = grid(request.get("points"))
    if not stamps:
        raise Refusal("series_missing", "the request has no series")
    by_contract = volumes(contracts, points)
    bounds = [instant(a) for a in stamps] + [instant(request.get("to"))]

    lines = []
    totals = []
    for c in contracts:
        currencies = sorted({s.get("currency") for s in c.get("signals", [])})
        if len(currencies) > 1:
            raise Refusal("currency_mixed", f"contract {c['id']} is priced in {', '.join(currencies)}; a contract settles in one currency")
        values = by_contract[c["id"]]
        mine = []
        for i in range(len(stamps)):
            n = price_of(c, bounds[i], bounds[i + 1])
            if mine and mine[-1]["signal"] == n:
                mine[-1]["energy"] += values[i]
                mine[-1]["to"] = i + 1
            else:
                mine.append({"signal": n, "from": i, "to": i + 1, "energy": values[i]})
        for m in mine:
            s = c["signals"][m["signal"]]
            amount = m["energy"] * float(s["price"]) / UNITS[s["per_unit"]]
            lines.append({
                "contract_id": c["id"], "seller": c.get("seller"), "buyer": c.get("buyer"),
                "from": stamps[m["from"]], "to": stamps[m["to"]] if m["to"] < len(stamps) else request.get("to"),
                "energy_kwh": round(m["energy"], 6), "price": float(s["price"]), "per_unit": s["per_unit"],
                "currency": s["currency"], "amount": round(amount, 6),
            })
        totals.append({
            "id": c["id"],
            "energy_kwh": round(sum(values), 6),
            "amount": round(sum(l["amount"] for l in lines if l["contract_id"] == c["id"]), 6),
            "currency": currencies[0] if currencies else None,
        })

    return {
        "lines": lines,
        "contracts": totals,
        "meta": {"volume": "each contract's own series, counted once", "price": "fixed", "rounding": "six decimals, no currency's minor unit", "rules": {}},
    }


def answer(request):
    if not isinstance(request, dict):
        raise Refusal("request_invalid", "the request is not a JSON object")
    if request.get("describe") is True:
        return {"dependencies": {"nexgen_settlement_example": __version__, "python": platform.python_version()}, "kinds": KINDS}
    if request.get("kind") == "settlement":
        return settlement(request)
    raise Refusal("kind_unknown", f"{request.get('kind')!r}; this engine accepts {', '.join(KINDS)}")


def main(stdin=None, stdout=None):
    stdin = stdin or sys.stdin
    stdout = stdout or sys.stdout
    try:
        try:
            envelope = json.load(stdin)
        except json.JSONDecodeError as e:
            raise Refusal("request_invalid", f"the envelope is not JSON: {e}")
        if not isinstance(envelope, dict) or envelope.get("engine") != ENGINE:
            raise Refusal("engine_contract_mismatch", f"this is {ENGINE}")
        if envelope.get("contract") != CONTRACT:
            raise Refusal("engine_contract_mismatch", f"this engine speaks contract {CONTRACT}, asked {envelope.get('contract')!r}")
        result = answer(envelope.get("request"))
        json.dump({"engine": ENGINE, "version": f"{ENGINE} {__version__}", "contract": CONTRACT, "result": result, "log": []}, stdout, allow_nan=False)
        return 0
    except Refusal as r:
        json.dump({"error": r.name, "detail": r.detail}, stdout)
        return 1
