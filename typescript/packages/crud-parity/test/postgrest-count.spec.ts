/**
 * PostgREST counts, paging headers, refusals and OpenAPI parameters
 * (apsoai/cli#226, the library-side blockers for TypeScript).
 *
 * Every case is a real HTTP request against a Nest app on Postgres (pglite).
 * Behaviour follows
 * https://docs.postgrest.org/en/v16/references/api/pagination_count.html
 * (fetched 2026-11-11). Seed: 6 posts (authorId 1 owns posts 1 and 4; posts
 * 1, 2, 3, 6 are published; views > 100 on posts 2, 3, 5), 12 comments,
 * 4 categories of which 'unused' (id 4) has no post.
 */
import 'reflect-metadata';
import { Controller, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource, Repository } from 'typeorm';
import { Crud, CrudAuth, setAcceptedDialects } from '@apso/crud';
import { TypeOrmCrudService } from '@apso/crud-typeorm';
import { ApPostController, ApPostService } from '../src/app-apso';
import { POST_CRUD_QUERY, SCOPED_AUTH } from '../src/crud-config';
import { createSeededDataSource } from '../src/datasource';
import { ALL_ENTITIES, Category, Post } from '../src/entities';

jest.setTimeout(180000);

// limit: 5 is what generated TypeScript controllers set.
const QUERY = { ...POST_CRUD_QUERY, limit: 5 };

@Crud({ model: { type: Post }, query: QUERY, dialects: ['postgrest'] })
@Controller('pg-posts')
class PgPostController {
  constructor(public service: ApPostService) {}
}

@Crud({ model: { type: Post }, query: QUERY, dialects: ['postgrest'] })
@CrudAuth(SCOPED_AUTH)
@Controller('pg-scoped-posts')
class PgScopedPostController {
  constructor(public service: ApPostService) {}
}

// A controller-level filter that always applies (how a soft filter is declared).
@Crud({ model: { type: Post }, query: { ...QUERY, filter: { published: true } }, dialects: ['postgrest'] })
@Controller('pg-published')
class PgPublishedPostController {
  constructor(public service: ApPostService) {}
}

// The generated template sets alwaysPaginate; PostgREST must still answer a bare array.
@Crud({ model: { type: Post }, query: { ...QUERY, alwaysPaginate: true, exclude: ['body'] }, dialects: ['postgrest'] })
@Controller('pg-envelope')
class PgAlwaysPaginatePostController {
  constructor(public service: ApPostService) {}
}

class CategoryService extends TypeOrmCrudService<Category> {
  constructor(@InjectRepository(Category) repo: Repository<Category>) {
    super(repo);
  }
}

@Crud({ model: { type: Category }, query: { join: { posts: { eager: false } } }, dialects: ['postgrest'] })
@Controller('pg-categories')
class PgCategoryController {
  constructor(public service: CategoryService) {}
}

let app: INestApplication;
let ds: DataSource;
const http = () => request(app.getHttpServer());
const get = (path: string, headers: Record<string, string> = {}) => http().get(path).set(headers);
const ids = (body: any): number[] => body.map((r: any) => r.id);
const EXACT = { Prefer: 'count=exact' };
const observed: string[] = [];
/** One line per request for the report: what was sent, what came back. */
const note = (label: string, res: request.Response) => {
  observed.push(
    `${label} -> ${res.status} Content-Range: ${res.headers['content-range'] ?? '(none)'}` +
      (res.headers['preference-applied'] ? ` Preference-Applied: ${res.headers['preference-applied']}` : '') +
      (res.status >= 400 ? ` ${JSON.stringify(res.body.message)}` : Array.isArray(res.body) ? ` ids=${JSON.stringify(ids(res.body))}` : ''),
  );
  return res;
};
const document = () => SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('parity').build());
const parameters = (doc: any, path: string) => doc.paths[path].get.parameters as any[];

beforeAll(async () => {
  ds = await createSeededDataSource('pgcount');
  @Module({
    imports: [
      TypeOrmModule.forRootAsync({ useFactory: () => ({}) as any, dataSourceFactory: async () => ds }),
      TypeOrmModule.forFeature(ALL_ENTITIES),
    ],
    controllers: [
      ApPostController,
      PgPostController,
      PgScopedPostController,
      PgPublishedPostController,
      PgAlwaysPaginatePostController,
      PgCategoryController,
    ],
    providers: [ApPostService, CategoryService],
  })
  class CountModule {}
  const mod = await Test.createTestingModule({ imports: [CountModule] }).compile();
  app = mod.createNestApplication();
  // Listen once on IPv4 loopback. supertest otherwise re-listens on a fresh
  // wildcard port per request, and on a busy machine another process can hold
  // that port number on 127.0.0.1 and answer instead (seen as a stray 401).
  await app.listen(0, '127.0.0.1');
});

