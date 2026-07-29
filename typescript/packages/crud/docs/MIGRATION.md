# Migrating from `@nestjsx/crud` 4.5.0 to `@apso/crud`

`@apso/crud` is a drop-in replacement for the abandoned `@nestjsx/crud`
4.5.0. It reproduces the same query surface (joins, filters, search, sort,
pagination) and the same controller/service API, so migrating is an
**import swap** — no controller, service, or DTO logic changes.

This guide is the exact procedure used to migrate the Apso platform server
(182 files, 528 tests, zero behavior change). It is the recommended path
for any `@nestjsx/crud@4.5.0` codebase, including the Acquisition.com
service.

> After migrating, `@apso/crud` also accepts the PostgREST query dialect
> (`?select=`, `?col=op.value`, resource embedding) against the same
> endpoints — no code change. See [DIALECTS.md](./DIALECTS.md).

## TL;DR

1. Replace the three packages in `package.json`.
2. Swap the imports (three find-and-replaces).
3. Fix any deep imports into `@nestjsx/crud/lib/*` (use the public entry).
4. Build and run your tests — they should pass unchanged.

## 1. Packages

```diff
 // package.json
-  "@nestjsx/crud": "4.5.0",
-  "@nestjsx/crud-request": "4.5.0",
-  "@nestjsx/crud-typeorm": "4.5.0",
+  "@apso/crud": "^1.0.0",
+  "@apso/crud-core": "^1.0.0",
+  "@apso/crud-request": "^1.0.0",
+  "@apso/crud-typeorm": "^1.0.0",
```

`@apso/crud-core` is the shared, framework-agnostic base; add it explicitly.

### Peer dependencies

`@apso/crud` supports **NestJS 9 and 10** (`@nestjs/common`/`core`
`^9.0.0 || ^10.0.0`, `@nestjs/swagger` `^6 || ^7`, `typeorm` `^0.3.20+`,
`reflect-metadata` `^0.1.13 || ^0.2`). No NestJS upgrade is required.

`@apso/crud-request` is **client-safe** — it has no NestJS/TypeORM
dependency, so it can also be bundled in a browser/SDK to build queries.

## 2. Imports

Three whole-word replacements across your source tree:

| From | To |
|---|---|
| `@nestjsx/crud` | `@apso/crud` |
| `@nestjsx/crud-typeorm` | `@apso/crud-typeorm` |
| `@nestjsx/crud-request` | `@apso/crud-request` |

```bash
# one-liner (macOS/BSD sed; use sed -i on GNU)
grep -rl '@nestjsx/' src | xargs sed -i '' \
  -e 's|@nestjsx/crud-typeorm|@apso/crud-typeorm|g' \
  -e 's|@nestjsx/crud-request|@apso/crud-request|g' \
  -e 's|@nestjsx/crud|@apso/crud|g'
```

(Order matters: replace the longer specifiers first, as above.)

### The full exported surface

Everything `@nestjsx/crud@4.5.0` exposes and that a typical consumer uses
is re-exported under the same name:

- **From `@apso/crud`:** `Crud`, `CrudController`, `CrudRequest`,
  `Override`, `ParsedRequest`, `ParsedBody`, `CreateManyDto`,
  `CrudValidationGroups`, `QueryOptions`, `CrudRequestInterceptor`.
- **From `@apso/crud-typeorm`:** `TypeOrmCrudService` — with the same
  protected members consumers override: `repo`, `getSelect(parsed,
  options)`, and the repository passthroughs `findOne` / `find`.
- **From `@apso/crud-request`:** `ParsedRequestParams`, `SCondition`.

The autogen controller pattern works unchanged:

```typescript
@Crud({ model: { type: Post }, params: { id: { field: 'id', type: 'number', primary: true } } })
@Controller('posts')
export class PostController implements CrudController<Post> {
  constructor(public service: PostService) {}
  get base(): CrudController<Post> { return this; }

  @Override('getOneBase')
  get(@ParsedRequest() req: CrudRequest) {
    return this.base.getOneBase(req);
  }
}
```

```typescript
@Injectable()
export class PostService extends TypeOrmCrudService<Post> {
  constructor(@InjectRepository(Post) repo: Repository<Post>) { super(repo); }

  // Overrides that use `this.repo`, `getSelect`, findOne/find keep working.
  getSelect(query: ParsedRequestParams, options: QueryOptions) {
    return [...new Set(super.getSelect(query, options))];
  }
}
```

## 3. Deep imports

If you import from a `@nestjsx/crud` internal path, switch to the public
entry. The one that appears in practice:

```diff
-import { CRUD_OPTIONS_METADATA } from '@nestjsx/crud/lib/constants';
+import { CRUD_OPTIONS_METADATA } from '@apso/crud';
```

`@apso/crud` re-exports the metadata keys (`CRUD_OPTIONS_METADATA`,
`CRUD_CONTROLLER_METADATA`, `PARSED_CRUD_REQUEST_KEY`) from its public entry.

## 4. Build and test

```bash
npm install
npm run build
npm test
```

Your suite should pass with no assertion changes.

## Behavior parity

`@apso/crud` is verified against `@nestjsx/crud@4.5.0` by a differential
test harness that issues an identical query corpus to both libraries and
asserts byte-identical responses (status + body) — filter operators
(incl. unprefixed forms and the `L` case-insensitive variants), the
`filter`/`or` truth table, `s=` search trees, nested joins with the join
allowlist, sort, pagination shapes, `fields` selection, and error/404
semantics. Notable fidelity guarantees inherited from nestjsx:

- `PATCH`/`PUT` ignore a primary key in the body (the target row's identity
  never changes).
- `fields=` combined with `join=` keeps the joined relation.
- Unknown `fields=` columns are silently ignored (no 500).
- `$inL`/`$notinL` lower only the column, comparing values as given.
- Bulk create rejects an empty array with 400.
- `getMany` returns a bare array when unpaginated, the envelope otherwise.

### One thing to confirm: `timestamp` column hydration

`@nestjsx/crud`, via the ValidationPipe + its generated DTOs'
class-transformer date handling, reinterprets a posted UTC timestamp
string against the **server's local timezone** on create/replace (e.g. a
posted `2026-07-04T00:00:00.000Z` is stored/echoed shifted by the server's
UTC offset). Whether your app sees this depends on your DTOs, not on
`@apso/crud` — the library's create/read path preserves the exact instant.
If your service relies on the nestjsx shift, verify the timestamp round-trip
after migrating; if you keep your existing DTOs, behavior is unchanged.
(Tracked as apsoai/apso-packages#44.)

## Rollback

The change is a mechanical import swap; reverting the `package.json` and
import edits restores `@nestjsx/crud`. No schema or data migration is
involved.
