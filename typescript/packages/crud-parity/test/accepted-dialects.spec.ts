/**
 * Accepted dialects (`dialects` option on @Crud, setAcceptedDialects app-wide).
 * Phase 1 of "generated services accept the PostgREST query syntax only"
 * (apsoai/cli), ahead of removing nestjsx from the library
 * (apsoai/apso-packages#80).
 *
 * Runs real HTTP requests against the @apso app: one controller that accepts
 * PostgREST only, next to the unchanged /posts controller that accepts both.
 */
import 'reflect-metadata';
import { Controller, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Crud, CrudAuth, setAcceptedDialects } from '@apso/crud';
import { ApPostController, ApPostService, ApScopedPostController } from '../src/app-apso';
import { POST_CRUD_QUERY, SCOPED_AUTH } from '../src/crud-config';
import { createSeededDataSource } from '../src/datasource';
import { ALL_ENTITIES, Post } from '../src/entities';

jest.setTimeout(180000);

@Crud({ model: { type: Post }, query: POST_CRUD_QUERY, dialects: ['postgrest'] })
@Controller('pg-posts')
class PgOnlyPostController {
  constructor(public service: ApPostService) {}
}

// Tenant-scoped and PostgREST only: the scope must hold whatever is refused.
@Crud({ model: { type: Post }, query: POST_CRUD_QUERY, dialects: ['postgrest'] })
@CrudAuth(SCOPED_AUTH)
@Controller('pg-scoped-posts')
class PgOnlyScopedPostController {
  constructor(public service: ApPostService) {}
}

let app: INestApplication;
let ds: DataSource;
const get = (path: string, headers: Record<string, string> = {}) =>
  request(app.getHttpServer()).get(path).set(headers);
const ids = (body: any): number[] => (Array.isArray(body) ? body : body?.data ?? []).map((r: any) => r.id);

beforeAll(async () => {
  ds = await createSeededDataSource('dialects');
  @Module({
    imports: [
      TypeOrmModule.forRootAsync({ useFactory: () => ({}) as any, dataSourceFactory: async () => ds }),
      TypeOrmModule.forFeature(ALL_ENTITIES),
    ],
    controllers: [ApPostController, ApScopedPostController, PgOnlyPostController, PgOnlyScopedPostController],
    providers: [ApPostService],
  })
  class DialectsModule {}
  const mod = await Test.createTestingModule({ imports: [DialectsModule] }).compile();
  app = mod.createNestApplication();
  await app.init();
});

afterAll(async () => {
  setAcceptedDialects();
  for (const c of [() => app?.close(), () => ds?.destroy()]) {
    try {
      await c();
    } catch {
      // shared-pglite teardown noise
    }
  }
});

