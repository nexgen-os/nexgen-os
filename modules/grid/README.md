# `grid` — the grid side of a connection point

Status: shipped with schema 0.3. Schema: `grid`.

The connection point is the core's: `meters`, the identifier its operator
knows, carried by a participant, what it can do (take, inject, both) and
the period that identifier names it, with `declare_meter()` and
`close_meter()`; the devices of that participant are behind it
([docs/model.md](../../docs/model.md)).
This module starts from that meter and adds what the grid knows about it
(decision [0042](../../docs/decisions/0042-a-module-starts-from-an-object-of-the-core.md)):
who runs the grid, where it is fed from, how each point is connected to it,
and who may read the point's data at its operator's hub.

| Table / function | Holds / does |
|---|---|
| `grid.operators` | the distribution and transmission operators of a country, what they cover (its regions, and its municipalities when it serves part of a region only), where a third party reads meter data with the customer's consent, how its hub publishes meter data (`meter_data`: the time zone its files date their steps in, its quality flags mapped to the codes of `series_values.quality`, the sources that read it, how far back it serves, the steps of its load curves), the identifier scheme of the metering points they issue and the prefixes of those identifiers when the numbering says who issued them; a vocabulary written by the country packs |
| `grid.substations` | the substations of a grid: the operator that runs it and its code there, where it stands (WGS 84), the voltage levels it transforms between, the hosting capacity left and the capacity reserved, in MW, with the day and the source they were read from (a capacity without both is refused); a register written by packs and connectors, read by everyone signed in |
| `grid.meters` | one row per meter that has grid details, with the meter's id: the operator that runs it, the voltage level it is connected at (a code of the country's `voltage_levels`) and the substation it sits downstream of; its organisation is the meter's, copied; it goes with its meter. Subscribed power is an attribute of the meter |
| `grid.connect_to_operator()` | says which operator runs a meter, at which voltage level and downstream of which substation; a second call updates it; refuses `meter_not_found`, `grid_operator_unknown`, `substation_not_found`, `substation_of_other_operator` |
| `grid.substation_of()` / `grid.same_substation()` | the substation a participant sits downstream of, read on its meters (`substations_differ` when two say two); whether participants share one — `{same, substations, unknown}`, `same` null when one of them says none, never guessed |
| `grid.mandates` | the permission the customer of a meter gives an organisation to read it at its operator's data hub: the operator, the finest step (`granularity`, an ISO 8601 duration), the readings it covers (`data_from`, `data_to`), the period it may be used over (`valid_from`, `valid_to`), what may be read (`scope`: `load_curve`, `daily_index`, `energy_history`, `technical_data`) and what for (`purpose`: `study`, `sharing_operation`, `energy_management`, `billing`, `other`), the status (`draft`, `sent`, `approved`, `refused`, `expired`, `revoked`), the operator's reference and the signed copy, a `documents` row of the meter |
| `grid.request_mandate()` | asks for a mandate: the row, `sent`, the operator the one named or `grid.operator_of()` |
| `grid.decide_mandate()` | the customer's answer: approved with the signed copy and the operator's reference, or refused with its reason; refuses `mandate_not_found`, `mandate_already_decided`, `document_of_other_object` |
| `grid.revoke_mandate()` / `grid.expire_mandates(day)` | the customer withdraws an approved mandate (`mandate_not_approved` otherwise); the approved mandates whose validity ended by a day expire |
| `grid.authorise_reading(connector, meter, from, to, on, scope, granularity)` | the one mandate check, asked by every connector whose source reads under mandate (`sources.auth = 'mandate'`) before it reads a meter: the approved mandate its organisation holds on the meter, in force on the day, whose data period covers the readings, whose scope holds what is read (`load_curve` by default) and whose granularity is as fine as the step asked — its id; null for a source that reads without one. Refuses `mandate_missing` (none in force), `mandate_expired` (ended, expired or revoked), `mandate_scope` (in force, but not for that period, scope or step), `invalid_duration`. `authoriseReading()` of `@nexgen-os/core` is its twin outside the database, and `collectMeterReadings()` the one path from a connector to the series of a meter: it asks first, hands the connector the mandate and the hub's conventions, then stores |
| `grid.operator_of()` | which operator runs a meter, from the most precise level up ([0009](../../docs/decisions/0009-what-applies-follows-the-region.md)): the one named on the meter, the longest identifier prefix an operator of its country issues, an operator serving the municipality of its participant's place, the one distribution operator of its region or of a region above it — `{operator, by, prefix / municipality / region}`; refuses `meter_not_found`, `grid_operator_not_found` |

## The market a place trades in

What a country decides about its market is its pack's, resolved from the
place as every value is ([0049](../../docs/decisions/0049-the-market-follows-the-place-a-scheme-is-the-countrys-its-contract-the-devices.md)).

| Table / function | Holds / does |
|---|---|
| `grid.market_of(kind, id, at)` | for a meter, a participant or a project: `bidding_zone`, `control_area` (ENTSO-E EIC codes) and `imbalance_settlement_period` (an ISO 8601 duration) as `parameter_of()` resolves them from the pack — country, region or municipality when a country has several zones — each with its level, source and status, `{value: null, refusal}` where the place has none (a zone not interconnected); the `transmission_operator` of its country serving its region, with its EIC code (`grid.operators.eic_code`) |
| `grid.zone_series(organisation, zone, quantity, at)` | the series of an organisation of one quantity whose `bidding_zone` attribute names a zone: its day-ahead price (`energy_price`), its grid carbon intensity (`emission_factor`). A market series names its zone; nothing else ties it to a place |
| `grid.market_roles` | balance responsible party, balancing service provider, supplier, aggregator: the roles of the ENTSO-E harmonised role model a party holds |
| `grid.market_parties` | a role held by the organisation itself or by one of its contacts, with its EIC code, the bidding zone it holds it in and the period |

## Support schemes

| Table / function | Holds / does |
|---|---|
| `grid.support_scheme_kinds` | `feed_in_tariff` (a fixed price per MWh injected), `contract_for_difference` (a sliding premium: strike less market reference, the remuneration supplement of France), `green_certificates`, `net_metering`, each with the formula it pays. A tender is the `allocation` of a scheme, not a kind |
| `grid.support_schemes` | the schemes of a country as its pack publishes them (`grid.json`, `support_schemes`): kind, allocation (`open_window`, `tender`), the device types and power range eligible, the duration of a contract, the dated rules of the obligation to stop at negative prices with their power threshold (a threshold that lowers over time is one more dated rule), each with its legal source |
| `grid.support_contracts` | the contract of a producing device under a scheme of its country: reference, period (the scheme's duration when no end is given), tariff or strike in the currency of the country per MWh. The device is what is contracted, whatever its technology; refuses `support_scheme_of_other_country`, `support_not_eligible`, `overlapping_value` |
| `grid.support_of(device, day)` | the contract a device is under on a day, its scheme, kind and formula, and `negative_price_stop`: whether the rule holding that day obliges a device of its rated power to stop while the price is negative, with the threshold and its reference |
| `grid.injection_revenue(device, injection, from, to, price?)` | what injection earns under the contract, hour by hour: the kWh of each hour at the tariff (or the strike), nothing in an hour of negative price when the device must stop (read from the price series of its zone); with its provenance. Refuses `support_not_found`, `support_formula_not_priced` (certificates, net metering), `price_series_required` |

Reminders to a customer who has not answered, the forms of each hub and the
links it sends are the application's: the model keeps the mandate, its
status and its signed copy.

A country pack with `grid.json` operators lists `grid` in its modules; its
operators land in `grid.operators` only. Install: `npx nexgen-os init --modules grid`.
