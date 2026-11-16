/**
 * @apso/sdk entity()/get() and from() against a real @Crud app on Postgres,
 * over HTTP: the queries are PostgREST and the total comes from Content-Range
 * (apsoai/cli#226).
 *
 * The SDK change lives in its own PR. Until both are on the same branch this
 * file skips.
 */
import 'reflect-metadata';
import { AddressInfo } from 'net';
import { Controller, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Crud, CrudAuth } from '@apso/crud';
import { ApPostService } from '../src/app-apso';
import { POST_CRUD_QUERY, SCOPED_AUTH } from '../src/crud-config';
import { createSeededDataSource } from '../src/datasource';
import { ALL_ENTITIES, Post } from '../src/entities';

jest.setTimeout(180000);

// require, not import: the SDK is type-checked by its own tsconfig (it needs the DOM lib).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sdk = require('@apso/sdk');
const ready = typeof sdk.entityParamsToPostgrest === 'function';
// What a generated controller sets.
const QUERY = { ...POST_CRUD_QUERY, limit: 5, alwaysPaginate: true };

@Crud({ model: { type: Post }, query: QUERY, dialects: ['postgrest'] })
@Controller('posts')
class PostController {
  constructor(public service: ApPostService) {}
}

@Crud({ model: { type: Post }, query: QUERY, dialects: ['postgrest'] })
@CrudAuth(SCOPED_AUTH)
@Controller('my-posts')
class ScopedPostController {
  constructor(public service: ApPostService) {}
}

// Accepts both dialects, as a service does before it is switched over.
@Crud({ model: { type: Post }, query: QUERY })
@Controller('both-posts')
class BothDialectsPostController {
  constructor(public service: ApPostService) {}
}

