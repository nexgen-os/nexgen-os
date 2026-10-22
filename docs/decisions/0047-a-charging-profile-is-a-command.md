# 0047 — A charging profile is a command

> Status: accepted

## Context

To steer an electric vehicle charger is to ask it to keep a charging
profile: in the Open Charge Point Protocol (OCPP), `SetChargingProfile`
carries limits by period, in watts or amperes, a purpose (the whole
station, the default of every transaction, one transaction, a limit from
outside), a stack level that says which profile wins, and the station
answers `Accepted` or `Rejected`, or does not answer. The `charging` module
could have kept these orders in a table of its own, with its own statuses.
The `actions` module already carries a real-time order asked of a device:
a command, with a value, an instant, a connector that carries it out, one
lifecycle, and its effect as a value of a series of kind `setpoint` of the
device ([0017](0017-an-action-is-something-to-do.md),
[0022](0022-the-instrument-is-a-device-the-point-is-the-series.md)).

## Decision

**A charging profile is an action of kind `command` on the charger.**
`charging.limit(device, schedule)` creates it through `actions.command()`,
proposed, on a setpoint series of the charger — power in kW, or current in
A when the profile limits in amperes, one series per EVSE — with the limit
of its first period as its value. The schedule itself (periods, purpose,
stack level, kind, recurrency, validity, transaction) is a row of
`charging.profiles`, which names the action by its id and holds no
foreign key to the `actions` module.

**One lifecycle.** A person, or an agent the person allowed, validates the
command; the central system sends it; `charging.report(action, at,
failure)` records the answer. Accepted, the command is done
(`actions.report()`) and every period of the schedule still to come is
stored in the setpoint series at its start — the one running at the
instant of the answer, from that instant: that series is the effect.
Rejected, not supported, an error, or no answer in time, the command
failed and says why.

**The protocol stays in its library.** `@nexgen-os/ocpp` (MIT) writes a
schedule as the `SetChargingProfile` of 1.6 or 2.0.1 and reads the answer
into a failure or none; the module never speaks OCPP, and the central
system that holds the WebSocket of each station is an operated service,
outside the repository.

## Consequences

- A planner of charging, a controller of a site or an agent proposes
  limits the same way it proposes any command; what a person sees of a
  site — steps, recommendations, commands — is one list.
- The limit asked and the limit kept are two things: the profile says what
  was asked, the setpoint series what the station accepted, and the meter
  values of the charger what it drew.
- A composite schedule (several profiles stacked) is the station's to
  compute; the module keeps each profile and its answer, and does not
  merge them.
- The `charging` module requires `actions`; installed alone, its sessions
  and sizings work and `charging.limit()` refuses `module_required`.
