# Apso SDK

A TypeScript SDK for interacting with Apso services via their OpenAPI-compliant CRUD API.

> This package lives in the `apso-packages` monorepo at `typescript/packages/sdk`.
> It builds, tests, and publishes via the monorepo's auto-release pipeline and
> has no dependency on the other workspace packages. Commit history
> prior to the move is at [apsoai/sdk](https://github.com/apsoai/sdk).

## Installation

```bash
npm install @apso/sdk
```

## Authentication

A client sends an API key, a user token, or both. Which one to use depends on where the code runs.

**On a server**, use the service's API key. The key is a secret and is sent as `x-api-key`.

```typescript
import { createClient } from '@apso/sdk';

const apso = createClient({
  baseURL: 'https://api.example.com',
  apiKey: process.env.APSO_API_KEY,
});

const orders = await apso.entity('orders').where({ status: 'open' }).findMany();
```

**In a browser or mobile app**, use the signed-in user's token and no key. The token is sent as `Authorization: Bearer`. Pass a function to have it called on every request, so a refreshed token is picked up without creating a new client.

```typescript
import { createClient } from '@apso/sdk';

const apso = createClient({
  baseURL: 'https://api.example.com',
  accessToken: () => session.getAccessToken(), // a string works too
});

const posts = await apso.entity('posts').findMany();
await apso.entity('posts').create({ title: 'Hello' });
```

Setting `apiKey` in a browser logs a warning, because anyone who opens the page can read the key.

Neither option is required. A client with no credentials sends the request as it is and the service decides whether to allow it.

Clients created with `accessToken` or custom `headers` are never cached, so each call to `createClient` or `ApsoClientFactory.getClient` returns a new client and one user's client is never handed to another. Create the client once per user or per request and reuse it. Key-only clients are still cached by base URL and key. When `accessToken` is a function, the `useCache` option of `get` is ignored, because one client may then serve several users.

### Errors and request ids

Every request sends an `x-request-id` header. The SDK generates one unless you set your own in `headers`.

A 401 or 403 response throws an `ApsoAuthError` with the service's message and the request id, which you can search for in the service's log.

```typescript
import { ApsoAuthError } from '@apso/sdk';

try {
  await apso.entity('posts').create({ title: 'Hello' });
} catch (err) {
  if (err instanceof ApsoAuthError) {
    console.error(err.status, err.message, err.requestId); // 403 'Missing role: admin' '7c9e...'
  }
}
```

The Supabase-style `from()` builder does not throw. It returns the same information on `error.message` and `error.requestId`.

## Usage

```typescript
import { createClient } from '@apso/sdk';

const client = createClient({ baseURL: 'https://api.example.com', apiKey: process.env.APSO_API_KEY });

const page = await client.entity('WorkspaceServices')
  .select(['id', 'name'])
  .where({ status: 'Active', build_status: { $in: ['Ready', 'Building'] } })
  .join(['workspace||name'])
  .orderBy({ created_at: 'DESC' })
  .limit(10)
  .page(2)
  .findMany();
// GET /WorkspaceServices?select=id,name,workspace(name)&status=eq.Active
//       &build_status=in.(Ready,Building)&order=created_at.desc&limit=10&offset=10
// page = { data: [...], count: 10, total: 57, page: 2, pageCount: 6 }

const one = await client.entity('WorkspaceServices').where({ id: 42 }).join(['workspace']).findOne();

// The low-level form takes the same parameters:
const same = await client.get('/WorkspaceServices', { filter: { status: 'Active' }, limit: 10 });
```

### What goes on the wire

`entity()` and `get()` send the PostgREST query syntax (`X-Crud-Dialect: postgrest`, `Prefer: count=exact`). The service answers a list with a bare array and the total in the `Content-Range` header, and the SDK returns `{ data, count, total, page, pageCount }`.

The service must run `@apso/crud` with PostgREST counts (the release that adds `Content-Range`). Against an older `@apso/crud` the rows are right but the result is the bare array with no total. A service still on `@nestjsx/crud` does not understand these queries: stay on `@apso/sdk` 1.4 for it.

| You write | Sent as |
|---|---|
| `select(['id','name'])` | `select=id,name` |
| `where({ status: 'active' })`, `{ $eq }` | `status=eq.active` |
| `$ne`, `$gt`, `$gte`, `$lt`, `$lte` | `neq`, `gt`, `gte`, `lt`, `lte` |
| `$cont`, `$starts`, `$ends`, `$excl` | `like.*x*`, `like.x*`, `like.*x`, `not.like.*x*` |
| `$contL`, `$startsL`, `$endsL`, `$exclL`, `$eqL`, `$neL` | the same with `ilike` |
| `$in`, `$notin`, `$notinL` | `in.(a,b)`, `not.in.(a,b)`, one `not.ilike` per value |
| `$isnull`, `$notnull`, a `null` value | `is.null`, `not.is.null` |
| `$between: [a, b]` | `gte.a` and `lte.b` |
| `or({ a: 1, b: 2 })` | `or=(a.eq.1,b.eq.2)` |
| `where(...)` together with `or(...)` | `or=(and(...filters),and(...ors))` |
| `join(['posts', 'posts.comments', 'author\|\|name'])` | `select=*,posts(*,comments(*)),author(name)` |
| `where({ 'posts.title': 'x' })` with `join(['posts'])` | `posts!inner(*)` and `posts.title=eq.x` (parents without a match are dropped, as before) |
| `orderBy({ age: 'DESC' })`, `orderBy({ 'author.name': 'ASC' })` | `order=age.desc`, `order=author(name).asc` |
| `limit(10).page(3)` | `limit=10&offset=20` |

Changes from 1.4:

- `findMany()` and `get()` on a list always return `{ data, count, total, page, pageCount }`. Before, a service without `alwaysPaginate` returned a bare array when no `page` or `offset` was sent.
- `page()` needs `limit()`. Without it the call throws, because PostgREST pages by offset.
- `$inL` and any operator not in the table throw. Before, an unknown operator was sent and the service compared for equality.
- `cache(true)` still caches in the client. The `cache=0` query parameter is no longer sent.
- In `like` and `ilike` patterns `*` is a wildcard, so a `*` in a `$cont` value matches anything.
- A filter or sort on `relation.column` needs the relation in `join()`. The service answers 400 otherwise.

## Supabase-style queries (PostgREST dialect)

`createClient(config).from(table)` mirrors the `@supabase/supabase-js` query builder.
It sends the Apso PostgREST dialect (`X-Crud-Dialect: postgrest`) and resolves to
`{ data, error, count, status, statusText }`. It never throws: HTTP, network, and
timeout failures come back on `error`.

```typescript
import { createClient } from '@apso/sdk';

const apso = createClient({ baseURL: 'https://api.example.com', apiKey: 'key' });

const { data, error } = await apso
  .from('posts')
  .select('id,title')
  .eq('published', true)
  .order('created_at', { ascending: false })
  .range(0, 9);
```

Reads use `select(columns, { count: 'exact' })`; writes use `insert`, `update`, `delete`.
Filters: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `is`, `in`, `not`,
`filter`, `match`, `or`. Modifiers: `order`, `limit`, `range`, `single`, `maybeSingle`.
`contains`, `containedBy`, `overlaps`, `textSearch`, and `upsert` are not in the Apso
dialect and throw a descriptive error.
