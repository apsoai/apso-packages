/**
 * Cross-dialect access parity (apso-packages#50).
 *
 * The access boundary for both dialects is @apso/crud's applyJoins
 * options.query.join allowlist. This proves it end-to-end against the REAL
 * engine + a real sqlite DB: the SAME relation, requested once as a nestjsx
 * `join=` and once as a PostgREST embed `select=...,rel(...)`, is honored or
 * denied IDENTICALLY. A PostgREST embed can never reach a relation the
 * nestjsx join path would deny.
 */
import { INestApplication } from '@nestjs/common';
import { TypeOrmCrudService } from '@apso/crud-typeorm';
import { PostgrestRequestParser } from '@apso/postgrest-request';
import type { ParsedRequest, CrudRequestOptions } from '@apso/crud-core';
import { bootApp } from './harness';
import { AuthorService } from './controllers.apso';
import { Author } from './entities';

// A default ParsedRequest with the given join list + options — the fields the
// engine reads. parsed.join = [{ field: 'posts' }] is EXACTLY what
// @apso/crud-request emits for `?join=posts` (the nestjsx dialect).
function req(join: ParsedRequest['parsed']['join'], options: CrudRequestOptions): ParsedRequest {
  return {
    options,
    parsed: {
      fields: [],
      paramsFilter: [],
      search: {},
      filter: [],
      or: [],
      join,
      sort: [],
      limit: 50,
      offset: 0,
      page: 1,
      cache: 0,
    },
  } as ParsedRequest;
}

describe('cross-dialect access parity (#50): join allowlist governs both dialects', () => {
  let app: INestApplication;
  let service: TypeOrmCrudService<Author>;

  beforeAll(async () => {
    // AuthorService injects the Author repo via @InjectRepository, which the
    // harness's forFeature registers — no controller needed to call getMany.
    app = await bootApp([], [AuthorService]);
    service = app.get(AuthorService);
  });

  afterAll(async () => {
    await app.close();
  });

  const nestjsxJoin = (opts: CrudRequestOptions) => req([{ field: 'posts' }], opts);
  const postgrestEmbed = (opts: CrudRequestOptions) =>
    new PostgrestRequestParser(opts).parse({ select: 'id,posts(id,title)' });

  async function postsPopulated(r: ParsedRequest): Promise<boolean> {
    const res = await service.getMany(r);
    const rows = (Array.isArray(res) ? res : (res as any).data) as Author[];
    // Every joined author carries a (possibly empty) posts array; a denied
    // join leaves the property undefined.
    return rows.length > 0 && rows.every(a => Array.isArray((a as any).posts));
  }

  it('ALLOWED relation: nestjsx join and PostgREST embed both populate posts', async () => {
    const opts: CrudRequestOptions = { query: { join: { posts: {} } } };
    const viaJoin = await postsPopulated(nestjsxJoin(opts));
    const viaEmbed = await postsPopulated(postgrestEmbed(opts));
    expect(viaJoin).toBe(true);
    expect(viaEmbed).toBe(true);
    expect(viaEmbed).toBe(viaJoin); // identical access
  });

  it('DENIED relation (empty allowlist): both dialects deny posts identically', async () => {
    const opts: CrudRequestOptions = { query: { join: {} } };
    const viaJoin = await postsPopulated(nestjsxJoin(opts));
    const viaEmbed = await postsPopulated(postgrestEmbed(opts));
    expect(viaJoin).toBe(false);
    expect(viaEmbed).toBe(false);
    expect(viaEmbed).toBe(viaJoin); // identical denial
  });

  it('DENIED relation (allowlist omits posts): both dialects deny posts identically', async () => {
    // posts exists as a real relation but is not on the allowlist.
    const opts: CrudRequestOptions = { query: { join: { 'posts.comments': {} } } };
    const viaJoin = await postsPopulated(nestjsxJoin(opts));
    const viaEmbed = await postsPopulated(postgrestEmbed(opts));
    expect(viaJoin).toBe(false);
    expect(viaEmbed).toBe(false);
    expect(viaEmbed).toBe(viaJoin);
  });
});
