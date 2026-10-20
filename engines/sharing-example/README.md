# `sharing_example` — an energy_sharing engine to copy

An engine of the `energy_sharing` kind ([`../README.md`](../README.md),
[`sharing.ts`](../../packages/core/src/engines/sharing.ts)) in pure Python, without a
dependency: the energy the participants inject is shared among them in
proportion to their offtake. It is an example, meant to be copied and
replaced by the key a community actually applies; `nexgen-os init` does
not install it.

At each step, what the participants inject together is the pool and what
they take together is the demand; the energy shared is the smaller of the
two. Each participant receives its share in proportion to its offtake;
each one injecting gives its share in proportion to its injection; what is
left is offtake from its supplier and injection to the grid.

```bash
pip install -e engines/sharing-example
export NEXGEN_ENGINE_SHARING_EXAMPLE="python3 -m nexgen_sharing_example"
echo '{"engine":"sharing_example","contract":1,"request":{"describe":true}}' | $NEXGEN_ENGINE_SHARING_EXAMPLE
```

## Writing your own key

Copy the folder, rename the package and `ENGINE`, and replace `share()` in
`run.py`: one step in (offtake and injection per participant, kWh), what
each one received and gave out. The key's method and parameters arrive as
the project holds them (`request["key"]`), the rules of a country or a
project as they are (`request["rules"]`); say in `meta` what you applied,
and refuse by name what you do not know. This one knows the method
`proportional` and no rule.

Refusals: `participants_missing`, `series_missing`, `series_misaligned`,
`key_unknown`, `rule_unknown`, `kind_unknown`, `request_invalid`,
`engine_contract_mismatch`.

## Licence

MIT ([`LICENSE`](LICENSE)).