afterAll(async () => {
  setAcceptedDialects();
  // eslint-disable-next-line no-console
  console.log(observed.join('\n'));
  for (const c of [() => app?.close(), () => ds?.destroy()]) {
    try {
      await c();
    } catch {
      // shared-pglite teardown noise
    }
  }
});

describe('Content-Range and Prefer: count', () => {
  it('no Prefer: 200, the row span, total not counted', async () => {
    const res = note('GET /pg-posts?limit=2&order=id.asc', await get('/pg-posts?limit=2&order=id.asc'));
    expect(res.status).toBe(200);
    expect(res.headers['content-range']).toBe('0-1/*');
    expect(res.headers['range-unit']).toBe('items');
    expect(res.headers['preference-applied']).toBeUndefined();
    expect(ids(res.body)).toEqual([1, 2]);
  });

  it('count=exact on a partial page: 206, span/total, Preference-Applied', async () => {
    const res = note('GET /pg-posts?limit=2&order=id.asc [Prefer: count=exact]', await get('/pg-posts?limit=2&order=id.asc', EXACT));
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe('0-1/6');
    expect(res.headers['preference-applied']).toBe('count=exact');
    expect(res.headers['access-control-expose-headers']).toContain('Content-Range');
    expect(ids(res.body)).toEqual([1, 2]);
  });

  it('count=exact when the page holds everything: 200', async () => {
    const res = note('GET /pg-posts?limit=10 [count=exact]', await get('/pg-posts?limit=10&order=id.asc', EXACT));
    expect(res.status).toBe(200);
    expect(res.headers['content-range']).toBe('0-5/6');
  });

  it('a later page, and an empty page past the end (*/total)', async () => {
    const last = note('GET /pg-posts?limit=2&offset=4 [count=exact]', await get('/pg-posts?limit=2&offset=4&order=id.asc', EXACT));
    expect(last.status).toBe(206);
    expect(last.headers['content-range']).toBe('4-5/6');
    expect(ids(last.body)).toEqual([5, 6]);

    const past = note('GET /pg-posts?limit=2&offset=10 [count=exact]', await get('/pg-posts?limit=2&offset=10', EXACT));
    expect(past.status).toBe(200);
    expect(past.headers['content-range']).toBe('*/6');
    expect(past.body).toEqual([]);

    const none = note('GET /pg-posts?views=gt.5000 [count=exact]', await get('/pg-posts?views=gt.5000', EXACT));
    expect(none.headers['content-range']).toBe('*/0');
    const noneNoCount = await get('/pg-posts?views=gt.5000');
    expect(noneNoCount.headers['content-range']).toBe('*/*');
  });

  it('the total follows the filters', async () => {
    const res = note('GET /pg-posts?views=gt.100&limit=1 [count=exact]', await get('/pg-posts?views=gt.100&limit=1&order=id.asc', EXACT));
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe('0-0/3');
    const grouped = await get('/pg-posts?or=(views.eq.100,views.eq.999)&limit=1', EXACT);
    expect(grouped.headers['content-range']).toBe('0-0/2');
  });

  it('limit=0 with count=exact is a count-only request', async () => {
    const res = note('GET /pg-posts?limit=0 [count=exact]', await get('/pg-posts?limit=0', EXACT));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(res.headers['content-range']).toBe('*/6');
  });

  it.each(['planned', 'estimated'])('count=%s is answered with an exact count and says so', async (kind) => {
    const res = note(`GET /pg-posts?limit=2 [count=${kind}]`, await get('/pg-posts?limit=2', { Prefer: `count=${kind}` }));
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe('0-1/6');
    expect(res.headers['preference-applied']).toBe('count=exact');
  });

  it('count sits next to other preferences, and an unknown count value is ignored', async () => {
    expect((await get('/pg-posts?limit=2', { Prefer: 'handling=lenient, count=exact' })).headers['content-range']).toBe('0-1/6');
    expect((await get('/pg-posts?limit=2', { Prefer: 'count=wild' })).headers['content-range']).toBe('0-1/*');
  });

  it('HEAD carries the same headers and no body', async () => {
    const res = note('HEAD /pg-posts?limit=2 [count=exact]', await http().head('/pg-posts?limit=2').set(EXACT));
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe('0-1/6');
    expect(res.headers['preference-applied']).toBe('count=exact');
    expect(res.text ?? '').toBe('');
  });

  it('embeds do not change the count; an inner embed does', async () => {
    const left = note('GET /pg-posts?select=id,comments(id)&limit=2 [count=exact]', await get('/pg-posts?select=id,comments(id)&limit=2&order=id.asc', EXACT));
    expect(left.headers['content-range']).toBe('0-1/6');
    expect(left.body[0].comments.length).toBe(3);
    const inner = note(
      'GET /pg-posts?select=id,comments!inner(id)&comments.likes=gt.5&limit=2 [count=exact]',
      await get('/pg-posts?select=id,comments!inner(id)&comments.likes=gt.5&limit=2&order=id.asc', EXACT),
    );
    expect(inner.headers['content-range']).toBe('0-1/4');
    expect(ids(inner.body)).toEqual([1, 2]);
  });

  it('the body is a bare array even when the controller sets alwaysPaginate', async () => {
    const res = await get('/pg-envelope?limit=2&offset=2&order=id.asc', EXACT);
    expect(Array.isArray(res.body)).toBe(true);
    expect(ids(res.body)).toEqual([3, 4]);
    expect(res.headers['content-range']).toBe('2-3/6');
  });

  it('the both-dialects controller is untouched for nestjsx, and gets the headers for PostgREST', async () => {
    const nx = await get('/posts?limit=2&page=1');
    expect(nx.status).toBe(200);
    expect(nx.headers['content-range']).toBeUndefined();
    expect(nx.body.total).toBe(6);
    const pg = await get('/posts?limit=2&order=id.asc', { ...EXACT, 'X-Crud-Dialect': 'postgrest' });
    expect(pg.status).toBe(206);
    expect(pg.headers['content-range']).toBe('0-1/6');
  });
});

