/**
 * PostgREST conformance / cross-dialect equivalence (apso-packages#52).
 *
 * For a corpus of logical queries expressed BOTH ways, run each through the
 * REAL @apso/crud engine on the SAME seeded sqlite DB and assert the two
 * dialects return equivalent rows (same records, same order, same selected
 * columns). This is the dialect-mapping corpus handed to apso-e2e (#35): the
 * nestjsx side is already covered against @nestjsx/crud by diff.spec.ts, so
 * proving PostgREST ≡ nestjsx here transitively proves PostgREST conforms.
 */
import { INestApplication } from '@nestjs/common';
import { TypeOrmCrudService } from '@apso/crud-typeorm';
import { CrudRequestParser } from '@apso/crud-request';
import { PostgrestRequestParser } from '@apso/postgrest-request';
import type { CrudRequestOptions } from '@apso/crud-core';
import { bootApp } from './harness';
import { AuthorService } from './controllers.apso';
import { Author } from './entities';

// Shared options: same join allowlist the harness AuthorController uses, so
// embeds/joins are permitted identically for both dialects.
const OPTIONS: CrudRequestOptions = {
  query: { limit: 20, join: { posts: {}, 'posts.comments': {} } },
  params: { id: { field: 'id', type: 'number', primary: true } },
};

/**
 * The dialect-mapping corpus. Each row is one logical query written in both
 * dialects; both must yield equivalent rows. (nestjsx query, postgrest query).
 */
const CORPUS: Array<{ desc: string; nestjsx: any; postgrest: any; params?: any }> = [
  { desc: 'eq filter', nestjsx: { filter: 'name||$eq||Ada' }, postgrest: { name: 'eq.Ada' } },
  { desc: 'ne filter', nestjsx: { filter: 'name||$ne||Ada' }, postgrest: { name: 'neq.Ada' } },
  { desc: 'gt filter', nestjsx: { filter: 'age||$gt||30' }, postgrest: { age: 'gt.30' } },
  { desc: 'gte filter', nestjsx: { filter: 'age||$gte||36' }, postgrest: { age: 'gte.36' } },
  { desc: 'lt filter', nestjsx: { filter: 'age||$lt||30' }, postgrest: { age: 'lt.30' } },
  { desc: 'lte filter', nestjsx: { filter: 'age||$lte||28' }, postgrest: { age: 'lte.28' } },
  { desc: 'in list', nestjsx: { filter: 'plan||$in||Pro,Team' }, postgrest: { plan: 'in.(Pro,Team)' } },
  { desc: 'not in list', nestjsx: { filter: 'plan||$notin||Free' }, postgrest: { plan: 'not.in.(Free)' } },
  { desc: 'is null', nestjsx: { filter: 'email||$isnull' }, postgrest: { email: 'is.null' } },
  { desc: 'is not null', nestjsx: { filter: 'email||$notnull' }, postgrest: { email: 'not.is.null' } },
  { desc: 'contains (case-insensitive on sqlite)', nestjsx: { filter: 'name||$cont||a' }, postgrest: { name: 'like.*a*' } },
  { desc: 'ilike contains', nestjsx: { filter: 'name||$contL||A' }, postgrest: { name: 'ilike.*A*' } },
  { desc: 'two ANDed filters', nestjsx: { filter: ['active||$eq||true', 'age||$gt||30'] }, postgrest: { active: 'eq.true', age: 'gt.30' } },
  { desc: 'order desc', nestjsx: { sort: 'age,DESC' }, postgrest: { order: 'age.desc' } },
  { desc: 'multi-column order', nestjsx: { sort: ['plan,ASC', 'age,DESC'] }, postgrest: { order: 'plan.asc,age.desc' } },
  { desc: 'select columns', nestjsx: { fields: 'id,name' }, postgrest: { select: 'id,name' } },
  { desc: 'limit + offset', nestjsx: { sort: 'id,ASC', limit: '2', offset: '1' }, postgrest: { order: 'id.asc', limit: '2', offset: '1' } },
  { desc: 'embed relation with columns', nestjsx: { fields: 'id', join: 'posts||title', sort: 'id,ASC' }, postgrest: { select: 'id,posts(title)', order: 'id.asc' } },
  // both select root id only + all post columns, so the only difference under
  // test is the embedded filter itself (not column selection).
  //
  // #59: a DEFAULT PostgREST embedded filter (`posts.status=eq.published`) is
  // NOT equivalent to a nestjsx `filter=posts.status||...` — the nestjsx filter
  // is a WHERE (drops parents with no matching child), while PostgREST's default
  // embedded filter shapes ONLY the embedded rows (all parents return, empties
  // included). That divergence is asserted directly by the crud-parity
  // conformance case pg-embed-filter-keeps-parents. The dialects DO reconverge
  // under PostgREST `!inner`, which is the parent-level (WHERE) filter — that is
  // the equivalent construction, tested here.
  { desc: '!inner embedded filter matches nestjsx WHERE-on-join (#59)', nestjsx: { fields: 'id', join: 'posts', filter: 'posts.status||$eq||published', sort: 'id,ASC' }, postgrest: { select: 'id,posts!inner(*)', 'posts.status': 'eq.published', order: 'id.asc' } },
  { desc: 'route param by id', nestjsx: { fields: 'id,name' }, postgrest: { select: 'id,name' }, params: { id: 1 } },
];

describe('cross-dialect equivalence (#52): nestjsx ≡ PostgREST on the same engine', () => {
  let app: INestApplication;
  let service: TypeOrmCrudService<Author>;

  beforeAll(async () => {
    app = await bootApp([], [AuthorService]);
    service = app.get(AuthorService);
  });
  afterAll(async () => app.close());

  // Compare the meaningful payload: the row array, regardless of whether the
  // engine returned a bare array or a paginated envelope for that dialect.
  async function rows(parser: any, query: any, params: any): Promise<any> {
    const req = parser.parse(query, params || {}, {});
    const res: any = await service.getMany(req);
    return JSON.stringify(Array.isArray(res) ? res : res.data);
  }

  it.each(CORPUS)('$desc', async ({ nestjsx, postgrest, params }) => {
    const viaNestjsx = await rows(new CrudRequestParser(OPTIONS), nestjsx, params);
    const viaPostgrest = await rows(new PostgrestRequestParser(OPTIONS), postgrest, params);
    expect(viaPostgrest).toBe(viaNestjsx);
    // sanity: the query actually matched/selected something (guards against a
    // false pass where both dialects silently return everything or nothing)
    expect(viaNestjsx).not.toBe('[]');
  });
});
