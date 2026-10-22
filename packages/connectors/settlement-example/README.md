# `settlement_example` — a settlement engine to copy

An engine of the `settlement` kind ([`../README.md`](../README.md),
[`../../packages/core/src/connectors/settlement.ts`](../../core/src/connectors/settlement.ts)) in pure Python, without a
dependency: each contract is settled at its fixed price on the volume it
names. It is an example, meant to be copied and replaced by the
settlement a site or a community actually applies; `nexgen-os init` does
not install it.

Each contract names the series its volume is read from: a point of the
request (a meter, a participant) and one of its quantities
(`offtake_energy`, `injection_energy`, `production_energy`, the
`shared_offtake_energy` of a sharing…), kWh per step. At each step, the
fixed price that holds at the start of the step applies to its energy;
consecutive steps under one price make one line, with its energy, its
price, its amount and its parties. The buyer pays the seller. A price per
MWh is divided by 1000 for energy in kWh. Amounts keep six decimals:
rounding to the minor unit of a currency, taxes and the invoice are not
an engine's.

```bash
pip install -e packages/connectors/settlement-example
export NEXGEN_ENGINE_SETTLEMENT_EXAMPLE="python3 -m nexgen_settlement_example"
echo '{"engine":"settlement_example","contract":1,"request":{"describe":true}}' | $NEXGEN_ENGINE_SETTLEMENT_EXAMPLE
```

## Writing your own settlement

Copy the folder, rename the package and `ENGINE`, and replace in `run.py`
`price_of()` to read an indexed price from `request["indices"]`, a cap or
a floor, or `volumes()` to match the energy of a point with its contracts
in order of priority. The rules of a country or a project arrive as they
are (`request["rules"]`); say in `meta` what you applied, and refuse by
name what you do not know. This one reads `fixed` prices, the volume
bases `pay_as_consumed` and `pay_as_produced`, one contract per series,
and no rule.

Refusals: `contracts_missing`, `point_unknown`, `series_missing`,
`series_misaligned`, `volume_basis_unsupported`, `volume_counted_twice`,
`price_kind_unsupported`, `unit_unknown`, `price_missing`,
`signal_misaligned`, `signals_overlap`, `currency_mixed`, `rule_unknown`,
`kind_unknown`, `request_invalid`, `engine_contract_mismatch`.

## Licence

MIT ([`LICENSE`](LICENSE)).
