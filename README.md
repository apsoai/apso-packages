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

See [`CONTRACT.md`](CONTRACT.md) for the behavior every language implementation must honor.
