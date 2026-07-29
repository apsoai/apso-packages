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
