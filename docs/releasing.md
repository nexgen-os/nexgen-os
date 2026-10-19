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
   `core/migrations/<YYYYMMDDHHMMSS>_schema_version_<x_y_z>.sql`
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

   **The last run:** `0.1.0`, 16 October 2026, on a throwaway Supabase
   project in `eu-west-3` (Paris), Postgres 17.11, PostGIS 3.3.7, through
   the session pooler (port 5432), Node 24. `0.1.0` is the first release,
   so there was no earlier one to install first: the package was built,
   packed (`npm pack -w packages/cli`) and installed from its tarball, as
   npm will hand it to a user. On the empty project `doctor` named
   `postgis_required` and `not_installed`, and `init --dry-run` refused
   with `postgis_required`; after
   `create extension if not exists postgis with schema extensions;`,
   `init --packs fr,be` applied 26 steps (13 core, 5 module, 8 pack) in
   five seconds; `doctor` then found no problem, and `init --dry-run` and
   `migrate` had nothing to apply. The README's first dataset then loaded
   once the schema `extensions`, where Supabase keeps PostGIS, was on the
   search path. A session pooler string whose host is
   not the project's (`aws-0-…` for a project on `aws-1-…`) is refused by
   the pooler with `tenant/user … not found`: copy the string from the
   project's *Connect* panel.

## Cutting it

1. Open a pull request with all of the above, every commit signed off.
2. Merge it.
3. Tag `main`, annotated, as the project's identity, and push the tag:

   ```sh
   git tag -a v<x.y.z> -m "Nexgen OS v<x.y.z>"
   git push origin v<x.y.z>
   ```

   A tag is never moved and never deleted. It starts the **Release**
   workflow, see *npm* below.
4. Publish a GitHub Release on that tag, with the changelog section as its
   body.

## npm

The installer is published as `nexgen-os` (its binary is `nexgen-os`); the
core (`packages/core`), the format libraries (`packages/formats/*`) and the
connectors (`packages/connectors/*`) are published under `@nexgen-os/*`, the
scope of the npm organisation `nexgen-os`. `npm run build` compiles each of
them to its `dist/`, the core first.
`npm run build -w packages/cli` copies the release's migrations, seeds and
packs into `packages/cli/assets/`, which the published package carries and
records by the same paths as the repository.

Publishing comes with the tag, so that every version on npm is a version
whose source can be read. The workflow `.github/workflows/release.yml`
publishes through npm **trusted publishing** (GitHub OIDC, no npm token
anywhere), with a **provenance** statement linking each tarball to the commit
and the run that built it. What is published is read from the workspaces:
every package that is not `private`, after the packages of this repository
it depends on (`scripts/publish.mjs`).

### One-time setup, on npmjs.com

For each public package (the list is `npm run release:publish`;
`npm run release:check` names the ones still missing): open
`https://www.npmjs.com/package/<name>/access`, add a *Trusted Publisher*
of type **GitHub Actions** naming the repository `nexgen-os/nexgen-os` and
the workflow file `release.yml`, with no environment. A package never
published before is published once by hand, by a maintainer logged in to
npm (`npm login --auth-type=web`), with
`npm run release:publish -- --for-real` on the tag, before its trusted
publisher can be set.

### Releasing

Pushing the tag runs `npm ci`, `npm run release:check`, the typecheck, the
tests, the build and `npm run release:publish -- --for-real`. A version the
registry already holds is skipped, so a run that stopped half way is simply
re-run. A package's npm page then shows *Built and signed on GitHub
Actions*, and `npm audit signatures` verifies it.

**Dry run, on any branch**: *Actions → Release → Run workflow* with *Publish
for real* unticked, or locally `npm run build && npm run release:publish`. A
real publish needs a `v*` tag; the script refuses one from a pull request, a
dirty tree or an untagged HEAD.

## After a release

`[Unreleased]` is empty and the next change starts a new section under it. A
released migration, module migration or pack seed is never edited, not even
a comment: it has run on databases nobody here controls, and a correction is
a new file.
