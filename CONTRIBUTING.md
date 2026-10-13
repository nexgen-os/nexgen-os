# Contributing

Nexgen OS is preparing its 0.1: the core schema is settled and its names may
still move. The most useful
contributions right now are reviews of the model ([docs/model.md](docs/model.md))
by people who describe places for a living: architects, BIM modellers,
engineers, surveyors, facility managers and public bodies.

- Open an issue that says where you are from and what you describe.
- Every change to the core comes with a test in `tests/`; every example in
  `examples/` keeps loading; every format library keeps its round trip.
- Everything is written in English. Vocabulary labels may carry translations.
- No country, currency or language is ever a default in the core.
- Names are the words the trades use, spelt the same on both sides of the
  Atlantic where possible (`floors`, `license`, `organisations` as the
  product already says).

## Sign-off

Contributions are accepted under the Developer Certificate of Origin
([DCO 1.1](https://developercertificate.org/)): by adding
`Signed-off-by: Your Name <you@example.org>` to each commit
(`git commit -s`), you certify that you wrote the change or have the right
to submit it under the project's licences. There is no contributor licence
agreement, and nothing in the sign-off lets anyone relicense the core: it is
AGPL-3.0, and the format libraries are MIT, for good.
