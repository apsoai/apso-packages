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
| `@apso/crud-typeorm` | `typescript/packages/crud-typeorm/` | `ts-crud-typeorm-vX.Y.Z` | npm |
| `@apso/crud` | `typescript/packages/crud/` | `ts-crud-vX.Y.Z` | npm |
| `apso-domain-events` | `python/packages/domain-events/` | `py-domain-events-vX.Y.Z` | PyPI |
| `domainevents` (Go) | `go/domainevents/` | `go/domainevents/vX.Y.Z` | Go proxy (tag only) |

If a package changed, it is:
1. **Version-bumped** from the commit messages since its last tag — `feat:` → minor,
   `!:` / `BREAKING CHANGE` → major, otherwise patch. (First release ships the current
   manifest version / `0.1.0` for Go.)
2. **Built, tested, and published** (npm publish / PyPI / Go = the tag).
3. **Committed** (`chore(release): … [skip ci]`), **tagged**, and **GitHub-released**.

A package whose directory didn't change is skipped. The release commit is marked `[skip ci]`
and pushed with the default token, so it never re-triggers the workflow.

## One-time setup

- **npm:** the org-level `NPM_TOKEN` secret must be an automation token with publish rights to
  the `@apso` scope, and its *Repository access* must include `apso-packages`.
- **PyPI:** configure **Trusted Publishing** on the `apso-domain-events` project → GitHub
  publisher: owner `apsoai`, repo `apso-packages`, workflow `auto-release.yml`. (No secret.)
- **Go:** nothing — public repo + tag.

## Normal flow

Just merge to `main`. Change `typescript/packages/domain-events/**` → the TS package releases;
touch the Go dir → Go releases; etc. Use conventional-commit prefixes to control the bump level.

`workflow_dispatch` is available to re-run detection manually.
