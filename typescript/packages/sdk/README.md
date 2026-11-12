# Apso SDK

A TypeScript SDK for interacting with Apso services via their OpenAPI-compliant CRUD API.

> This package lives in the `apso-packages` monorepo at `typescript/packages/sdk`.
> It builds, tests, and publishes via the monorepo's auto-release pipeline and
> uses `@apso/crud-request` (a workspace package) to build queries. Commit history
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
import { ApsoClientFactory, QueryBuilder } from '@apso/sdk';

const config = {
  baseURL: 'https://api.apso-service.com',
  apiKey: 'your-api-key'
};

const client = ApsoClientFactory.getClient(config);

const activeUsers = await client.entity('users')
  .where({ status: { $eq: 'active' } })
  .limit(10)
  .get();

// Advanced Query Example (NestJS CRUD compatible)
const filtered = await client.entity('WorkspaceServices')
  .where({ status: { $eq: 'Active' }, build_status: { $eq: 'Ready' } })
  .orderBy({ created_at: 'DESC' })
  .limit(10)
  .page(1)
  .cache(true)
  .get();
// This produces:
// /WorkspaceServices?filter=status||$eq||Active&filter=build_status||$eq||Ready&sort=created_at,DESC&limit=10&page=1&cache=0

// You can also use the low-level API:
const response = await client.get('/WorkspaceServices', {
  filter: {
    status: { $eq: 'Active' },
    build_status: { $eq: 'Ready' }
  },
  sort: { created_at: 'DESC' },
  limit: 10,
  page: 1,
  cache: true
});

// This will generate a standards-compliant query string for NestJS CRUD APIs.
```

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

## Test Examples

Here are some Jest test examples for the SDK:

```typescript
import { ApsoClientFactory } from '@apso/sdk';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';

describe('Apso SDK Client', () => {
  const config = {
    baseURL: 'https://api.example.com',
    apiKey: 'test-api-key',
    client: 'axios' as const
  };
  const client = ApsoClientFactory.getClient(config);
  const mock = new MockAdapter(axios);

  afterEach(() => {
    mock.reset();
  });

  test('GET with filter and limit', async () => {
    mock.onGet('/HopperLoads?filter=status||$eq||active&limit=10').reply(200, { data: 'mockData' });
    const data = await client.entity('HopperLoads').where({ status: { $eq: 'active' } }).limit(10).get();
    expect(data).toEqual({ data: 'mockData' });
  });

  test('GET with join and sort', async () => {
    mock.onGet('/HopperLoads?join=relatedEntity&sort=created_at,ASC').reply(200, { data: 'mockData' });
    const data = await client.entity('HopperLoads').join(['relatedEntity']).orderBy({ created_at: 'ASC' }).get();
    expect(data).toEqual({ data: 'mockData' });
  });

  test('POST with data', async () => {
    mock.onPost('/HopperLoads', { name: 'New Load' }).reply(201, { data: 'createdData' });
    const data = await client.entity('HopperLoads').post({ name: 'New Load' });
    expect(data).toEqual({ data: 'createdData' });
  });

  test('PUT with data', async () => {
    mock.onPut('/HopperLoads', { name: 'Updated Load' }).reply(200, { data: 'updatedData' });
    const data = await client.entity('HopperLoads').put({ name: 'Updated Load' });
    expect(data).toEqual({ data: 'updatedData' });
  });

  test('DELETE', async () => {
    mock.onDelete('/HopperLoads').reply(200, { message: 'Deleted successfully' });
    const data = await client.entity('HopperLoads').delete();
    expect(data).toEqual({ message: 'Deleted successfully' });
  });

  test('GET with offset and page', async () => {
    mock.onGet('/HopperLoads?offset=5&page=2').reply(200, { data: 'mockData' });
    const data = await client.entity('HopperLoads').offset(5).page(2).get();
    expect(data).toEqual({ data: 'mockData' });
  });

  test('GET with select and cache', async () => {
    mock.onGet('/HopperLoads?fields=name,age&cache=0').reply(200, { data: 'mockData' });
    const data = await client.entity('HopperLoads').select(['name', 'age']).cache(true).get();
    expect(data).toEqual({ data: 'mockData' });
  });
});
```
