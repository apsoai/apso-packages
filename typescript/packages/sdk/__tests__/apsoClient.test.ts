import { ApsoClientFactory, QueryBuilder } from '../src/apsoClient';
import { entityParamsToPostgrest } from '../src/postgrest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';

// global.fetch = jest.fn(() =>
//   Promise.resolve({
//     ok: true,
//     json: () => Promise.resolve({ test: 100 }),
//   }),
// ) as jest.Mock;
describe('Apso SDK Client', () => {
  
  // jest.mock('axios');
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

  test('GET request with where and limit', async () => {
    mock.onGet('/HopperLoads?status=eq.active&limit=10').reply(200, { data: 'mockData' });

    const data = await client.entity('HopperLoads').where({ status: 'active' }).limit(10).get();
    expect(data).toEqual({ data: 'mockData' });
  });

  test('GET request with join and orderBy', async () => {
    mock.onGet('/HopperLoads?select=*%2CrelatedEntity%28*%29&order=created_at.asc').reply(200, { data: 'mockData' });

    const data = await client.entity('HopperLoads').join(['relatedEntity']).orderBy({ created_at: 'ASC' }).get();
    expect(data).toEqual({ data: 'mockData' });
  });

  test('POST request with data', async () => {
    mock.onPost('/HopperLoads', { name: 'New Load' }).reply(201, { data: 'createdData' });

    const data = await client.entity('HopperLoads').post({ name: 'New Load' });
    expect(data).toEqual({ data: 'createdData' });
  });

  test('PUT request with data', async () => {
    mock.onPut('/HopperLoads', { name: 'Updated Load' }).reply(200, { data: 'updatedData' });

    const data = await client.entity('HopperLoads').put({ name: 'Updated Load' });
    expect(data).toEqual({ data: 'updatedData' });
  });

  test('DELETE request', async () => {
    mock.onDelete('/HopperLoads').reply(200, { message: 'Deleted successfully' });

    const data = await client.entity('HopperLoads').delete();
    expect(data).toEqual({ message: 'Deleted successfully' });
  });

  test('GET request with offset and page', async () => {
    // offset wins over page; PostgREST has no page parameter.
    mock.onGet('/HopperLoads?offset=5').reply(200, { data: 'mockData' });

    const data = await client.entity('HopperLoads').offset(5).page(2).get();
    expect(data).toEqual({ data: 'mockData' });
  });

  //TODO: fix this test
  // test('GET request with select and cache', async () => {
  //   mock.onGet('/HopperLoads?fields=name,age&cache=true').reply(200, { data: 'mockData' });

  //   const data = await client.entity('HopperLoads').select(['name', 'age']).cache(true).get();
  //   expect(data).toEqual({ data: 'mockData' });
  // });

  // ============================================================================
  // Semantic Methods Tests
  // ============================================================================

  describe('Semantic CRUD Methods', () => {
    test('findMany() returns paginated data, with the total read from Content-Range', async () => {
      mock.onGet('/Product?status=eq.active&limit=20').reply((config) => {
        expect(config.headers?.['X-Crud-Dialect']).toBe('postgrest');
        expect(config.headers?.Prefer).toBe('count=exact');
        return [206, [{ id: 1, name: 'Product 1' }], { 'content-range': '0-0/100' }];
      });

      const result = await client.entity('Product').where({ status: 'active' }).limit(20).findMany();
      expect(result).toEqual({
        data: [{ id: 1, name: 'Product 1' }],
        count: 1,
        total: 100,
        page: 1,
        pageCount: 5
      });
    });

    test('findMany() page(n) becomes an offset and comes back as the page number', async () => {
      mock.onGet('/Product?limit=10&offset=20').reply(206, [{ id: 21 }], { 'content-range': '20-20/57' });
      const result = await client.entity('Product').limit(10).page(3).findMany();
      expect(result).toEqual({ data: [{ id: 21 }], count: 1, total: 57, page: 3, pageCount: 6 });
    });

    test('findMany() with no limit reads the page size from a partial default page', async () => {
      mock.onGet('/Product').reply(206, [{ id: 1 }, { id: 2 }], { 'content-range': '0-1/5' });
      const result = await client.entity('Product').findMany();
      expect(result).toEqual({ data: [{ id: 1 }, { id: 2 }], count: 2, total: 5, page: 1, pageCount: 3 });
    });

    test('page() without limit() is an error that says why', async () => {
      await expect(client.entity('Product').page(2).findMany()).rejects.toThrow('page() needs limit()');
    });

    test('a response without Content-Range is returned as it is', async () => {
      mock.onGet('/health').reply(200, ['a', 'b']);
      expect(await client.get('/health')).toEqual(['a', 'b']);
    });

    test('findOne() with id filter fetches single record', async () => {
      mock.onGet('/Product/123').reply(200, { id: 123, name: 'Product 123' });

      const record = await client.entity('Product').where({ id: '123' }).findOne();
      expect(record).toEqual({ id: 123, name: 'Product 123' });
    });

    test('findOne() with non-id filter uses limit=1', async () => {
      mock.onGet('/Product?status=eq.active&limit=1').reply(200, [{ id: 1, name: 'Active Product' }], {
        'content-range': '0-0/3',
      });

      const record = await client.entity('Product').where({ status: 'active' }).findOne();
      expect(record).toEqual({ id: 1, name: 'Active Product' });
    });

    test('findOne() by id keeps select and joins', async () => {
      mock.onGet('/Product/123?select=id%2Cname%2Cvendor%28*%29').reply(200, { id: 123, name: 'P', vendor: { id: 1 } });
      const record = await client.entity('Product').where({ id: '123' }).select(['id', 'name']).join(['vendor']).findOne();
      expect(record).toEqual({ id: 123, name: 'P', vendor: { id: 1 } });
    });

    test('create() posts new record', async () => {
      const newData = { name: 'New Product', price: 99.99 };
      mock.onPost('/Product', newData).reply(201, { id: 1, ...newData });

      const created = await client.entity('Product').create(newData);
      expect(created).toEqual({ id: 1, name: 'New Product', price: 99.99 });
    });

    test('update() with id filter updates record', async () => {
      const updateData = { name: 'Updated Product' };
      mock.onPut('/Product/123', updateData).reply(200, { id: 123, ...updateData });

      const updated = await client.entity('Product').where({ id: '123' }).update(updateData);
      expect(updated).toEqual({ id: 123, name: 'Updated Product' });
    });

    test('update() without id throws error', async () => {
      await expect(
        client.entity('Product').where({ status: 'active' }).update({ name: 'Test' })
      ).rejects.toThrow('ID is required for update');
    });

    test('remove() with id filter deletes record', async () => {
      mock.onDelete('/Product/123').reply(200, { success: true });

      const result = await client.entity('Product').where({ id: '123' }).remove();
      expect(result).toEqual({ success: true });
    });

    test('remove() without id throws error', async () => {
      await expect(
        client.entity('Product').where({ status: 'inactive' }).remove()
      ).rejects.toThrow('ID is required for delete');
    });
  });

  describe('query params as PostgREST', () => {
    const qs = (params: any) => decodeURIComponent(entityParamsToPostgrest(params).toString());

    test.each([
      [{ filter: { status: 'active' } }, 'status=eq.active'],
      [{ filter: { deletedAt: null } }, 'deletedAt=is.null'],
      [{ filter: { age: { $gte: 18, $lt: 65 } } }, 'age=gte.18&age=lt.65'],
      [{ filter: { age: { $between: [18, 65] } } }, 'age=gte.18&age=lte.65'],
      [{ filter: { name: { $cont: 'ada' } } }, 'name=like.*ada*'],
      [{ filter: { name: { $startsL: 'ada' } } }, 'name=ilike.ada*'],
      [{ filter: { name: { $excl: 'x' } } }, 'name=not.like.*x*'],
      [{ filter: { name: { $eqL: 'Ada' } } }, 'name=ilike.Ada'],
      [{ filter: { plan: { $in: ['Pro', 'Team, Large'] } } }, 'plan=in.(Pro,"Team,+Large")'],
      [{ filter: { plan: { $notin: ['Pro', 'Team'] } } }, 'plan=not.in.(Pro,Team)'],
      [{ filter: { email: { $isnull: true } } }, 'email=is.null'],
      [{ filter: { email: { $notnull: true } } }, 'email=not.is.null'],
      [{ fields: ['id', 'name'] }, 'select=id,name'],
      [{ join: ['posts', 'posts.comments', 'author||name'] }, 'select=*,posts(*,comments(*)),author(name)'],
      [{ fields: ['id'], join: ['posts'], filter: { 'posts.title': 'x' } }, 'select=id,posts!inner(*)&posts.title=eq.x'],
      [{ sort: { age: 'DESC', name: 'ASC' } }, 'order=age.desc,name.asc'],
      [{ join: ['author'], sort: { 'author.name': 'DESC' } }, 'select=*,author(*)&order=author(name).desc'],
      [{ limit: 10, page: 3 }, 'limit=10&offset=20'],
      [{ or: { status: 'a', kind: 'b' } }, 'or=(status.eq.a,kind.eq.b)'],
      [{ filter: { a: 1 }, or: { name: 'Doe, Jane' } }, 'or=(and(a.eq.1),and(name.eq."Doe,+Jane"))'],
      [{ cache: true }, ''],
    ] as Array<[any, string]>)('%j', (params, expected) => {
      expect(qs(params)).toBe(expected);
    });

    test('an operator with no PostgREST form is an error, not a dropped filter', () => {
      expect(() => entityParamsToPostgrest({ filter: { name: { $inL: ['a'] } } })).toThrow("Operator '$inL' on 'name'");
      expect(() => entityParamsToPostgrest({ filter: { name: { $regex: 'a' } } })).toThrow("Operator '$regex'");
    });
  });
});