describe('the count respects the same access filters as the rows', () => {
  it('a scoped caller is counted inside the scope only', async () => {
    const all = await get('/pg-posts?limit=1', EXACT);
    expect(all.headers['content-range']).toBe('0-0/6');

    const scoped = note('GET /pg-scoped-posts?order=id.asc [count=exact] (scope: authorId=1)', await get('/pg-scoped-posts?order=id.asc', EXACT));
    expect(scoped.status).toBe(200);
    expect(ids(scoped.body)).toEqual([1, 4]);
    expect(scoped.headers['content-range']).toBe('0-1/2');

    const paged = note('GET /pg-scoped-posts?limit=1 [count=exact]', await get('/pg-scoped-posts?limit=1&order=id.asc', EXACT));
    expect(paged.status).toBe(206);
    expect(paged.headers['content-range']).toBe('0-0/2');
  });

  it('a filter or group cannot widen the count past the scope', async () => {
    for (const widen of ['or=(authorId.neq.1,authorId.eq.1)', 'authorId=neq.1', 'authorId=in.(1,2,3)', 'and=(authorId.gte.0)']) {
      const res = note(`GET /pg-scoped-posts?${widen} [count=exact]`, await get(`/pg-scoped-posts?${widen}&limit=0`, EXACT));
      const total = Number(res.headers['content-range'].split('/')[1]);
      expect(total).toBeLessThanOrEqual(2);
    }
    const narrowed = await get('/pg-scoped-posts?published=is.true', EXACT);
    expect(narrowed.headers['content-range']).toBe('0-0/1');
    expect(ids(narrowed.body)).toEqual([1]);
  });

  it('a read by id stays inside the scope and targets the id asked for', async () => {
    expect((await get('/pg-scoped-posts/4')).body.id).toBe(4);
    expect((await get('/pg-scoped-posts/2')).status).toBe(404);
  });

  it("the controller's own query.filter applies to rows and count", async () => {
    const res = note('GET /pg-published?order=id.asc [count=exact] (controller filter published=true)', await get('/pg-published?order=id.asc', EXACT));
    expect(ids(res.body)).toEqual([1, 2, 3, 6]);
    expect(res.headers['content-range']).toBe('0-3/4');
    const widen = await get('/pg-published?published=is.false', EXACT);
    expect(widen.body).toEqual([]);
    expect(widen.headers['content-range']).toBe('*/0');
  });
});