(ready ? describe : describe.skip)('@apso/sdk against a PostgREST service', () => {
  let app: INestApplication;
  let ds: DataSource;
  let client: any;
  let axiosClient: any;

  beforeAll(async () => {
    ds = await createSeededDataSource('sdk');
    @Module({
      imports: [
        TypeOrmModule.forRootAsync({ useFactory: () => ({}) as any, dataSourceFactory: async () => ds }),
        TypeOrmModule.forFeature(ALL_ENTITIES),
      ],
      controllers: [PostController, ScopedPostController, BothDialectsPostController],
      providers: [ApPostService],
    })
    class SdkModule {}
    const mod = await Test.createTestingModule({ imports: [SdkModule] }).compile();
    app = mod.createNestApplication();
    await app.listen(0, '127.0.0.1');
    const baseURL = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    client = new sdk.ApsoClient({ baseURL, apiKey: 'k', client: 'fetch' });
    axiosClient = new sdk.ApsoClient({ baseURL, apiKey: 'k', client: 'axios' });
  });

  afterAll(async () => {
    for (const c of [() => app?.close(), () => ds?.destroy()]) {
      try {
        await c();
      } catch {
        // shared-pglite teardown noise
      }
    }
  });

  const show = (label: string, value: unknown) => {
    // eslint-disable-next-line no-console
    console.log(`SDK ${label}\n -> ${JSON.stringify(value)}`);
    return value as any;
  };
  const ids = (page: any) => page.data.map((r: any) => r.id);

  it.each(['fetch', 'axios'])('findMany() returns the page envelope with the total (%s)', async (kind) => {
    const c = kind === 'fetch' ? client : axiosClient;
    const page = show(
      `entity('posts').select(['id','views']).where({views:{$gte:100}}).orderBy({id:'ASC'}).limit(2).findMany() [${kind}]`,
      await c.entity('posts').select(['id', 'views']).where({ views: { $gte: 100 } }).orderBy({ id: 'ASC' }).limit(2).findMany(),
    );
    expect(page).toEqual({ data: [{ id: 1, views: 100 }, { id: 2, views: 250 }], count: 2, total: 4, page: 1, pageCount: 2 });
  });

  it('page(2) is the second page', async () => {
    const page = show(
      "entity('posts').where({views:{$gte:100}}).orderBy({id:'ASC'}).limit(2).page(2).findMany()",
      await client.entity('posts').select(['id']).where({ views: { $gte: 100 } }).orderBy({ id: 'ASC' }).limit(2).page(2).findMany(),
    );
    expect(ids(page)).toEqual([3, 5]);
    expect(page).toMatchObject({ count: 2, total: 4, page: 2, pageCount: 2 });
  });

  it('no limit: the default page, with the real total and page count', async () => {
    const page = show("entity('posts').select(['id']).orderBy({id:'ASC'}).findMany()", await client.entity('posts').select(['id']).orderBy({ id: 'ASC' }).findMany());
    expect(ids(page)).toEqual([1, 2, 3, 4, 5]);
    expect(page).toMatchObject({ count: 5, total: 6, page: 1, pageCount: 2 });
  });

  it('join, a filter on the joined column, and a sort on it', async () => {
    const page = show(
      "entity('posts').select(['id']).join(['author||name']).where({'author.name':'Ada Lovelace'}).orderBy({id:'DESC'}).findMany()",
      await client.entity('posts').select(['id']).join(['author||name']).where({ 'author.name': 'Ada Lovelace' }).orderBy({ id: 'DESC' }).findMany(),
    );
    expect(page.data).toEqual([
      { id: 4, author: { id: 1, name: 'Ada Lovelace' } },
      { id: 1, author: { id: 1, name: 'Ada Lovelace' } },
    ]);
    expect(page.total).toBe(2);

    const sorted = await client.entity('posts').select(['id']).join(['author']).orderBy({ 'author.name': 'DESC' }).limit(2).findMany();
    expect(sorted.data.map((r: any) => r.author.name)).toEqual(['alan turing', 'alan turing']);
  });

  it('or, operators and nested joins', async () => {
    const either = await client.entity('posts').select(['id']).or({ views: 100, title: { $contL: 'moths' } }).orderBy({ id: 'ASC' }).findMany();
    expect(ids(either)).toEqual([1, 2]);
    const both = await client.entity('posts').select(['id']).where({ published: true }).or({ views: 10 }).orderBy({ id: 'ASC' }).limit(10).findMany();
    expect(ids(both)).toEqual([1, 2, 3, 4, 6]);
    const between = await client.entity('posts').select(['id']).where({ views: { $between: [100, 250] }, body: { $notnull: true } }).orderBy({ id: 'ASC' }).findMany();
    expect(ids(between)).toEqual([1, 5]);
    const nested = await client.entity('posts').select(['id']).join(['author', 'author.profile||bio']).where({ id: { $in: [1] } }).findMany();
    expect(nested.data[0].author.profile).toEqual({ id: 1, bio: 'First programmer' });
  });

  it('findOne() by id and by filter', async () => {
    const byId = show("entity('posts').where({id:1}).select(['id','title']).join(['author||name']).findOne()", await client.entity('posts').where({ id: 1 }).select(['id', 'title']).join(['author||name']).findOne());
    expect(byId).toEqual({ id: 1, title: 'Notes on the Engine', author: { id: 1, name: 'Ada Lovelace' } });
    const byFilter = await client.entity('posts').select(['id']).where({ views: 999 }).findOne();
    expect(byFilter).toEqual({ id: 3 });
  });

  it('the total is the scoped total', async () => {
    const page = show("entity('my-posts').select(['id']).limit(1).findMany() (scope: authorId=1)", await client.entity('my-posts').select(['id']).orderBy({ id: 'ASC' }).limit(1).findMany());
    expect(page).toEqual({ data: [{ id: 1 }], count: 1, total: 2, page: 1, pageCount: 2 });
  });

  it('a controller that still accepts both dialects answers the same', async () => {
    const page = await client.entity('both-posts').select(['id']).where({ views: { $gte: 100 } }).orderBy({ id: 'ASC' }).limit(2).findMany();
    expect(page).toEqual({ data: [{ id: 1 }, { id: 2 }], count: 2, total: 4, page: 1, pageCount: 2 });
    const empty = await client.entity('both-posts').findMany();
    expect(empty.total).toBe(6);
  });

  it('from() with count: exact gets a count', async () => {
    const res = show("from('posts').select('id',{count:'exact'}).gte('views',100).order('id').range(0,1)", await client.from('posts').select('id', { count: 'exact' }).gte('views', 100).order('id').range(0, 1));
    expect(res.error).toBeNull();
    expect(res.status).toBe(206);
    expect(res.count).toBe(4);
    expect(res.data).toEqual([{ id: 1 }, { id: 2 }]);
    const plain = await client.from('posts').select('id').limit(2);
    expect(plain.count).toBeNull();
  });

  it('a mistake is an error, not a wrong page', async () => {
    await expect(client.entity('posts').join(['nope']).findMany()).rejects.toThrow('400');
  });
});