describe("dialects: ['postgrest'] on a controller", () => {
  it('parses PostgREST and echoes the dialect', async () => {
    const res = await get('/pg-posts?views=eq.250&order=id.asc');
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([2, 5]);
    expect(res.headers['x-crud-dialect']).toBe('postgrest');
  });

  it('skips detection: no params, and limit alone, are PostgREST (bare array)', async () => {
    for (const path of ['/pg-posts', '/pg-posts?limit=2']) {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.headers['x-crud-dialect']).toBe('postgrest');
      expect(Array.isArray(res.body)).toBe(true);
    }
    // The both-dialects controller still reads the same requests as nestjsx.
    expect((await get('/posts?limit=2')).headers['x-crud-dialect']).toBe('nestjsx');
  });

  it.each([
    ['fields=id,title', 'fields', 'select'],
    ['filter=views||$eq||250', 'filter', 'age=gt.30'],
    ['filter=views||$eq||250&filter=published||$eq||true', 'filter', 'age=gt.30'],
    ['or=views||$eq||250', 'or', 'or=('],
    ['join=author', 'join', 'select=*,posts(title)'],
    ['sort=views,DESC', 'sort', 'order=age.desc'],
    [`s=${encodeURIComponent('{"views":250}')}`, 's', 'and=('],
    ['per_page=2', 'per_page', 'limit'],
    ['limit=2&page=2', 'page', 'offset'],
    ['cache=0', 'cache', 'no cache parameter'],
  ])('400 for nestjsx ?%s, naming the parameter and the PostgREST equivalent', async (query, param, hint) => {
    const res = await get(`/pg-posts?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain(`'${param}' query parameter is nestjsx syntax`);
    expect(res.body.message).toContain(hint);
    // The same request is still served by the controller that accepts both.
    expect((await get(`/posts?${query}`)).status).toBe(200);
  });

  it('400 for a nestjsx parameter next to PostgREST ones, and with the postgrest header', async () => {
    expect((await get('/pg-posts?select=id&filter=views||$eq||250')).status).toBe(400);
    expect((await get('/pg-posts?filter=views||$eq||250', { 'X-Crud-Dialect': 'postgrest' })).status).toBe(400);
  });

  it('400 for X-Crud-Dialect: nestjsx; postgrest is accepted; anything else stays a 400', async () => {
    const nx = await get('/pg-posts', { 'X-Crud-Dialect': 'nestjsx' });
    expect(nx.status).toBe(400);
    expect(nx.body.message).toContain("X-Crud-Dialect 'nestjsx' is not accepted");
    expect((await get('/pg-posts', { 'X-Crud-Dialect': 'postgrest' })).status).toBe(200);
    expect((await get('/pg-posts', { 'X-Crud-Dialect': 'graphql' })).status).toBe(400);
    expect((await get('/posts', { 'X-Crud-Dialect': 'nestjsx' })).status).toBe(200);
  });

  it('a read by id follows the same rules', async () => {
    expect((await get('/pg-posts/1')).status).toBe(200);
    expect((await get('/pg-posts/1?join=author')).status).toBe(400);
    expect((await get('/pg-posts/1', { 'X-Crud-Dialect': 'nestjsx' })).status).toBe(400);
  });

  it('PostgREST or=(...) is not mistaken for the nestjsx or parameter', async () => {
    const res = await get('/pg-posts?or=(views.eq.250,views.eq.999)&order=id.asc');
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([2, 3, 5]);
  });

  it('the auth scope holds: same rows as the both-dialects scoped controller, nestjsx widening refused', async () => {
    const both = await get('/scoped-posts?order=id.asc', { 'X-Crud-Dialect': 'postgrest' });
    const only = await get('/pg-scoped-posts?order=id.asc');
    expect(only.status).toBe(200);
    expect(ids(only.body)).toEqual(ids(both.body));
    expect(ids(only.body).length).toBeGreaterThan(0);
    for (const widen of ['or=authorId||$ne||1', `s=${encodeURIComponent('{"authorId":{"$ne":1}}')}`, 'filter=authorId||$ne||1']) {
      expect((await get(`/pg-scoped-posts?${widen}`)).status).toBe(400);
    }
    const pgWiden = await get('/pg-scoped-posts?or=(authorId.neq.1,authorId.eq.1)&order=id.asc');
    expect(ids(pgWiden.body)).toEqual(ids(both.body));
  });
});

describe('gaps closed in @apso/postgrest-request, end to end', () => {
  it('is.not_null', async () => {
    const a = await get('/pg-posts?body=is.not_null&order=id.asc');
    const b = await get('/pg-posts?body=not.is.null&order=id.asc');
    expect(a.status).toBe(200);
    expect(ids(a.body)).toEqual(ids(b.body));
    expect(ids(a.body)).toEqual([1, 3, 4, 5]);
  });
  it('not.gt / not.lte', async () => {
    expect(ids((await get('/pg-posts?views=not.gt.100&order=id.asc')).body)).toEqual([1, 4, 6]);
    expect(ids((await get('/pg-posts?views=not.lte.100&order=id.asc')).body)).toEqual([2, 3, 5]);
  });
  it('a negated condition inside or=()', async () => {
    expect(ids((await get('/pg-posts?or=(views.not.gte.100,views.eq.999)&order=id.asc')).body)).toEqual([3, 4, 6]);
  });
  it('a quoted value with a comma inside or=()', async () => {
    const title = (await get('/pg-posts/1')).body.title as string;
    const res = await get(`/pg-posts?or=(title.eq."${encodeURIComponent(title)}",title.eq."no, such (title)")&order=id.asc`);
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([1]);
  });
});

describe('setAcceptedDialects (app-wide default)', () => {
  afterEach(() => setAcceptedDialects());

  it("['postgrest'] applies to a controller with no dialects option, and resets", async () => {
    expect((await get('/posts?filter=views||$eq||250')).status).toBe(200);
    setAcceptedDialects(['postgrest']);
    const refused = await get('/posts?filter=views||$eq||250');
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain("'filter' query parameter is nestjsx syntax");
    expect((await get('/posts', { 'X-Crud-Dialect': 'nestjsx' })).status).toBe(400);
    expect((await get('/posts')).headers['x-crud-dialect']).toBe('postgrest');
    setAcceptedDialects();
    expect((await get('/posts?filter=views||$eq||250')).status).toBe(200);
  });
});
