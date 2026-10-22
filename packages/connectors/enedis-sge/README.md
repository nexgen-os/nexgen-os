# `@nexgen-os/enedis-sge`

The web services Enedis opens to a third party under contract with it (SGE, its
exchange management system), as a meter data connector of Nexgen OS,
for an installation whose organisation holds its own contract with the
operator. Source `enedis_sge`, the fr pack's. MIT.

**A skeleton until homologation.** The requests, the readers of the answers,
the refusals and the mapping to series run now, offline, on an injected
transport. What only the contract and the homologation settle is listed
[below](#after-homologation).

## What it speaks

| Method | Web service | Notes |
|---|---|---|
| `searchPoint()` | `RecherchePoint` v2.0 | a point by its holder and address, outside the third party's perimeter (`rechercheHorsPerimetre`) |
| `technicalData()` | `ConsultationDonneesTechniquesContractuelles` v1.0 | segment, state, subscribed power, grid tariff; under mandate (`technical_data`) |
| `detailedMeasures()`, `readings()` | `ConsultationMesuresDetaillees` v2.0 | the load curve (`COURBE`, `PA`), offtake and injection, in windows of 7 days; under mandate (`load_curve`), the customer's agreement declared (`accordClient`) |
| `orderCollection()` | `CommandeCollectePublicationMesures` v3.0 | turns the collection of a load curve on and subscribes its publication; refuses without the mandate and without the holder it declares (`declarationAccordClient`) |

Names, paths and namespaces follow the public homologation samples of
[consometers/sge-tiers](https://github.com/consometers/sge-tiers) (EUPL-1.2;
cited, not copied: the answers in `tests/answers.ts` take their shape and
invent their content). Where they differ from earlier assumptions, the
samples are followed: the path is `/RecherchePoint/v2.0`; detailed measures
are v2.0 and their points are `<mesure>` elements (`<points>` is read too);
authentication is a client certificate **and** HTTP Basic.

## Time: the web services' convention

**A web service answer dates a step at its END, with an offset**: the first
half hour of a winter day is `d = 2026-01-15T00:30:00+01:00`. The connector
subtracts the step (`p`) and gives every point at the start of its step in
UTC. A stamp without an offset is refused (`date_offset_required`): that is
the convention of the R63 **file** (start of the step, legal time, no
offset), which [`@nexgen-os/enedis-r6x`](../../formats/enedis-r6x/README.md)
reads. The two are never shared.

## Under mandate

The third party collects, keeps and proves the customer's authorisation
itself (the operator checks it). `collectMeterReadings()` of
`@nexgen-os/core` asks the one check (`grid.authorise_reading()`) and hands
the connector the mandate it returned; `readings()`, `technicalData()` and
`orderCollection()` refuse without it (`mandate_missing`, `mandate_scope`).
Quality letters are mapped by the hub's table of the pack
(`grid.operators.meter_data.quality_codes`), a missing step kept missing.

## Configuration

An organisation's `connectors` row names the source `enedis_sge`; `config`
holds `base_url` (no default: homologation and production are two worlds)
and `contract_id` (not a secret); `secret_ref` names one bundle in the vault
holding the login, the password, the certificate and its key. The caller
resolves it and builds the transport:

```ts
const sge = enedisSge({ baseUrl: config.base_url, login: secret.login, transport: mutualTlsTransport(secret) });
```

`mutualTlsTransport()` is HTTPS from Node with the client certificate and
HTTP Basic; a runtime that cannot present a client certificate needs a
proxy that can.

## Refusals

`connector_config_required`, `secret_not_found`, `mandate_missing`,
`mandate_scope`, `mandate_holder_required`, `date_offset_required`,
`quality_unknown`, `source_unavailable`, and `source_refused: enedis_sge
<code>` with the gateway's own code (`SGT4L8`, the period beyond the history
allowed) or the HTTP status.

## After homologation

What the contract with the operator and the homologation campaign settle,
in `src/services.ts` and `src/answers.ts` only:

- the production endpoint, and the homologation one confirmed;
- the versions in force (detailed measures v2.0 or v3, and whether v3 reads
  `points`), the exact element names and their order;
- the `SGT*` error codes and what each one means for a retry;
- the call limits: the days per call of detailed measures (7 here), the
  calls per second, the history allowed;
- the asynchronous history order (`CommandeTransmissionHistoriqueMesures`,
  object `HDM`) and the channel its files and the recurring publications
  (R63, R64, R50, R151, R4Q, R171) arrive by, with their decryption;
- reactive power (`PRI`, `PRC`) and voltage through detailed measures;
- the renewal of the client certificate;
- an hour-by-hour comparison with another source on a few points before any
  installation relies on it.

## Licence

MIT.
