# Contributing

Nexgen OS is released as minors before 1.0: the core schema is settled and
its names may still move ([docs/road-to-1.0.md](docs/road-to-1.0.md)). The
most useful contributions are reviews of the model ([docs/model.md](docs/model.md))
by people who describe places for a living: architects, BIM modellers,
engineers, surveyors, facility managers and public bodies.

- Open an issue that says where you are from and what you describe.
- Every change to the core comes with a test in `tests/`, a change to a module with one in `modules/<code>/tests/`; every dataset in
  `docs/demo/` keeps loading; every format library keeps its round trip.
- Everything is written in English. Vocabulary labels may carry translations.
- No country, currency or language is ever a default in the core.
- Names are the words the trades use, spelt the same on both sides of the
  Atlantic where possible (`floors`, `license`, `organisations`).

## How we name and shape things

- **Plain words.** The trades have excellent standards and difficult
  vocabularies. Every table, column and function takes a name anyone can
  understand, in the English of the trade, and the vocabulary row writes
  the standard term next to it.
- **One word per thing.** A thing has one name across the schema, the
  modules, the packages, the folders and the documents; a second name for
  the same thing is a bug, and a renaming is written down
  ([decisions/](docs/decisions/README.md)).
- **A small, concrete core.** The core names the objects the energy world
  already works with — organisation, project, participant, meter, device,
  series — and keeps each one once. A column is only for what every row
  has; everything else is attached, or lives in a module
  ([0019](docs/decisions/0019-a-column-only-for-what-every-row-has.md),
  [0041](docs/decisions/0041-a-module-names-one-thing.md)).
- **Keep it simple.** The simplest shape that holds wins. Start from the
  objects and the words of the products that have proven themselves in
  the field, and depart from them only for a reason written in a decision.
- **Reuse before adding.** Look for the object, function or vocabulary row
  that already does the job, and extend it rather than writing a variant.

## Sign-off

Contributions are accepted under the Developer Certificate of Origin
([DCO 1.1](https://developercertificate.org/)): by adding
`Signed-off-by: Your Name <you@example.org>` to each commit
(`git commit -s`), you certify that you wrote the change or have the right
to submit it under the project's licences. There is no contributor licence
agreement, and nothing in the sign-off lets anyone relicense the core: it is
AGPL-3.0, and the format libraries are MIT, for good.
