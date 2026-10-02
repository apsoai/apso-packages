# Releasing

Releases are **automatic and path-detected**, mirroring the CLI's push-to-main automation —
but **independently per package**. You don't tag or bump by hand.

## How it works

On every push to `main`, `.github/workflows/auto-release.yml` runs `auto-release.sh`, which for
each package checks whether its directory changed since that package's last release tag:

| Package | Watched path | Tag | Registry |
|---|---|---|---|
| `@apso/domain-events` | `typescript/packages/domain-events/` | `ts-domain-events-vX.Y.Z` | npm |
| `@apso/crud-core` | `typescript/packages/crud-core/` | `ts-crud-core-vX.Y.Z` | npm |
| `@apso/crud-request` | `typescript/packages/crud-request/` | `ts-crud-request-vX.Y.Z` | npm |
| `@apso/postgrest-request` | `typescript/packages/postgrest-request/` | `ts-postgrest-request-vX.Y.Z` | npm |
| `@apso/crud-typeorm` | `typescript/packages/crud-typeorm/` | `ts-crud-typeorm-vX.Y.Z` | npm |
| `@apso/crud` | `typescript/packages/crud/` | `ts-crud-vX.Y.Z` | npm |
| `@apso/sdk` | `typescript/packages/sdk/` | `ts-sdk-vX.Y.Z` | npm |
| `@apso/schema-tools` | `typescript/packages/schema-tools/` | `ts-schema-tools-vX.Y.Z` | npm |
| `apso-domain-events` | `python/packages/domain-events/` | `py-domain-events-vX.Y.Z` | PyPI |
| `domainevents` (Go) | `go/domainevents/` | `go/domainevents/vX.Y.Z` | Go proxy (tag only) |

If a package changed, it is:
1. **Version-bumped** from the commit messages since its last tag — `feat:` → minor,
   `!:` / `BREAKING CHANGE` → major, otherwise patch. (First release ships the current
   manifest version / `0.1.0` for Go. A manifest version set by hand above the last tag
   ships as is.)
   **Registry guard:** the result must be above the highest version already on npm/PyPI.
   A commit-derived bump that is not gets re-bumped from the registry max (tag at 1.1.1,
   npm at 1.3.1, `feat:` → 1.4.0). A hand-pinned or first-release version that is not
   fails the package loudly. Dry run: `bash .github/scripts/auto-release.sh guard npm
   @apso/sdk 1.2.0 minor`. Offline tests: `.github/scripts/test-version-guard.sh` (runs in
   the TypeScript CI workflow).
2. **Built, tested, and published** (npm publish / PyPI / Go = the tag).
3. **Committed** (`chore(release): … [skip ci]`), **tagged**, and **GitHub-released**.

A package whose directory didn't change is skipped. The release commit is marked `[skip ci]`
and pushed with the default token, so it never re-triggers the workflow.

## One-time setup

- **npm:** **Trusted Publishing** (GitHub OIDC), no token. On npmjs.com, for *each* package
  (`@apso/domain-events`, `@apso/crud-core`, `@apso/crud-request`, `@apso/postgrest-request`,
  `@apso/crud-typeorm`, `@apso/crud`, `@apso/sdk`, `@apso/schema-tools`) → Settings → Trusted Publisher → GitHub
  Actions: organization `apsoai`, repository `apso-packages`, workflow filename
  `auto-release.yml`, no environment, with npm publish allowed. Once a release succeeds via
  OIDC, Publishing access can be set to disallow tokens. The publish step needs
  npm >= 11.5.1 (installed in the workflow on Node 22) and each package.json `repository.url` must point at this repo (provenance check).
  A brand-new package (for example `@apso/schema-tools`) must exist on npm before a trusted
  publisher can be added, so its first version is published by hand once
  (`cd typescript && npm run build && npm publish -w @apso/schema-tools --access public`);
  after that, set up the trusted publisher and let `auto-release.yml` ship every later version.
  The publish runs with an empty npm userconfig and blank `NODE_AUTH_TOKEN` so no token can
  shadow OIDC.
- **PyPI:** configure **Trusted Publishing** on the `apso-domain-events` project → GitHub
  publisher: owner `apsoai`, repo `apso-packages`, workflow `auto-release.yml`. (No secret.)
- **Go:** nothing — public repo + tag.

## Normal flow

Just merge to `main`. Change `typescript/packages/domain-events/**` → the TS package releases;
touch the Go dir → Go releases; etc. Use conventional-commit prefixes to control the bump level.

`workflow_dispatch` is available to re-run detection manually.
