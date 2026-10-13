# `docs/releasing.md` — how a release is cut

A release of Nexgen OS is one tag carrying the core's migrations, the
modules, the country packs and the npm packages together. There is no
"down": a database that has run a migration is not walked back, so every
release moves forward, and the version a database answers with is what a
package decides on.

## What has to move

Each step below fails a test when it is skipped: a release half done is
worse than one not cut.

1. **The schema version.** When the release adds anything a package reads —
   a table, a column, a function — a migration
   `supabase/migrations/<YYYYMMDDHHMMSS>_schema_version_<x_y_z>.sql`
   redefines `nexgen.nexgen_schema_version()` to return the new number, and
   does nothing else. `packages/cli/tests/version.test.ts` reads it.

2. **The package versions**, in every workspace manifest:

   ```sh
   npm version <x.y.z> --workspaces --no-git-tag-version
   npm install --package-lock-only
   npm ci     # this must pass before anything else is run
   ```

   Then `PACKAGE_VERSION` in `packages/cli/src/version.ts`; the tests keep it
   equal to the manifest.

3. **The schema floor.** `nexgenOs.schemaVersion` and `nexgenOs.schemaMin` in
   `packages/cli/package.json`, and `SCHEMA_VERSION` and `SCHEMA_MIN` in
   `packages/cli/src/version.ts`. `schemaVersion` is what this release's
   migrations bring a database to. Raise `schemaMin` only when the release
   can no longer bring an older database forward; the installer then refuses
   it with `database_too_old` and names the release to run first.

4. **The modules and the packs.** A module that changes moves the `version`
   its first migration writes into `nexgen.modules` through a new migration;
   a pack moves `version` in its `pack.json`. Neither edits a file already
   released.

5. **The changelog.** `[Unreleased]` in `CHANGELOG.md` becomes
   `## [x.y.z] — YYYY-MM-DD` under
   [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), with a fresh
   empty `[Unreleased]` above it. Read `git log` against it before closing
   the section.

6. **The checks.**

   ```sh
   npm run typecheck && npm test
   node scripts/hygiene.mjs
   npm run build -w packages/cli
   node packages/cli/dist/bin.js --version    # prints the new number
   ```

7. **The run against a real Supabase project.** The test suite runs on
   PGlite; this run covers what PGlite does not: the published binary over a
   pooler, a hosted project's roles, extensions and TLS. On a throwaway
   project, with PostGIS enabled:

   ```sh
   export NEXGEN_DB_URL=…                       # never written to a file
   npx nexgen-os@<previous> init --packs <cc>   # the last release, as users have it
   node packages/cli/dist/bin.js migrate        # this release, over it
   node packages/cli/dist/bin.js doctor         # no problem
   node packages/cli/dist/bin.js init --dry-run # nothing to apply
   ```

   Then a fresh `init` of this release on an empty project. Write the date,
   the region, the Postgres version and the result here, under *The last
   run*. It is not in the CI: it costs money, and two releases installing
   into one shared project would test nothing.

   **The last run:** none yet — `0.1.0` is the first release.

## Cutting it

1. Open a pull request with all of the above, every commit signed off.
2. Merge it.
3. Tag `main`, annotated, as the project's identity, and push the tag:

   ```sh
   git tag -a v<x.y.z> -m "Nexgen OS v<x.y.z>"
   git push origin v<x.y.z>
   ```

   A tag is never moved and never deleted.
4. Publish a GitHub Release on that tag, with the changelog section as its
   body.

## npm

The installer is published as `nexgen-os` (its binary is `nexgen-os`); the
format libraries, the connectors and the core client will be published under
`@nexgen-os/*`. `npm run build -w packages/cli` copies the release's
migrations, seeds and packs into `packages/cli/assets/`, which the published
package carries and records by the same paths as the repository. Publishing
comes with the tag, from the CI, with npm provenance, so that every version
on npm is a version whose source can be read; until that workflow exists, a
release is published by hand from the tag, on a clean tree.

## After a release

`[Unreleased]` is empty and the next change starts a new section under it. A
released migration, module migration or pack seed is never edited, not even
a comment: it has run on databases nobody here controls, and a correction is
a new file.
