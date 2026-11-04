# `@nexgen-os/fluvius`

[Fluvius](https://www.fluvius.be), the distribution operator of Flanders,
as a meter data connector of Nexgen OS, on its **API for service providers**
(dienstverleners), version 3 (`https://apihub.fluvius.be/esco-live/v3/api`,
the sandbox at `esco-sbx`;
[guide](https://partner.fluvius.be/sites/fluvius/files/2024-03/ontsluiten-van-verbruiksdata-via-api-v2-met-addendum-maart2024.pdf)).
A service provider signs a data access contract with the operator; the
customer then gives it their consent on the operator's own page, and the
operator opens the quarter-hour energy of the meter. MIT.

## The path of a load curve

1. **Consent.** `consentLink({ referenceNumber, flow, dataPeriodFrom,
   dataPeriodTo })` (`POST /shortUrlIdentifier`) gives the page where the
   customer signs (`https://mijn.fluvius.be/verbruik/dienstverlener?id=…`)
   and until when it can be signed. The installation records a mandate on
   the meter (`grid.request_mandate()`) with the `referenceNumber` as its
   `external_reference`.
2. **Follow it.** `mandates()` (`GET /mandate`) lists the mandates of the
   service provider; `mandateStatusOf()` says what the operator's status
   means for the mandate of the `grid` module: `Approved` → `approved`
   (`grid.decide_mandate()`), `Rejected` → `refused`, `Finished` →
   `expired`, `Requested` → nothing yet.
3. **Read.** `collectMeterReadings(db, fluvius({ … }), { connectorId,
   meterId, from, to, step: 'PT15M' })` of `@nexgen-os/core` asks the one
   mandate check (`grid.authorise_reading()`) first, then calls
   `readings()`, which:
   - refuses without the mandate the check returned (`mandate_missing`), a
     step other than the quarter hour (`step_unsupported`), an EAN that is
     not 18 digits (`invalid_identifier`), and a hub without its zone
     (`time_zone_required`);
   - asks `GET /mandate/energy` by EAN for the days `from` to `to` (`to`
     excluded), each day from midnight in the hub's zone, to the second;
   - returns the meter's `offtake_energy` and `injection_energy`, kWh per
     quarter hour, each value dated at the start of its step in UTC (a
     stamp without an offset is read in the hub's zone), with the quality
     the pack maps the value's `validationState` to.

| From the answer | Series of the meter |
|---|---|
| `quarterHourlyEnergy[].measurements[0].offtake.total` | `offtake_energy`, kWh, 15 minutes |
| `quarterHourlyEnergy[].measurements[0].injection.total` | `injection_energy`, kWh, 15 minutes |

The hub's conventions are the be pack's row of the operator
(`grid.operators.meter_data` of `fluvius`): its zone, its steps and its
quality table. The table holds `READ`, the state of a value read on the
meter; a state it does not hold is refused by name (`quality_unknown`)
rather than guessed: add it to the pack when it is met.

## Configuration

An organisation's `connectors` row names the source
`fluvius_service_provider_api` (the be pack's), its secrets by `secret_ref`
(the vault holds them; the caller resolves them and passes them as
`credentials`, the connector reads no environment), and in `config`:

| Key | What |
|---|---|
| `environment` | `live` (by default: the certificate) or `sandbox` (the client secret) |
| `tenant_id`, `scope` | the operator's tenant and the scope of its API, as its onboarding document gives them |
| `contract_number` | the service provider's data access contract number, which every consent link names |

```ts
const client = fluvius({
  credentials: { clientId, subscriptionKey, certificate, privateKey }, // from the vault
  tenantId: config.tenant_id, scope: config.scope, contractNumber: config.contract_number,
});
```

In live, the token is asked with a client assertion: a JWT signed RS256 by
the key of the certificate the operator registered, its SHA-1 thumbprint in
`x5t`, valid ten minutes (`clientAssertion()`). The key may be PKCS#1 or
PKCS#8. A token is kept until a minute before it lapses.

## What is not done yet

- The answers in `tests/fixtures` follow the shape the live API answers,
  with made-up identifiers and values: record real ones in the sandbox and
  keep them beside these; the tests must pass unchanged.
- Daily and monthly energy (`VH_dag`, `VH_maand`), gas, and the reading by
  insertion time (`periodType=insertTime`) are not read yet.

## Licence

MIT ([`LICENSE`](LICENSE)).
