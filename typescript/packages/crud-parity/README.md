# @apso/crud-parity

Differential parity suite: `@apso/crud` vs `@nestjsx/crud@4.5.0` (the version platform/server and the templates are pinned to). Tracking issue: apsoai/apso-packages#16, part of #14. Never published.

## How it works

Two minimal NestJS 9 apps (matching platform/server's Nest major) boot in-process over one shared pglite instance with per-app Postgres schemas (`ref` / `cand`) seeded identically. Every case in `src/matrix.ts` (76 read cases: joins incl. nested and eager, all 22 filter operators, or=, s= search, sort, pagination, getOne, guarded routes) plus the 15-step mutation battery in `test/mutations.spec.ts` runs against both apps; responses are normalized and diffed. Each case is its own jest test, and `parity-report.json` is written with every mismatch for issue filing.

## Run

```bash
npm install --legacy-peer-deps   # standalone install, see below
npm test
```

## Wiring notes (temporary until #14 step 1 lands)

- `@apso/crud*` are consumed as SOURCE from the loose local packages (`../../../../apso-crud*`) via jest moduleNameMapper + tsconfig paths. Their nested node_modules are bypassed by force-mapping every shared runtime dep, preventing duplicate typeorm/@nestjs instances. Switch to workspace refs when the packages move into this repo.
- This package is EXCLUDED from the typescript/ npm workspace: it needs Nest 9 (platform/server reality) while domain-events uses Nest 10, and workspace hoisting mixes the trees (Nest renamed internal route-args constants between 9 and 10, which silently nulls @nestjsx/crud's ParsedRequest). Standalone install keeps the tree consistent.
- `--experimental-vm-modules` is required (pglite dynamic import under jest).
- The @apso controllers carry own-prototype forwarding methods as a workaround for apsoai/apso-packages#23; signatures deliberately mirror the library exactly (dto undecorated) so no defect is masked.

## Current results (2026-07-28)

12/93 pass. Root-cause sub-issues under #14: #23, #25 (getMany envelope), #26 (getOne broken), #27 (fields drops id), #28 (silently ignored operators), #29 ($in/$notin/$between crash), #30 (relation-path queries crash), #31 (config-eager joins), #32 (offset page number), #33 (mutation dto never bound), #34 (s= no-op).
