# `contracts` — the contracts of a participant and their prices

Status: proposed for the next schema. Schema: `contracts`.

A participant is the node ([0043](../../docs/decisions/0043-the-participant-is-the-node.md)):
the energy it takes from the grid and the energy it injects are bought and
sold under contracts. This module keeps each contract as a row about its
participant, and the prices it sets as price signals over periods. It
computes no amount: who owes how much to whom over a month is a settlement,
computed by a program from the contracts in force and their prices
([0013](../../docs/decisions/0013-a-program-connector-reads-one-request.md),
[`settlement-example`](../../packages/connectors/settlement-example/README.md)),
and the invoice is the invoicing side's
([0010](../../docs/decisions/0010-the-participant-is-billed-ekwo-os-keeps-the-invoice.md)).
The support contract of a producing device under a scheme of its country
stays the grid's (`grid.support_contracts`,
[0049](../../docs/decisions/0049-the-market-follows-the-place-a-scheme-is-the-countrys-its-contract-the-devices.md)).

| Table | Holds |
|---|---|
| `contracts.kinds` | what a contract is — `supply`, `injection`, `ppa_physical`, `ppa_virtual`, `community_tariff`, `market` — with the flows it may price and whether the energy is delivered under it |
| `contracts.volume_modes` | how its energy is counted on an interval — `metered`, `pay_as_consumed`, `pay_as_produced`, `allocated_power` |
| `contracts.contracts` | a contract of a participant: its kind, the flow of its meter it prices from the participant's point of view (`offtake` or `injection`), the other party (a participant of the same project, or a contact of the organisation), the meter (null for all of the participant's), how its volume is counted and the power allocated to it, its `priority` in the cascade of its flow, its period (`valid_from`, `valid_to` the day after its last), the currency of its prices (that of the participant's country when none is named), its reference and its signed document |
| `contracts.price_signals` | a price a contract sets over an ISO 8601 period (`valid_from` and `duration`, none while it runs): its component, a priced quantity of the core (`energy_price` per MWh, `power_price` per kW and per year, `fixed_price` per month) in the contract's currency; `fixed` (`value`) or `indexed` on a price series of the core (`factor` × index + `value`, within `floor` and `cap`) |

| Function | Does |
|---|---|
| `contracts.in_force(participant, flow, on)` | the contracts of a participant that price a flow on a day, in the order of the cascade |
| `contracts.price_at(contract, component, at)` | the price a contract sets for a component at an instant, with its unit, its currency, the signal and the index read; null when no signal holds then |

A market price stays a series of the core — the day-ahead price of a
bidding zone is an `energy_price` series of the organisation that reads it
([model](../../docs/model.md#over-time)) — and an indexed signal points to
it; it never copies it.

**Named refusals.** A contract: `participant_not_found`, `flow_not_of_kind`,
`meter_of_other_participant`, `counterparty_is_participant`,
`counterparty_of_other_project`, `contact_of_other_organisation`,
`document_of_other_organisation`, `allocated_power_required`,
`allocated_power_not_counted`, `currency_required`, `currency_edited`. A
price signal: `contract_not_found`, `component_not_priced`,
`series_of_other_organisation`, `index_of_other_quantity`,
`currency_mismatch`, `overlapping_value`. A price: `index_value_missing`.

**Who sees a contract.** The members of its organisation, a person its
participant's project is shared with, and the account of its participant,
by their capabilities ([access](../../docs/access.md)).

```sql
-- A bakery buys the production of the school roof of its community at a
-- fixed price, and the rest from its supplier, indexed on the day-ahead price.
insert into contracts.contracts (organisation_id, participant_id, kind, flow, counterparty_participant_id, volume_mode, priority, valid_from)
values (:org, :bakery, 'ppa_physical', 'offtake', :school, 'pay_as_produced', 1, '2026-01-01')
returning id;  -- :ppa

insert into contracts.price_signals (organisation_id, contract_id, component, form, value, valid_from, duration)
values (:org, :ppa, 'energy_price', 'fixed', 95, '2026-01-01T00:00:00Z', 'P1Y');

insert into contracts.contracts (organisation_id, participant_id, kind, flow, counterparty_contact_id, priority, valid_from)
values (:org, :bakery, 'supply', 'offtake', :supplier, 10, '2026-01-01')
returning id;  -- :supply

insert into contracts.price_signals (organisation_id, contract_id, component, form, factor, value, floor, index_series_id, valid_from)
values (:org, :supply, 'energy_price', 'indexed', 1.1, 12, 0, :day_ahead, '2026-01-01T00:00:00Z');

select kind, priority from contracts.in_force(:bakery, 'offtake', '2026-06-01');
select contracts.price_at(:supply, 'energy_price', '2026-06-01T12:00:00Z');
```

Install: `npx nexgen-os init --modules contracts`.
