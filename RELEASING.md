# Releasing

Each package is versioned and released **independently** via a path/prefixed git tag.
Bump the version in the package manifest first, commit, then push the matching tag.

| Package | Bump version in | Tag to push | Result |
|---|---|---|---|
| `@apso/domain-events` (npm) | `typescript/packages/domain-events/package.json` | `ts-domain-events-vX.Y.Z` | `release-ts.yml` → `npm publish` |
| `apso-domain-events` (PyPI) | `python/packages/domain-events/pyproject.toml` | `py-domain-events-vX.Y.Z` | `release-python.yml` → PyPI (OIDC) |
| `domainevents` (Go) | n/a (version *is* the tag) | `go/domainevents/vX.Y.Z` | `release-go.yml` validates + GitHub Release; the module proxy serves the tag |

The tag version must match the manifest version (npm/PyPI workflows enforce this).

## One-time setup

- **npm:** the workflow uses the **org-level** `NPM_TOKEN` secret. Ensure that secret's
  *Repository access* includes `apso-packages`, and that it's an npm **automation token**
  with publish rights to the `@apso` scope.
- **PyPI:** configure **Trusted Publishing** on the `apso-domain-events` PyPI project →
  GitHub publisher: owner `apsoai`, repo `apso-packages`, workflow `release-python.yml`.
  No secret is stored. (For the very first publish, use PyPI's "pending publisher" flow.)
- **Go:** nothing — the repo is public, so pushing the tag is the publish.

## Example

```bash
# TypeScript
# (bump version in typescript/packages/domain-events/package.json to 0.1.1, commit)
git tag ts-domain-events-v0.1.1 && git push origin ts-domain-events-v0.1.1

# Go
git tag go/domainevents/v0.1.0 && git push origin go/domainevents/v0.1.0
```
