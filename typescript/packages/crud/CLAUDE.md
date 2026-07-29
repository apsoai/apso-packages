# @apso/crud

## What This Is

Drop-in replacement for `@nestjsx/crud` with the same query format and decorator patterns, built from scratch by Mavric. Not a fork. Licensed Apache-2.0.

The purpose is two-fold: own the dependency (no third-party risk), and extend it with aggregate query capabilities that nestjsx/crud never offered.

## Package Architecture

```
@apso/crud                  Main package, re-exports everything
  @apso/crud-core           Interfaces, types, constants (no runtime deps)
  @apso/crud-request        HTTP request parser (query string to typed object)
  @apso/crud-typeorm         TypeORM query builder (typed object to SQL)
```

All four packages must be published together. They share the same version.

## Current State

### Working (parity with nestjsx/crud)

- 8 CRUD operations: getMany, getOne, createOne, createMany, updateOne, replaceOne, deleteOne, recoverOne
- @Crud decorator with route generation and Swagger docs
- Before/after hooks on all operations
- 16 filter operators: $eq, $ne, $gt, $gte, $lt, $lte, $starts, $ends, $cont, $excl, $in, $notin, $isnull, $notnull, $between, plus case-insensitive variants ($eqL, $contL, etc.)
- Field selection with dedup fix (nestjsx/crud issue #777)
- Sorting (ORDER BY)
- Joins (LEFT JOIN with field selection and conditions)
- Pagination (limit, offset, page, maxLimit enforcement)
- class-validator / class-transformer integration
- nestjsx/crud query format compatibility (same URL parameter syntax)

### Not Implemented (blocks v2 template migration)

**Search conditions (`s` parameter):**
- `applySearchConditions()` in typeorm-crud.service.ts:343 is a no-op with console.warn
- Must support nested AND/OR conditions in the nestjsx/crud `$and`/`$or` format
- Used by frontends that build complex filter UIs

**Soft delete recovery:**
- `recoverOne()` in typeorm-crud.service.ts:148 throws "not implemented"
- Must use TypeORM's `recover()` method for entities with `@DeleteDateColumn`

### Not Implemented (extended capabilities beyond nestjsx/crud)

**Aggregate queries:**
- COUNT, SUM, AVG, MIN, MAX as query operations
- New endpoint or query parameter for aggregate mode
- Return shape: `{ data: [{ field: value, count: N }], total: N }`

**GROUP BY:**
- Group results by one or more fields
- Combined with aggregate functions: `?groupBy=status&aggregate=count`
- Must support multiple group levels

**HAVING:**
- Filter on aggregate results: `?having=count,$gte,5`
- Only valid when GROUP BY is active

**Extended operators:**
- `$like` / `$ilike` (explicit LIKE/ILIKE without wrapping)
- `$any` / `$all` (Postgres array operators)
- `$jsonb` (Postgres JSONB path queries)
- `$distinct` (SELECT DISTINCT)

## Dependency Chain

These packages block the v1-to-v2 service template migration:

```
1. Implement search conditions + recoverOne     (parity)
2. Initialize git repos for all 4 CRUD packages
3. Publish to npm under @apso scope
4. Convert file: references in service-template-ts to npm versions
```

Steps 1-3 must happen before the CLI can switch to the v2 template. Aggregate/GROUP BY features can ship after the initial publish.

## Build and Test

```bash
# Each package builds independently
cd packages/apso-crud && npm run build
cd packages/apso-crud-core && npm run build
cd packages/apso-crud-request && npm run build
cd packages/apso-crud-typeorm && npm run build

# Tests
cd packages/apso-crud && npm test
cd packages/apso-crud-typeorm && npm test
cd packages/apso-crud-request && npm test
```

## Key Files

- `apso-crud-core/src/interfaces/crud-request.interface.ts` -- CrudRequestQuery, FilterOperator types (extend here for new operators)
- `apso-crud-typeorm/src/typeorm-crud.service.ts` -- TypeORM query builder (implement new SQL generation here)
- `apso-crud-request/src/request-parser.ts` -- HTTP query string parser (parse new parameters here)
- `apso-crud/src/crud-controller.base.ts` -- Base controller with hooks (add new endpoints here)