describe('default page size is visible', () => {
  it('no limit and more rows than the default: 206 with the total, without Prefer', async () => {
    const res = note('GET /pg-posts?order=id.asc (no limit, controller default 5)', await get('/pg-posts?order=id.asc'));
    expect(res.status).toBe(206);
    expect(ids(res.body)).toEqual([1, 2, 3, 4, 5]);
    expect(res.headers['content-range']).toBe('0-4/6');
    expect(res.headers['preference-applied']).toBeUndefined();
  });

  it('no limit and everything fits: 200, no count query', async () => {
    const res = note('GET /pg-posts?views=gt.100 (no limit, 3 rows)', await get('/pg-posts?views=gt.100&order=id.asc'));
    expect(res.status).toBe(200);
    expect(res.headers['content-range']).toBe('0-2/*');
  });

  it('an explicit limit is the caller taking charge: no count unless asked', async () => {
    const res = note('GET /pg-posts?limit=5', await get('/pg-posts?limit=5&order=id.asc'));
    expect(res.status).toBe(200);
    expect(res.headers['content-range']).toBe('0-4/*');
  });

  it('the scoped default page is counted inside the scope', async () => {
    // 2 rows in scope, default 5: fits, so no total and never a wider one.
    const res = await get('/pg-scoped-posts');
    expect(res.status).toBe(200);
    expect(res.headers['content-range']).toBe('0-1/*');
  });
});

describe('Range request header', () => {
  it('Range: 2-3 is offset 2, limit 2', async () => {
    const res = note('GET /pg-posts?order=id.asc [Range: 2-3]', await get('/pg-posts?order=id.asc', { Range: '2-3', 'Range-Unit': 'items' }));
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([3, 4]);
    expect(res.headers['content-range']).toBe('2-3/*');
    const counted = note('GET /pg-posts?order=id.asc [Range: 2-3, count=exact]', await get('/pg-posts?order=id.asc', { Range: '2-3', ...EXACT }));
    expect(counted.status).toBe(206);
    expect(counted.headers['content-range']).toBe('2-3/6');
  });

  it('an open-ended Range: 4- is an offset', async () => {
    const res = await get('/pg-posts?order=id.asc', { Range: '4-' });
    expect(ids(res.body)).toEqual([5, 6]);
    expect(res.headers['content-range']).toBe('4-5/*');
  });

  it('Range next to limit/offset is a 400, an inverted range a 416, a bytes range is ignored', async () => {
    const both = note('GET /pg-posts?limit=2 [Range: 0-1]', await get('/pg-posts?limit=2', { Range: '0-1' }));
    expect(both.status).toBe(400);
    expect(both.body.message).toContain('either the Range header or the limit and offset');
    const inverted = note('GET /pg-posts [Range: 5-2]', await get('/pg-posts', { Range: '5-2' }));
    expect(inverted.status).toBe(416);
    const bytes = await get('/pg-posts?limit=2&order=id.asc', { Range: 'bytes=0-10' });
    expect(bytes.status).toBe(200);
    expect(ids(bytes.body)).toEqual([1, 2]);
  });
});

