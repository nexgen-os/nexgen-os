# `@nexgen-os/ores`

[ORES](https://www.ores.be), the main distribution operator of Wallonia, as
a meter data connector of Nexgen OS, on its **API for energy service
providers** (third-party data access,
`https://edap.ores.be/b2b/tpda/v1/api/external/v1`;
[guide](https://media.ores.be/ores-cms/i0ghhud2/utilisation-des-api-tpda-ores-2026.pdf)).
An energy service provider signs a data access contract with the operator
(a standard contract approved by the regulator; `tpda@ores.be`); the
customer then consents in their own My ORES space, and the operator opens
the quarter-hour energy of the meter, with up to three years of history.
The data arrives the day after it is measured: this is the reference curve
of a meter, not a live feed. MIT.

## The path of a load curve

1. **Consent.** `consentLink({ referenceNumber, flow, dataPeriodFrom })`
   (`POST /shortUrlIdentifier`) gives the page of My ORES the customer
   follows (`https://www.myores.be/tpda/<id>`), valid five days. One
   reference serves one customer, who may share up to `numberOfEans`
   metering points under it and may shorten the period asked. The
   installation records a mandate on each meter (`grid.request_mandate()`)
   with the `referenceNumber` as its `external_reference`.
2. **Follow it.** `mandates(referenceNumber, ean?)` (`GET /mandates`) lists
   the mandates given under the reference, one per metering point,
   direction and granularity; `oresMandateStatus()` says what the
   operator's statuses mean for the mandate of the `grid` module:
   `Approved` → `approved` (`grid.decide_mandate()`), `Rejected` →
   `refused`, `Finished` → `expired`, and a renewal the customer let pass
   (`renewalStatus` `Expired`) → `expired`. A mandate is renewed every
   three years; the operator writes to the customer a month before. Only
   the customer ends a mandate.
3. **Read.** `collectMeterReadings(db, ores({ … }), { connectorId, meterId,
   from, to, step: 'PT15M' })` of `@nexgen-os/core` asks the one mandate
   check (`grid.authorise_reading()`) first, then calls `readings()`,
   which:
   - refuses without the mandate the check returned (`mandate_missing`) or
     without its reference (`mandate_reference_missing`), a step other than
     the quarter hour (`step_unsupported`), an EAN that is not 18 digits
     (`invalid_identifier`), and a hub without its zone
     (`time_zone_required`);
   - asks `GET /mandates/energy` by reference and EAN for the days `from`
     to `to` (`to` excluded), each day from midnight in the hub's zone, by
     the date of the reading (`periodType=readTime`), seven days per call
     (`ORES_DAYS_PER_CALL`, the operator's limit): a year is 53 calls;
   - returns the meter's `offtake_energy` and `injection_energy`, kWh per
     quarter hour, each value dated at the start of its step in UTC, with
     the quality the pack maps the value's `validationState` to.

| From the answer | Series of the meter |
|---|---|
| `quarterHourlyEnergy[].measurements[0].offtake.total` | `offtake_energy`, kWh, 15 minutes |
| `quarterHourlyEnergy[].measurements[0].injection.total` | `injection_energy`, kWh, 15 minutes |

The quarter hours sit under the physical meters of a digital meter and on
the metering point itself for a meter read remotely (AMR); both are read.
The answers have the shape of the API the Flemish operator runs, so one
reader serves both connectors: `energySeries()` of
[`@nexgen-os/fluvius`](../fluvius/README.md).

The hub's conventions are the be pack's row of the operator
(`grid.operators.meter_data` of `ores`): its zone, its step, its three
years of history and its quality table — `READ` and `VAL` a measured value,
`EST` an estimated one, `NVAL` a value not validated yet, kept under the
pack's own code. A state the table does not hold is refused by name
(`quality_unknown`) rather than guessed.

## Configuration

An organisation's `connectors` row names the source
`ores_service_provider_api` (the be pack's), its secrets by `secret_ref`
(the vault holds them; the caller resolves them and passes them as
`credentials`, the connector reads no environment), and in `config`:

| Key | What |
|---|---|
| `contract_number` | the service provider's data access contract number, which every consent link names |
| `return_url_success`, `return_url_failed` | where My ORES sends the customer back, on a domain the operator validated at the contract; a domain may not carry the operator's name |

```ts
const client = ores({
  credentials: { subscriptionKey, certificate, privateKey }, // from the vault
  contractNumber: config.contract_number,
  returnUrlSuccess: config.return_url_success, returnUrlFailed: config.return_url_failed,
});
```

Every call carries the gateway's subscription key
(`Ocp-Apim-Subscription-Key`). The operator asks the service provider for a
certificate of a recognised authority (DV, OV, EV or S/MIME, RSA 256 or
512, valid 398 days at most, allowing client authentication; never
self-signed) and registers it before the integration starts: given with its
key, it is presented on the connection (`certificateFetch()`). The operator
sends no reminder before a certificate lapses; renewing it in time is the
service provider's.

## What is not done yet

- The answers in `tests/fixtures` follow the shapes of the operator's
  guide, with made-up identifiers and values, and the guide does not say
  how the registered certificate is presented beyond its requirements:
  record real answers at the onboarding, keep them beside these, and settle
  the transport on what the operator confirms; the tests must pass
  unchanged.
- Daily energy (`DAILY`, with its day and night registers), gas, the
  reactive energy of a meter read remotely, and the reading by insertion
  time (`periodType=insertTime`, the sliding window the guide advises once
  the history is in) are not read yet.

## Licence

MIT ([`LICENSE`](LICENSE)).
