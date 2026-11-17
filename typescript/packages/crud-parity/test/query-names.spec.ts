/**
 * Two rules for what a request's query string can do, checked with real HTTP
 * requests against the @apso app in both query syntaxes:
 *
 *  1. A query may only name the entity's own columns (and the columns of a
 *     relation it joins). Any other name in a filter, a search, a sort or an
 *     embed is a 400.
 *  2. A request for one row (/posts/3) always acts on that row. Conditions in
 *     the query can narrow it to nothing (404); they never pick another row.
 *
 * Rule 1 is an intended difference from @nestjsx/crud 4.5.0, which answers an
 * unknown column with a 500 from the database. The two matrix cases that
 * compared that answer (unknown filter field, unknown sort field) live here.
 */
import 'reflect-metadata';
import { Controller, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Crud, CrudAuth } from '@apso/crud';
import { ApPostController, ApPostService, ApScopedPostController } from '../src/app-apso';
import { POST_CRUD_QUERY, SCOPED_AUTH } from '../src/crud-config';
import { createSeededDataSource } from '../src/datasource';
import { ALL_ENTITIES, Post } from '../src/entities';

jest.setTimeout(180000);

@Crud({ model: { type: Post }, query: POST_CRUD_QUERY, dialects: ['postgrest'] })
@Controller('pg-posts')
class PgPostController {
  constructor(public service: ApPostService) {}
}

// Reads and writes limited to authorId=1, PostgREST syntax only.
@Crud({ model: { type: Post }, query: POST_CRUD_QUERY, dialects: ['postgrest'] })
@CrudAuth(SCOPED_AUTH)
@Controller('pg-scoped-posts')
class PgScopedPostController {
  constructor(public service: ApPostService) {}
}

let app: INestApplication;
let ds: DataSource;
const http = () => request(app.getHttpServer());
const enc = encodeURIComponent;
const ids = (body: any): number[] => (Array.isArray(body) ? body : body?.data ?? []).map((r: any) => r.id);
const titleOf = async (id: number) => (await ds.getRepository(Post).findOneBy({ id }))?.title;