describe('unsupported PostgREST syntax is a 400 that names the feature, never a wrong 200', () => {
  it.each([
    ['cast', '/pg-posts?select=id,views::text', 'Casts (column::type) are not supported'],
    ['JSON path in select', '/pg-posts?select=id,body->>color', 'JSON paths (-> and ->>) are not supported'],
    ['aggregate', '/pg-posts?select=views.sum()', 'Aggregate functions are not supported'],
    ['count()', '/pg-posts?select=count()', 'Aggregate functions are not supported'],
    ['spread', '/pg-posts?select=title,...author(name)', 'Spreading an embed (...rel(cols)) is not supported'],
    ['embed alias', '/pg-posts?select=id,writer:author(name)', 'Embed aliases (alias:rel(...)) are not supported'],
    ['rename inside an embed', '/pg-posts?select=id,author(n:name)', 'Renaming a column inside an embed is not supported'],
    ['empty embed', '/pg-posts?select=id,author()', 'Empty embeds (rel()) are not supported'],
    ['unknown relation', '/pg-posts?select=id,nope(*)', "'nope' cannot be embedded here. Embeddable relations: author, author.profile, comments, categories."],
    ['relation outside the allowlist', '/pg-posts?select=id,reviews(id)', "'reviews' cannot be embedded here"],
    ['unknown column in select', '/pg-posts?select=id,nope', "Unknown column 'nope' in select"],
    ['unknown column in an embed', '/pg-posts?select=id,author(nope)', "Unknown column 'nope' in embed 'author'"],
    ['filter on a relation that is not embedded', '/pg-posts?comments.likes=gt.5', "refers to 'comments', which is not embedded"],
    ['order on a relation that is not embedded', '/pg-posts?order=author(name).desc', 'which is not embedded'],
    ['embedded order', '/pg-posts?select=id,comments(id)&comments.order=likes.desc', 'apply to the top level only'],
    ['embedded limit', '/pg-posts?select=id,comments(id)&comments.limit=1', 'apply to the top level only'],
    ['negated group', '/pg-posts?not.and=(views.gte.5,views.lte.20)', 'Negated groups'],
    ['a value of the wrong type', '/pg-posts?views=eq.abc', 'Invalid filter value or operator for the column type'],
    ['an operator the column type lacks', '/pg-posts?published=like.*a*', 'Invalid filter value or operator for the column type'],
    ['unknown operator', '/pg-posts?views=cs.{1,2}', "Unsupported PostgREST operator 'cs'"],
    ['unknown filter column', '/pg-posts?nope=eq.1', "Unknown column"],
    ['unknown order column', '/pg-posts?order=nope.desc', 'Unknown column'],
    ['JSON path in a filter', '/pg-posts?body->>color=eq.red', 'JSON paths (-> and ->>) are not supported'],
    ['JSON path in order', '/pg-posts?order=body->>color.desc', 'JSON paths (-> and ->>) are not supported'],
    ['null filter on an embed', '/pg-posts?select=id,comments(id)&comments=is.null', 'Unknown column'],
    ['match', '/pg-posts?title=match.^N', "Unsupported PostgREST operator 'match'"],
    ['full-text search', '/pg-posts?title=fts.engine', "Unsupported PostgREST operator 'fts'"],
    ['isdistinct', '/pg-posts?title=isdistinct.a', "Unsupported PostgREST operator 'isdistinct'"],
    ['any modifier', '/pg-posts?title=like(any).{N*,B*}', 'Unsupported PostgREST operator'],
  ])('%s', async (_name, path, message) => {
    const res = note(`GET ${path}`, await get(path));
    expect(res.status).toBe(400);
    expect(res.body.message).toContain(message);
  });

  it('the singular media type is refused, not answered with an array', async () => {
    const res = note('GET /pg-posts?id=eq.1 [Accept: application/vnd.pgrst.object+json]', await get('/pg-posts?id=eq.1', { Accept: 'application/vnd.pgrst.object+json' }));
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('application/vnd.pgrst.* media types are not supported');
  });

  it('the same refusals hold on a read by id', async () => {
    expect((await get('/pg-posts/1?select=id,views::text')).status).toBe(400);
    expect((await get('/pg-posts/1?select=id,nope(*)')).status).toBe(400);
    expect((await get('/pg-posts/1?select=id,nope')).status).toBe(400);
  });
});

describe('features that became correct', () => {
  it('!inner with no filter drops parents that have no embedded row', async () => {
    const inner = note('GET /pg-categories?select=id,posts!inner(id)&order=id.asc [count=exact]', await get('/pg-categories?select=id,posts!inner(id)&order=id.asc', EXACT));
    expect(inner.status).toBe(200);
    expect(ids(inner.body)).toEqual([1, 2, 3]);
    expect(inner.headers['content-range']).toBe('0-2/3');
    const left = await get('/pg-categories?select=id,posts(id)&order=id.asc');
    expect(ids(left.body)).toEqual([1, 2, 3, 4]);
    expect(left.body[3].posts).toEqual([]);
  });

  it('a foreign key hint is accepted and changes nothing; a quoted in value keeps its comma', async () => {
    const hinted = await get('/pg-posts?select=id,author!authorId(name)&order=id.asc&limit=1');
    expect(hinted.status).toBe(200);
    expect(hinted.body[0].author.name).toBe('Ada Lovelace');
    const quoted = await get('/pg-posts?title=in.("no, such",Compilers 101)');
    expect(ids(quoted.body)).toEqual([5]);
  });

  it('a rename applies on a read by id too', async () => {
    const res = await get('/pg-posts/1?select=id,name:title');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['id', 'name']);
  });

  it('rename, embed with columns and an embedded filter still work on a list', async () => {
    const res = await get('/pg-posts?select=id,name:title,author(name),comments(id)&comments.likes=gt.5&order=id.asc&limit=1');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body[0]).sort()).toEqual(['author', 'comments', 'id', 'name']);
    expect(res.body[0].author.name).toBe('Ada Lovelace');
    expect(ids(res.body[0].comments)).toEqual([2]);
  });
});

