## What changes

<!-- One paragraph: what a user of Nexgen OS sees differently, and why. -->

## How it is checked

- [ ] A test in `tests/` (or the module's, pack's or package's tests) covers it
- [ ] Every dataset in `docs/demo/` still loads (`npm test`)
- [ ] `npm run typecheck` and `node scripts/hygiene.mjs` pass
- [ ] `CHANGELOG.md`, under `[Unreleased]`, says it
- [ ] A released migration, seed or pack file is not edited: a correction is a new file

## Rules of the house

- [ ] No country, currency or language as a default in the core: what a country decides is a pack row
- [ ] Everything in English; vocabulary labels may carry translations
- [ ] Every commit is signed off (`git commit -s`, see CONTRIBUTING.md)
