# Supported PostgREST read syntax

`@apso/crud` reads follow the [PostgREST](https://docs.postgrest.org/en/v16/references/api.html)
query syntax. This page lists what is supported, where the behaviour differs
from PostgREST, and what is refused. Anything on the unsupported list is
answered with a **400 that names the feature**. A request is never answered
with rows shaped differently from what it asked for.

Writes are ordinary REST routes (`POST /`, `PATCH /:id`, `PUT /:id`,
`DELETE /:id`) and are not covered here.

A controller accepts PostgREST only when it says so:

```ts
@Crud({ model: { type: Post }, dialects: ['postgrest'] })   // one controller
setAcceptedDialects(['postgrest']);                          // every controller, at start-up
```

Without that it also accepts the older nestjsx syntax (see
[Dialects](#dialects-nestjsx-and-postgrest) below). Everything on this page
applies to any request parsed as PostgREST.

## Supported

### Filters

`?column=operator.value`. Filters on different parameters must all match. The
same column can appear twice (`?views=gte.5&views=lte.10`).

| Operator | Example |
|---|---|
| `eq`, `neq`, `gt`, `gte`, `lt`, `lte` | `views=gte.100` |
| `like`, `ilike` (`*` is the wildcard) | `title=ilike.*engine*` |
| `in` | `views=in.(100,250)`, `name=in.("Doe, Jane",Ada)` |
| `is` | `body=is.null`, `body=is.not_null`, `published=is.true`, `published=is.false` |
| `not.` in front of any of them | `views=not.gt.100`, `body=not.is.null`, `views=not.in.(1,2)` |

Groups: `or=(views.lt.5,views.gt.20)` and `and=(...)`, nested as
`or=(views.eq.1,and(views.gte.10,published.is.false))`. A condition inside a
group can be negated (`views.not.gte.5`) and can quote a value that holds a
comma or parenthesis (`title.eq."Doe, Jane"`).

### Columns

`select=id,title` returns those columns. `select=id,label:title` renames
`title` to `label` in the response, on a list and on a read by id.

### Order, limit, offset

`order=views.desc,id.asc`, with `.nullsfirst` or `.nullslast`.
`limit=20&offset=40`.

### Embedding related rows

`select=id,author(name),comments(id,text)` embeds related rows. A to-one
relation is a nested object, a to-many relation is an array. Embeds nest:
`select=id,post(id,author(name))`. `rel(*)` returns every column of the
related row. Embeds work on a read by id too.

Only relations in the controller's `query.join` allowlist can be embedded.

- `comments.likes=gt.5` filters the embedded rows. Every parent still comes
  back, with an empty array where nothing matched.
- `select=id,comments!inner(id)` returns only parents that have at least one
  embedded row. With `comments.likes=gt.5` it returns only parents that have a
  matching one.
- `order=author(name).desc` orders the parents by a column of an embedded
  to-one relation.

## Paging and counts

Follows the PostgREST
[pagination and count](https://docs.postgrest.org/en/v16/references/api/pagination_count.html)
page.

The response body of a list is always a bare JSON array. There is no
`{data,count,total,page,pageCount}` envelope in this syntax, whatever the
controller's `alwaysPaginate` says.

Every list response carries the row span:

```
Range-Unit: items
Content-Range: 0-4/*
```

`*` after the slash means the total was not counted. An empty page is
`Content-Range: */*`.

Send `Prefer: count=exact` to get the total:

| Request | Status | Headers |
|---|---|---|
| `GET /posts?limit=2`, `Prefer: count=exact`, 6 rows match | 206 | `Content-Range: 0-1/6`, `Preference-Applied: count=exact` |
| `GET /posts?limit=10`, `Prefer: count=exact`, 6 rows match | 200 | `Content-Range: 0-5/6` |
| `GET /posts?limit=2&offset=10`, `Prefer: count=exact` | 200 | `Content-Range: */6`, body `[]` |
| `GET /posts?limit=0`, `Prefer: count=exact` (count only) | 200 | `Content-Range: */6`, body `[]` |

The status is 206 when the total is known and the page holds only part of it,
and 200 otherwise.

The total is counted by the same query as the rows: the `@CrudAuth` filter,
the controller's `query.filter`, the caller's filters and any `!inner` embed
all apply. It never includes a row the caller cannot read.

`Prefer: count=planned` and `count=estimated` are accepted and answered with
an exact count. The response says so: `Preference-Applied: count=exact`.

`HEAD` returns the same status and headers with no body.

The `Range` request header works for whole-row ranges: `Range: 0-19` is
`offset=0&limit=20` and `Range: 10-` is `offset=10`. Sending `Range` together
with `limit` or `offset` is a 400. A range whose end is before its start is a
416. A `Range` in another unit (`bytes=0-99`) is ignored.

`Content-Range` and `Preference-Applied` are added to
`Access-Control-Expose-Headers`, so a browser on another origin can read them.

### The default page size is never silent

A controller has a default `limit` (generated controllers set 5). When a
request sends no `limit` and the default page comes back full, the total is
counted without being asked for:

```
GET /posts                 ->  206, Content-Range: 0-4/6   (5 of 6 rows)
GET /posts?views=gt.100    ->  200, Content-Range: 0-2/*   (everything fits, no count)
GET /posts?limit=5         ->  200, Content-Range: 0-4/*   (the caller set the limit)
```

So a 206 or a total larger than the span always means there are more rows. A
caller that does not want the count query sends a `limit`.

## Differences from PostgREST

- The primary key is always returned, at the top level and in every embed,
  even when `select` does not list it.
- A relation is named by its property name on the entity. A foreign key hint
  (`author!author_id(name)`) is accepted and has no effect, because the name is
  already unambiguous.
- A page past the end with `Prefer: count=exact` is a 200 with `[]` and
  `Content-Range: */<total>`. PostgREST answers 416.
- `count=planned` and `count=estimated` return exact counts.
- Without `Prefer`, the total is still counted when no `limit` was sent and
  the default page is full (see above).
- A mistake in the query is a 400 with a JSON body `{statusCode, message,
  error}`, not PostgREST's `{code, message, details, hint}`.

## Unsupported: refused with 400

| Feature | Example | What to do instead |
|---|---|---|
| `match`, `imatch`, `isdistinct` | `name=match.^A` | `like` / `ilike` |
| Full-text search | `name=fts.gears` | `ilike` |
| Array and range operators `cs`, `cd`, `ov`, `sl`, `sr`, `nxr`, `nxl`, `adj` | `tags=cs.{a}` | none |
| `any` / `all` modifiers | `name=like(any).{A*,B*}` | `or=(name.like.A*,name.like.B*)` |
| Negated groups | `not.and=(a.gte.5,a.lte.20)` | negate each condition: `or=(a.not.gte.5,a.not.lte.20)` |
| Casts | `select=id,views::text` | convert in the client |
| JSON paths, in `select`, filters and `order` | `select=id,meta->>color` | select the whole JSON column |
| Aggregates | `select=views.sum()`, `select=count()` | for a row count, `Prefer: count=exact` |
| Embed alias | `select=id,writer:author(name)` | embed under the relation's own name |
| Rename inside an embed | `select=id,author(n:name)` | rename top-level columns only |
| Spread | `select=title,...author(name)` | `author(name)` and read the nested object |
| Empty embed | `select=id,author()` | `author(*)` or list columns |
| A relation that does not exist or is outside the allowlist | `select=id,nope(*)` | the message lists the embeddable relations |
| An unknown column in `select`, in an embed, in a filter or in `order` | `select=id,nope` | |
| Filter or order on a relation that is not embedded | `comments.likes=gt.5` with no `comments(...)` in `select` | add the embed to `select` |
| `order`, `limit`, `offset`, `or`, `and` on an embed | `comments.order=likes.desc` | these apply to the top level only |
| Null filter on an embed (semi-join, anti-join) | `comments=is.null` | `!inner` for "has at least one" |
| Singular response | `Accept: application/vnd.pgrst.object+json` | `GET /posts/1` |
| A value that does not fit the column type, or an operator it lacks | `views=eq.abc`, `published=like.*a*` | |
| `Range` header together with `limit` / `offset` | | send one of them |

Not refused, and without effect: `Prefer` values other than `count`, and
foreign key hints.

## OpenAPI and MCP tool arguments

A controller that accepts PostgREST only documents its list route with
PostgREST parameters, so a caller that builds requests from the OpenAPI
document (an agent through `@apso/mcp`, a generated client) can send them:

- `select`, `order`, `limit`, `offset`, `or`, `and`
- one optional string parameter per column, value `operator.value`
  (`views=gte.100`). The columns come from the entity. Columns in
  `query.exclude`, columns outside `query.allow` and columns declared
  `select: false` are left out.
- `embedded`, an object whose keys are `relation.column`, for filters on
  embedded rows. It is documented with `style: form, explode: true`, which
  means each key is its own query parameter: `{"comments.likes": "gt.5"}` is
  sent as `comments.likes=gt.5`. Present only when the controller allows
  embeds.

The operation description holds the operator list and one worked example. A
read by id documents `select`. `setAcceptedDialects` rewrites the
documentation of every `@Crud` controller, so it can be called after the
controllers are imported, as long as it runs before the OpenAPI document is
built.

## Dialects: nestjsx and PostgREST

`@apso/crud` also parses the `@nestjsx/crud` query format (`fields`, `filter`,
`join`, `sort`, `s`, `or`) for services that have not moved yet. Every request
is parsed into one shared `ParsedRequest`, so the TypeORM query builder, the
`options.query.join` allowlist and the `@CrudAuth` filters behave identically
whichever syntax a client used. Both parsers are client-safe (no `@nestjs`
dependency).

## How the dialect is chosen

`CrudRequestInterceptor` runs `detectDialect(query, header)` on every request:

1. **`X-Crud-Dialect` header**, if set to `postgrest` or `nestjsx`, that wins,
   full stop. Any other value is a **400**. This is the escape hatch when a
   query is legitimately ambiguous or a client wants to pin the behavior.
2. **Param shape**, otherwise:
   | Signal | Dialect |
   |---|---|
   | `fields`, `filter`, `or`, `join`, `sort`, `s`, `per_page` | nestjsx |
   | `or=(...)` in parentheses (PostgREST's logical group) | PostgREST |
   | `select`, `order` | PostgREST |
   | a bare `col=op.value` (e.g. `age=gt.30`, `email=is.null`, `name=not.eq.Ada`) | PostgREST |
   | `limit`, `offset`, `page`, `cache` | neutral (no signal) |
   | any other unknown param | neutral (no signal) |
3. **Collision**, if a request carries signals from **both** families
   (e.g. `?fields=name&select=id`), that is a genuine ambiguity. The interceptor
   returns a **400** with a message rather than guessing. Set `X-Crud-Dialect`
   to resolve it.
4. **PostgREST signals only** → PostgREST.
5. **Everything else** (nestjsx signals, neutral-only, or an empty query) →
   **nestjsx**. This keeps every pre-existing request byte-identical.

The resolved dialect is echoed back on the `X-Crud-Dialect` response header, so
clients and the conformance battery can confirm which parser ran.

## Accepting one dialect only

By default every controller accepts both dialects. The `dialects` option narrows
that, per controller or for the whole app:

```ts
// One controller
@Crud({ model: { type: Post }, dialects: ['postgrest'] })

// Every controller, set once at start-up (a controller's own option wins)
import { setAcceptedDialects } from '@apso/crud';
setAcceptedDialects(['postgrest']);
```

With `['postgrest']`:

- Detection is skipped. Every request is parsed as PostgREST, including an
  empty query and `?limit=10`, which the default reads as nestjsx.
- A nestjsx parameter is a **400** that names the parameter and what to send
  instead:

  | nestjsx parameter | PostgREST equivalent in the message |
  |---|---|
  | `fields` | `select=id,name` |
  | `filter` | a column filter, `age=gt.30` |
  | `or` (not in `or=(...)` form) | `or=(age.lt.18,age.gt.65)` |
  | `join` | an embed in `select`, `select=*,posts(title)` |
  | `sort` | `order=age.desc` |
  | `s` | column filters with `or=(...)` and `and=(...)` groups |
  | `per_page` | `limit` |
  | `page` | `limit` and `offset` |
  | `cache` | none, remove it |

  A column that shares one of these names is still filterable the PostgREST
  way (`?page=eq.2`): the 400 applies only when the value is not `op.value`.
- `X-Crud-Dialect: nestjsx` is a **400**. `X-Crud-Dialect: postgrest` is
  accepted and changes nothing.

`['nestjsx']` is the mirror image for the header and for detection. The default,
and `['nestjsx', 'postgrest']`, behave exactly as described above.

## Why neutral params don't force a dialect

`limit`/`offset`/`page`/`cache` mean the same thing in both dialects and the two
parsers produce the same `ParsedRequest` for them. A request that is *only*
`?limit=10` is therefore parsed by the default (nestjsx) with no observable
difference. Unknown params are treated the same way so a stray query parameter
can never silently flip a request into the wrong dialect.

## Access control is dialect-independent

The access boundary, the `options.query.join` allowlist and the `@CrudAuth`
filter/persist rules, is enforced by the shared engine on the shared
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
| force dialect | none | header `X-Crud-Dialect: postgrest` |

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

- [MIGRATION.md](./MIGRATION.md) , migrating from `@nestjsx/crud` to `@apso/crud`.