describe('OpenAPI document for a PostgREST-only controller', () => {
  it('documents select, order, limit, offset, or, and, one parameter per column, and embedded', () => {
    const doc: any = document();
    const params = parameters(doc, '/pg-posts');
    expect(params.map((p) => p.name)).toEqual([
      'select', 'order', 'limit', 'offset', 'or', 'and',
      'id', 'title', 'body', 'views', 'published', 'createdAt', 'score', 'authorId',
      'embedded',
    ]);
    expect(params.every((p) => p.in === 'query' && p.required === false)).toBe(true);
    const by = Object.fromEntries(params.map((p) => [p.name, p]));
    expect(by.views.description).toBe('Filter, op.value: gte.5');
    expect(by.body.description).toBe('Filter, op.value: ilike.*abc*, is.null');
    expect(by.published.description).toBe('Filter, op.value: is.true');
    expect(by.createdAt.description).toBe('Filter, op.value: gte.2026-01-01');
    expect(by.select.description).toContain('author, author.profile, comments, categories');
    expect(by.limit.description).toBe('Maximum rows. Default 5, at most 100.');
    expect(by.embedded).toMatchObject({ style: 'form', explode: true, schema: { type: 'object', additionalProperties: { type: 'string' } } });

    const op = doc.paths['/pg-posts'].get;
    expect(op.summary).toBe('Get many Post');
    expect(op.description).toContain('Example: ?select=id,title,author(*)&title=ilike.*abc*&order=id.desc&limit=10');
    expect(op.responses['200'].schema ?? op.responses['200'].content['application/json'].schema).toMatchObject({ type: 'array' });
    expect(op.responses['200'].headers['Content-Range']).toBeDefined();
    // eslint-disable-next-line no-console
    console.log('OPENAPI /pg-posts get\n' + JSON.stringify({ description: op.description, parameters: params }, null, 1));
  });

  it('the documented example is a request the route answers', async () => {
    const res = await get('/pg-posts?select=id,title,author(*)&title=ilike.*engine*&order=id.desc&limit=10');
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([4, 1]);
  });

  it('leaves out columns the controller excludes, and nestjsx parameter names', () => {
    const names = parameters(document(), '/pg-envelope').map((p) => p.name);
    expect(names).not.toContain('body');
    expect(names).toContain('title');
    for (const nestjsx of ['fields', 'filter', 's', 'sort', 'join', 'page']) expect(names).not.toContain(nestjsx);
  });

  it('a read by id documents select only', () => {
    const params = (document() as any).paths['/pg-posts/{id}'].get.parameters as any[];
    expect(params.filter((p) => p.in === 'query').map((p) => p.name)).toEqual(['select']);
  });

  it('a controller that accepts both dialects keeps the nestjsx parameters, until setAcceptedDialects narrows the app', () => {
    const before = parameters(document(), '/posts').map((p) => p.name);
    expect(before).toEqual(['fields', 'filter', 's', 'sort', 'join', 'limit', 'page', 'offset']);
    setAcceptedDialects(['postgrest']);
    const after = parameters(document(), '/posts').map((p) => p.name);
    expect(after.slice(0, 7)).toEqual(['select', 'order', 'limit', 'offset', 'or', 'and', 'id']);
    expect(after).not.toContain('filter');
    setAcceptedDialects();
    expect(parameters(document(), '/posts').map((p) => p.name)).toEqual(before);
  });
});

// Last: it writes.
describe('a write by id on a scoped PostgREST-only controller', () => {
  it('changes the row named in the URL, not the first row in the scope', async () => {
    const res = await http().patch('/pg-scoped-posts/4').send({ views: 11 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(4);
    const rows = await get('/pg-posts?id=in.(1,4)&select=id,views&order=id.asc');
    expect(rows.body).toEqual([{ id: 1, views: 100 }, { id: 4, views: 11 }]);
    expect((await http().patch('/pg-scoped-posts/2').send({ views: 1 })).status).toBe(404);
  });
});
