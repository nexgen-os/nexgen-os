# `@nexgen-os/energy-bill` — the energy of a bill, read once

An energy bill is an invoice first. A generic invoice reader reads it once
into the EN 16931 shape `ReceivedInvoice` of
[`@ekwo-ai/factur-x`](https://www.npmjs.com/package/@ekwo-ai/factur-x)
(MIT); this library adds the energy that reader cannot know, and returns
one typed reading. MIT; no database, no network, no model call
([0050](../../../docs/decisions/0050-an-energy-bill-is-read-once-a-generic-invoice-then-its-energy.md)).

The type is that package's, pinned at `0.16.0`: the published version
that exports `ReceivedInvoice`.

## What the generic reader gives

From a Factur-X or UBL file (`@ekwo-ai/factur-x`, `@ekwo-ai/peppol-ubl`),
or from a PDF read by a model asked for that one schema:

- the seller and the buyer, with their VAT and legal identifiers;
- the lines: quantity, UN/ECE unit code (`KWH`, `MWH`, `MON`…), net price
  and its base quantity, net amount, VAT category and rate, the period of
  the line;
- the invoicing period, the VAT breakdown, the totals; the currency (BT-5).

## What the energy layer adds

One declared shape, `EnergyFields`, beside the invoice:

| Field | What it says |
|---|---|
| `meter` | the connection point: identifier, scheme (an `identifier_schemes` code), resource, the grid operator the bill names |
| `bands`, `seasons` | the time-of-use bands and seasons the bill prints, by the codes the country's pack gives them, with their hours |
| `lines` | for a line of the invoice, by its id (BT-126): its role (`energy`, `network`, `tax`, `contribution`, `subscription`, `other`), its band and season, a network line's kind (`fixed`, `variable`), a contribution's base and rate |
| `stated` | network amounts the bill states as information, outside its total |
| `consumption` | energy per band and period stated beside the lines (index readings) |
| `energyTotal` | the subtotal of the energy section, what confirms the lines |
| `contract` | the contract type (`fixed`, `variable`, `indexed`) and the printed words it was read on |
| `power` | the subscribed power with its UN/ECE unit (`KWT`, `KVA`) |

```ts
import { readEnergyBill } from '@nexgen-os/energy-bill';

const reading = readEnergyBill({ invoice, energy });
// reading.period, reading.energy.kwh, reading.energy.bands,
// reading.prices: [{ band, season, billed, latest }], reading.projection,
// reading.network, reading.taxes, reading.contributions, reading.totals,
// reading.remarks: [{ code, kind: 'warning' | 'note', message }]
```

## The rules

- The consumption period is the union of the dates of the consumption
  lines (their last day included), never the invoicing period, which only
  serves when no line is dated.
- Lines of one band on consecutive sub-periods are a price revision: one
  price, weighted by their kWh. Lines that bill the same kWh are components
  of the price (energy, capacity, certificates): their prices add up, their
  kWh count once. A line that bills every hour next to banded lines is
  added to every band when it bills their kWh.
- A revised price leaves two figures, `billed` and `latest`; a `fixed`
  contract, printed as such, projects the latest, any other the billed.
- A season is a grid of its own only when it names every band.
- A negative line takes back an earlier bill: no price, volume or period
  of this one.
- Network delivery is billed apart when lines of the total bill it,
  included in the energy price when it is only stated.
- Units: energy in `WHR`, `KWH`, `MWH`, `GWH` becomes kWh; a price per MWh a
  price per kWh. Amounts stay in the invoice's currency.
- What does not add up is said, never corrected by arithmetic it cannot
  prove: `price_misread` (a line's price put right only when the energy
  subtotal confirms its amount and its kWh), `line_disagrees`,
  `energy_stated_differs`, `lines_disagree_with_total`, `totals_disagree`,
  `network_kind_unknown`, `all_hours_undecided`, `components_disagree`,
  `price_without_volumes`; notes: `correction_set_aside`,
  `season_grid_incomplete`, `contract_without_evidence`,
  `energy_from_statement`, `credit_note`. Refusals: `line_unknown`,
  `meter_scheme_required`.

## How a product chains them

One model call and one schema: the model reads the PDF into
`ReceivedInvoice` with, beside it, `EnergyFields` — the line ids it already
wrote, their role, band and season, the meter, the contract words. Then:

```ts
const reading = readEnergyBill({ invoice, energy });
const { documentId, meterId } = await importEnergyBill(db, { participantId, reading, file }); // @nexgen-os/core
await db.query('select grid.connect_to_operator($1, $2)', [meterId, reading.meter.operator]); // when it names one
await estimateFromBill(db, { participantId, reading, profileCode, documentId });         // modules/consumption
await db.query(`select billing.record_invoice($1, $2, 'purchase', $3, $4)`, [participantId, ekwoInvoiceId, from, to]);
```

`importEnergyBill()` attaches the bill with its checksum (`already_imported`
the second time), finds or declares its meter, and writes the contract as
published attributes of the participant whose source is the document:
`supply_tariff`, `supply_energy_price` (per MWh), `grid_fees_and_taxes`,
`supply_contract_type`, and the meter's `subscribed_power` or
`subscribed_apparent_power`. A bill in another currency than its
participant's country is refused (`currency_mismatch`) before anything is
written.

## Ported from

The rules and their tests come from the bill reader of a platform built on
Nexgen OS, made generic: no country, no band name, no tax name, no
currency. Its fixtures, anonymised, are in `tests/fixtures/bills.ts`, with
a day / night bill and a bill in another currency priced per MWh.
