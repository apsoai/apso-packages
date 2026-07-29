import { ApsoClientFactory, QueryBuilder } from '../src/apsoClient';
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
    mock.onGet('/HopperLoads?filter=status||$eq||active&limit=10').reply(200, { data: 'mockData' });

    const data = await client.entity('HopperLoads').where({ status: 'active' }).limit(10).get();
    expect(data).toEqual({ data: 'mockData' });
  });

  test('GET request with join and orderBy', async () => {
    mock.onGet('/HopperLoads?join=relatedEntity&sort=created_at,ASC').reply(200, { data: 'mockData' });

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
    mock.onGet('/HopperLoads?offset=5&page=2').reply(200, { data: 'mockData' });

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
    test('findMany() returns paginated data', async () => {
      mock.onGet('/Product?filter=status||$eq||active&limit=20').reply(200, {
        data: [{ id: 1, name: 'Product 1' }],
        total: 100,
        page: 1,
        pageCount: 5
      });

      const result = await client.entity('Product').where({ status: 'active' }).limit(20).findMany();
      expect(result).toEqual({
        data: [{ id: 1, name: 'Product 1' }],
        total: 100,
        page: 1,
        pageCount: 5
      });
    });

    test('findOne() with id filter fetches single record', async () => {
      mock.onGet('/Product/123').reply(200, { id: 123, name: 'Product 123' });

      const record = await client.entity('Product').where({ id: '123' }).findOne();
      expect(record).toEqual({ id: 123, name: 'Product 123' });
    });

    test('findOne() with non-id filter uses limit=1', async () => {
      mock.onGet('/Product?filter=status||$eq||active&limit=1').reply(200, {
        data: [{ id: 1, name: 'Active Product' }]
      });

      const record = await client.entity('Product').where({ status: 'active' }).findOne();
      expect(record).toEqual({ id: 1, name: 'Active Product' });
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
});