beforeAll(async () => {
  ds = await createSeededDataSource('querynames');
  @Module({
    imports: [
      TypeOrmModule.forRootAsync({ useFactory: () => ({}) as any, dataSourceFactory: async () => ds }),
      TypeOrmModule.forFeature(ALL_ENTITIES),
    ],
    controllers: [ApPostController, ApScopedPostController, PgPostController, PgScopedPostController],
    providers: [ApPostService],
  })
  class QueryNamesModule {}
  const mod = await Test.createTestingModule({ imports: [QueryNamesModule] }).compile();
  app = mod.createNestApplication();
  // Listen on the loopback address itself, so no other local server that
  // holds the same port number on 127.0.0.1 can answer these requests.
  await app.listen(0, '127.0.0.1');
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

// Names that are not columns of Post: a misspelling, names with a space or
// punctuation, a column of another alias, and a relation that is not joined.
const NOT_COLUMNS = ['nonexistent', 'no such column', 'views)', 'views = views', 'entity.nonexistent', 'author.name'];

describe("a query may only name the entity's own columns: nestjsx syntax", () => {
  it.each(NOT_COLUMNS)('400 for a filter, a search, an or and a sort on %j', async (name) => {
    for (const query of [
      `filter=${enc(`${name}||$eq||1`)}`,
      `s=${enc(JSON.stringify({ [name]: 1 }))}`,
      `s=${enc(JSON.stringify({ $or: [{ views: 100 }, { [name]: { $gt: 0 } }] }))}`,
      `filter=${enc('views||$eq||100')}&or=${enc(`${name}||$eq||1`)}`,
      `sort=${enc(`${name},ASC`)}`,
    ]) {
      for (const route of ['/posts', '/scoped-posts']) {
        const res = await http().get(`${route}?${query}`);
        expect({ query, route, status: res.status }).toEqual({ query, route, status: 400 });
        expect(res.body.message).toBe(`Unknown column '${name}' in query`);
      }
    }
  });

  it('still reads columns by name, and a joined relation by path or alias', async () => {
    expect(ids((await http().get('/posts?filter=views||$eq||250&sort=id,ASC')).body)).toEqual([2, 5]);
    expect(ids((await http().get(`/posts?s=${enc('{"entity.views":250}')}&sort=entity.id,DESC`)).body)).toEqual([5, 2]);
    expect(ids((await http().get(`/posts?join=author&filter=${enc('author.name||$eq||Ada Lovelace')}&sort=author.name,ASC&sort=id,ASC`)).body)).toEqual([1, 4]);
    expect(ids((await http().get(`/posts?join=author&join=author.profile&filter=${enc('author.profile.bio||$cont||COBOL')}&sort=id,ASC`)).body)).toEqual([2, 5]);
  });

  it('a join that asks for a field the relation does not have returns the ones it has', async () => {
    const res = await http().get('/posts?join=author||name,nonexistent&sort=id,ASC&limit=1');
    expect(res.status).toBe(200);
    expect(res.body[0].author).toEqual({ id: 1, name: 'Ada Lovelace' });
  });

  it('a controller limited to one author answers the same 400, and never another author\'s rows', async () => {
    const res = await http().get(`/scoped-posts?s=${enc(JSON.stringify({ $or: [{ 'no such column': 1 }, { authorId: 2 }] }))}`);
    expect(res.status).toBe(400);
    expect(ids((await http().get('/scoped-posts?sort=id,ASC')).body)).toEqual([1, 4]);
  });
});

describe("a query may only name the entity's own columns: PostgREST syntax", () => {
  // A dotted name is read as relation.column, so those are covered below.
  it.each(NOT_COLUMNS.filter((n) => !n.includes('.')))('400 for a filter, an or=, an and= and an order on %j', async (name) => {
    for (const query of [
      `${enc(name)}=eq.1`,
      `or=${enc(`(views.eq.100,${name}.gt.0)`)}`,
      `and=${enc(`(${name}.eq.1)`)}`,
      `order=${enc(name)}`,
    ]) {
      for (const route of ['/pg-posts', '/pg-scoped-posts']) {
        const res = await http().get(`${route}?${query}`);
        expect({ query, route, status: res.status }).toEqual({ query, route, status: 400 });
      }
    }
  });

  it('400 for a filter on a column the embedded relation does not have', async () => {
    for (const name of ['nonexistent', 'no such column', 'likes)']) {
      const res = await http().get(`/pg-posts?select=${enc('*,comments(*)')}&${enc(`comments.${name}`)}=eq.1`);
      expect({ name, status: res.status }).toEqual({ name, status: 400 });
    }
    // Inner embeds put the filter on the parent rows; the rule is the same.
    const inner = await http().get(`/pg-posts?select=${enc('*,comments!inner(*)')}&${enc('comments.no such column')}=eq.1`);
    expect(inner.status).toBe(400);
  });

  it('still filters, orders and embeds by real names', async () => {
    const res = await http().get(`/pg-posts?views=eq.250&or=${enc('(published.is.true,title.like.Comp*)')}&order=id.desc&select=${enc('id,title,comments(text)')}&comments.likes=gte.5`);
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([5, 2]);
    expect(ids((await http().get('/pg-scoped-posts?order=id.asc')).body)).toEqual([1, 4]);
  });
});

describe('a request for one row always acts on that row', () => {
  it('GET with a condition on another id answers 404 in both syntaxes', async () => {
    expect((await http().get(`/posts/1?s=${enc('{"id":2}')}`)).status).toBe(404);
    expect((await http().get(`/posts/1?filter=${enc('id||$eq||2')}`)).status).toBe(404);
    expect((await http().get('/pg-posts/1?id=eq.2')).status).toBe(404);
    expect((await http().get(`/pg-posts/1?or=${enc('(id.eq.2,id.eq.3)')}`)).status).toBe(404);
    // A condition the row meets still finds it.
    expect((await http().get('/pg-posts/1?views=eq.100')).body.id).toBe(1);
  });

  it('PATCH and PUT with a condition on another id change nothing', async () => {
    for (const [route, query] of [
      ['/posts/1', `s=${enc('{"id":2}')}`],
      ['/pg-posts/1', 'id=eq.2'],
      ['/pg-scoped-posts/1', 'id=eq.2'],
    ]) {
      expect((await http().patch(`${route}?${query}`).send({ title: 'changed' })).status).toBe(404);
      expect((await http().put(`${route}?${query}`).send({ title: 'changed', views: 1, published: true, authorId: 1, score: '1.00' })).status).toBe(404);
    }
    expect(await titleOf(1)).toBe('Notes on the Engine');
    expect(await titleOf(2)).toBe('Bugs and Moths');
  });

  it('DELETE with a condition on another id deletes nothing', async () => {
    for (const [route, query] of [
      ['/posts/5', `s=${enc('{"id":6}')}`],
      ['/pg-posts/5', 'id=eq.6'],
      ['/pg-scoped-posts/1', 'id=eq.2'],
    ]) {
      expect((await http().delete(`${route}?${query}`)).status).toBe(404);
    }
    expect(await ds.getRepository(Post).count()).toBe(6);
  });
});
