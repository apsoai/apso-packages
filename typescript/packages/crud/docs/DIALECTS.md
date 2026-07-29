# Query dialects: nestjsx and PostgREST

`@apso/crud` speaks two URL query dialects against the same engine. Every
request is parsed into one shared `ParsedRequest`, so the TypeORM query builder,
the `options.query.join` allowlist, and the `@CrudAuth` filters behave
**identically** no matter which dialect a client used.

- **nestjsx** — the `@nestjsx/crud` format (`fields`, `filter`, `join`, `sort`,
  `s`, `or`). Parsed by `@apso/crud-request`. This is the incumbent and the
  default.
- **PostgREST** — the [PostgREST](https://postgrest.org) format (`select`,
  `col=op.value`, `order`, resource embedding). Parsed by
  `@apso/postgrest-request`.

Both parsers are client-safe (no `@nestjs` dependency), so an SDK or browser can
build either dialect.

## How the dialect is chosen

`CrudRequestInterceptor` runs `detectDialect(query, header)` on every request:

1. **`X-Crud-Dialect` header** — if set to `postgrest` or `nestjsx`, that wins,
   full stop. Any other value is a **400**. This is the escape hatch when a
   query is legitimately ambiguous or a client wants to pin the behavior.
2. **Param shape**, otherwise:
   | Signal | Dialect |
   |---|---|
   | `fields`, `filter`, `or`, `join`, `sort`, `s`, `per_page` | nestjsx |
   | `select`, `order` | PostgREST |
   | a bare `col=op.value` (e.g. `age=gt.30`, `email=is.null`, `name=not.eq.Ada`) | PostgREST |
   | `limit`, `offset`, `page`, `cache` | neutral (no signal) |
   | any other unknown param | neutral (no signal) |
3. **Collision** — if a request carries signals from **both** families
   (e.g. `?fields=name&select=id`), that is a genuine ambiguity. The interceptor
   returns a **400** with a message rather than guessing. Set `X-Crud-Dialect`
   to resolve it.
4. **PostgREST signals only** → PostgREST.
5. **Everything else** (nestjsx signals, neutral-only, or an empty query) →
   **nestjsx**. This keeps every pre-existing request byte-identical.

The resolved dialect is echoed back on the `X-Crud-Dialect` response header, so
clients and the conformance battery can confirm which parser ran.

## Why neutral params don't force a dialect

`limit`/`offset`/`page`/`cache` mean the same thing in both dialects and the two
parsers produce the same `ParsedRequest` for them. A request that is *only*
`?limit=10` is therefore parsed by the default (nestjsx) with no observable
difference. Unknown params are treated the same way so a stray query parameter
can never silently flip a request into the wrong dialect.

## Access control is dialect-independent

The access boundary — the `options.query.join` allowlist and the `@CrudAuth`
filter/persist rules — is enforced by the shared engine on the shared
`ParsedRequest`, **after** parsing. A PostgREST resource embed
(`select=id,posts(...)`) resolves to the same `JoinCondition[]` a nestjsx
`join=posts` produces, so neither dialect can reach a relation the other would be
denied. See the cross-dialect access-parity test in the parity harness.

## Examples

| Intent | nestjsx | PostgREST |
|---|---|---|
| select columns | `?fields=id,name` | `?select=id,name` |
| filter | `?filter=age||$gt||30` | `?age=gt.30` |
| IN | `?filter=plan||$in||Pro,Team` | `?plan=in.(Pro,Team)` |
| is null | `?filter=email||$isnull` | `?email=is.null` |
| order | `?sort=age,DESC` | `?order=age.desc` |
| paginate | `?limit=20&offset=40` | `?limit=20&offset=40` |
| embed relation | `?join=posts||title` | `?select=id,posts(title)` |
| force dialect | — | header `X-Crud-Dialect: postgrest` |

## Worked example: one query, both dialects

"Give me the id and name of active authors older than 30, newest first, two
per page (second page), with each author's published post titles."

nestjsx:

```
GET /authors?fields=id,name
  &filter=active||$eq||true
  &filter=age||$gt||30
  &join=posts||title
  &filter=posts.status||$eq||published
  &sort=age,DESC
  &limit=2&offset=2
```

PostgREST:

```
GET /authors?select=id,name,posts(title)
  &active=eq.true
  &age=gt.30
  &posts.status=eq.published
  &order=age.desc
  &limit=2&offset=2
```

Both parse into the same `ParsedRequest`, hit the same TypeORM query builder
under the same `options.query.join` allowlist, and return the same rows. The
response carries `X-Crud-Dialect: nestjsx` or `postgrest` so you can confirm
which parser ran.

## See also

- [MIGRATION.md](./MIGRATION.md) — migrating from `@nestjsx/crud` to `@apso/crud`.
