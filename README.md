# apso-packages

First-party Apso libraries — a **polyglot monorepo** (TypeScript, Python, Go).

Per the [Apso Distribution Model](https://github.com/apsoai/skills/blob/main/plugins/apso/references/architecture/distribution-model.md): the CLI generates *schema-derived* code; stable engine/architecture patterns ship here as **versioned libraries**; **skills** install + wire them. Libraries are per-feature and opt-in, one language at a time.

## Layout

```
apso-packages/
  CONTRACT.md                 # cross-language behavior contracts (per feature)
  typescript/packages/*       # @apso/* (npm)
  python/packages/*           # apso-* (PyPI)
  go/*                        # github.com/apsoai/apso-packages/go/* (Go modules)
  .github/workflows/          # per-language CI (ts.yml, python.yml, go.yml)
```

## Features

| Feature | TypeScript | Python | Go |
|---|---|---|---|
| **domain-events** (transactional outbox + delivery) | `@apso/domain-events` | `apso-domain-events` | `.../go/domainevents` |
| **schema-tools** (.apsorc lint, autofix and edit operations for AI agents) | `@apso/schema-tools` | n/a | n/a |
| **logging** (one JSON line per request with who called, request id on every line, quiet start-up) | `@apso/logging` | line format in the package README | line format in the package README |

See [`CONTRACT.md`](CONTRACT.md) for the behavior every language implementation must honor.
