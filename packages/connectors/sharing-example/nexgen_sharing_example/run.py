"""An example energy_sharing engine: the energy injected is shared in proportion to offtake.

Contract 1 (engines/README.md): the envelope arrives on stdin, the answer
leaves on stdout, stderr is a log. A refusal is `{"error": name, "detail":
text}` on stdout with exit code 1. Pure Python, no dependency: nothing here
reads a database, calls the network or writes a file.

At each step, what the participants inject together is the pool and what
they take together is the demand; the energy shared is the smaller of the
two. Each participant receives its share of it in proportion to its
offtake, and each one injecting gives its share in proportion to its
injection. What is left is offtake from its supplier and injection to the
grid. Every value is kWh over the step that starts at its stamp.

This is the place to write your own key: replace `share()`, keep the rest.
"""

import json
import platform
import sys

from . import __version__

ENGINE = "sharing_example"
CONTRACT = 1
KINDS = ["energy_sharing"]
METHODS = ["proportional"]
INPUTS = ("offtake_energy", "injection_energy")


class Refusal(Exception):
    """A refusal by name: `participants_missing`, `series_misaligned`, `key_unknown`..."""

    def __init__(self, name, detail):
        super().__init__(f"{name}: {detail}")
        self.name = name
        self.detail = detail


def share(offtake, injection):
    """One step: lists of kWh per participant in, (received, given) per participant out."""
    demand = sum(offtake)
    pool = sum(injection)
    shared = min(demand, pool)
    received = [shared * o / demand if demand > 0 else 0.0 for o in offtake]
    given = [shared * i / pool if pool > 0 else 0.0 for i in injection]
    return received, given


def read(participants):
    """The stamps of the grid and, per participant, its offtake and injection values on it."""
    if not isinstance(participants, list) or not participants:
        raise Refusal("participants_missing", "the request has no participant")
    stamps = None
    read = []
    for p in participants:
        by_quantity = {s.get("quantity_code"): s for s in p.get("series", [])}
        values = {}
        for q in INPUTS:
            if q not in by_quantity:
                raise Refusal("series_missing", f"participant {p.get('id')} has no {q} series")
            points = by_quantity[q].get("values", [])
            at = [v["at"] for v in points]
            if stamps is None:
                stamps = at
            elif at != stamps:
                raise Refusal("series_misaligned", f"{q} of participant {p.get('id')} is not on the grid of the first series")
            values[q] = [float(v["value"]) for v in points]
        read.append((p["id"], values))
    return stamps, read


def energy_sharing(request):
    key = request.get("key") or {}
    if key.get("method") not in METHODS:
        raise Refusal("key_unknown", f"{key.get('method')!r}; this engine shares by {', '.join(METHODS)}")
    rules = request.get("rules") or {}
    if rules:
        raise Refusal("rule_unknown", f"{', '.join(sorted(rules))}; this engine applies no rule")
    stamps, participants = read(request.get("participants"))
    step = request.get("step")
    out = {pid: {"shared_offtake_energy": [], "shared_injection_energy": [], "offtake_energy": [], "injection_energy": []} for pid, _ in participants}
    shared_total = 0.0
    for i in range(len(stamps)):
        offtake = [v["offtake_energy"][i] for _, v in participants]
        injection = [v["injection_energy"][i] for _, v in participants]
        received, given = share(offtake, injection)
        shared_total += sum(received)
        for n, (pid, _) in enumerate(participants):
            out[pid]["shared_offtake_energy"].append(received[n])
            out[pid]["shared_injection_energy"].append(given[n])
            out[pid]["offtake_energy"].append(offtake[n] - received[n])
            out[pid]["injection_energy"].append(injection[n] - given[n])

    def series(q, values):
        return {"quantity_code": q, "value_kind": "interval", "step": step, "unit": "kWh",
                "values": [{"at": a, "value": round(v, 6)} for a, v in zip(stamps, values)]}

    return {
        "participants": [
            {"id": pid, "series": [series(q, v) for q, v in out[pid].items()],
             "totals": {q: round(sum(v), 6) for q, v in out[pid].items()}}
            for pid, _ in participants
        ],
        "totals": {"shared_energy": round(shared_total, 6), "steps": len(stamps)},
        "meta": {"key": {"method": key["method"], "basis": "offtake"}, "rules": {}},
    }


def answer(request):
    if not isinstance(request, dict):
        raise Refusal("request_invalid", "the request is not a JSON object")
    if request.get("describe") is True:
        return {"dependencies": {"nexgen_sharing_example": __version__, "python": platform.python_version()}, "kinds": KINDS}
    if request.get("kind") == "energy_sharing":
        return energy_sharing(request)
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
