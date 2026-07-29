/**
 * PostgREST dialect battery (apsoai/apso-packages#36 criterion 4, #52).
 *
 * Three modes:
 * 1. CONFORMANCE — @apso/crud's PostgREST dialect vs PostgREST's DOCUMENTED
 *    behavior. Fixtures hand-derived from the docs (tables_views,
 *    pagination_count, resource_embedding pages, fetched 2026-07-30) against
 *    the known seed. Assertions: status, bare-array shape (no envelope),
 *    row ids in order (or as sets for embeds), selected-field shape.
 * 2. EQUIVALENCE — the same logical query in both dialects against the SAME
 *    @apso app must return the same rows. Dialect-independent truth.
 * 3. ACCESS — embeds must honor the same auth guards, CrudAuth scoping, and
 *    join allowlist as the nestjsx join path. No access difference between
 *    dialects.
 *
 * Seed reference (posts): 1:views100/pub/body 2:250/pub/null 3:999/pub/body
 * 4:10/unpub/body 5:250/unpub/body 6:0/pub/null. Comments likes>5: c2(p1),
 * c4,c10(p3), c7(p5), c11(p2).
 */

export interface ConformanceCase {
  id: string;
  path: string;
  /** Expected HTTP status (200 unless documented error). */
  status: number;
  /** Expected root row ids, in order. Omit for error cases. */
  ids?: number[];
  /** If set, each row must have exactly these keys. */
  onlyFields?: string[];
  /** If set, ids are compared as a set (no order guarantee). */
  unordered?: boolean;
}

export const POSTGREST_CONFORMANCE: ConformanceCase[] = [
  // --- horizontal filtering: ?col=op.value ---
  { id: 'pg-eq', path: '/posts?views=eq.250&order=id.asc', status: 200, ids: [2, 5] },
  { id: 'pg-neq', path: '/posts?views=neq.250&order=id.asc', status: 200, ids: [1, 3, 4, 6] },
  { id: 'pg-gt', path: '/posts?views=gt.100&order=id.asc', status: 200, ids: [2, 3, 5] },
  { id: 'pg-gte', path: '/posts?views=gte.100&order=id.asc', status: 200, ids: [1, 2, 3, 5] },
  { id: 'pg-lt', path: '/posts?views=lt.100&order=id.asc', status: 200, ids: [4, 6] },
  { id: 'pg-lte', path: '/posts?views=lte.100&order=id.asc', status: 200, ids: [1, 4, 6] },
  // like/ilike: docs — "* is an alias of the percent sign %"
  { id: 'pg-like-star', path: '/posts?title=like.*Engine*&order=id.asc', status: 200, ids: [1] },
  { id: 'pg-ilike-star', path: '/posts?title=ilike.*engine*&order=id.asc', status: 200, ids: [1, 4] },
  // in: docs — ?col=in.(a,b,c)
  { id: 'pg-in', path: '/posts?views=in.(100,250)&order=id.asc', status: 200, ids: [1, 2, 5] },
  // is: docs — exact equality for null/true/false
  { id: 'pg-is-null', path: '/posts?body=is.null&order=id.asc', status: 200, ids: [2, 6] },
  { id: 'pg-is-true', path: '/posts?published=is.true&order=id.asc', status: 200, ids: [1, 2, 3, 6] },
  { id: 'pg-is-false', path: '/posts?published=is.false&order=id.asc', status: 200, ids: [4, 5] },
  // not: docs — ?col=not.op.value
  { id: 'pg-not-eq', path: '/posts?views=not.eq.250&order=id.asc', status: 200, ids: [1, 3, 4, 6] },
  { id: 'pg-not-is-null', path: '/posts?body=not.is.null&order=id.asc', status: 200, ids: [1, 3, 4, 5] },
  // or: docs — ?or=(c1.op.v1,c2.op.v2); and is implicit between params
  { id: 'pg-or', path: '/posts?or=(views.eq.100,views.eq.999)&order=id.asc', status: 200, ids: [1, 3] },
  { id: 'pg-implicit-and', path: '/posts?published=is.true&views=gt.100&order=id.asc', status: 200, ids: [2, 3] },

  // --- vertical filtering: ?select= ---
  { id: 'pg-select-subset', path: '/posts?select=id,title&order=id.asc', status: 200, ids: [1, 2, 3, 4, 5, 6], onlyFields: ['id', 'title'] },
  { id: 'pg-select-rename', path: '/posts?select=id,name:title&order=id.asc', status: 200, ids: [1, 2, 3, 4, 5, 6], onlyFields: ['id', 'name'] },

  // --- ordering: ?order=col.dir[.nullslast] ---
  { id: 'pg-order-desc', path: '/posts?select=id&order=views.desc,id.asc', status: 200, ids: [3, 2, 5, 1, 4, 6], onlyFields: ['id'] },
  { id: 'pg-order-nullslast', path: '/posts?select=id&order=body.asc.nullslast,id.asc', status: 200, ids: [1, 3, 5, 4, 2, 6], onlyFields: ['id'] },

  // --- pagination: query params work standalone; bare array, 200 ---
  { id: 'pg-limit-offset', path: '/posts?select=id&order=id.asc&limit=2&offset=2', status: 200, ids: [3, 4], onlyFields: ['id'] },

  // --- resource embedding: select=rel(cols) ---
  // M:1 -> nested object; 1:M and M:M -> arrays (shape checked in runner)
  { id: 'pg-embed-m1', path: '/posts?select=id,author(name)&order=id.asc', status: 200, ids: [1, 2, 3, 4, 5, 6] },
  { id: 'pg-embed-1m', path: '/authors?select=id,posts(id)&order=id.asc', status: 200, ids: [1, 2, 3] },
  { id: 'pg-embed-mm', path: '/posts?select=id,categories(name)&order=id.asc', status: 200, ids: [1, 2, 3, 4, 5, 6] },
  { id: 'pg-embed-nested', path: '/comments?select=id,post(id,author(name))&order=id.asc', status: 200, ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  // embedded filter shapes ONLY the embedded rows, parents unchanged (docs)
  { id: 'pg-embed-filter-keeps-parents', path: '/posts?select=id,comments(id)&comments.likes=gt.5&order=id.asc', status: 200, ids: [1, 2, 3, 4, 5, 6] },
  // !inner converts to a parent-level filter (docs)
  { id: 'pg-embed-inner', path: '/posts?select=id,comments!inner(id)&comments.likes=gt.5&order=id.asc', status: 200, ids: [1, 2, 3, 5] },

  // --- documented error behavior ---
  { id: 'pg-unknown-filter-column', path: '/posts?nonexistent=eq.1', status: 400 },
];

/** Same logical query, both dialects, same @apso app -> same rows. */
export interface EquivalencePair {
  id: string;
  postgrest: string;
  nestjsx: string;
}

export const CROSS_DIALECT_EQUIVALENCE: EquivalencePair[] = [
  { id: 'eqv-eq', postgrest: '/posts?views=eq.250&order=id.asc', nestjsx: '/posts?filter=views||$eq||250&sort=id,ASC' },
  { id: 'eqv-in', postgrest: '/posts?views=in.(100,250)&order=id.asc', nestjsx: '/posts?filter=views||$in||100,250&sort=id,ASC' },
  { id: 'eqv-ilike-contL', postgrest: '/posts?title=ilike.*engine*&order=id.asc', nestjsx: '/posts?filter=title||$contL||engine&sort=id,ASC' },
  { id: 'eqv-isnull', postgrest: '/posts?body=is.null&order=id.asc', nestjsx: '/posts?filter=body||$isnull&sort=id,ASC' },
  { id: 'eqv-or', postgrest: '/posts?or=(views.eq.100,views.eq.999)&order=id.asc', nestjsx: '/posts?or=views||$eq||100&or=views||$eq||999&sort=id,ASC' },
  { id: 'eqv-sort', postgrest: '/posts?order=views.desc,id.asc', nestjsx: '/posts?sort=views,DESC&sort=id,ASC' },
  { id: 'eqv-limit-offset', postgrest: '/posts?order=id.asc&limit=2&offset=2', nestjsx: '/posts?sort=id,ASC&limit=2&offset=2' },
  { id: 'eqv-select-fields', postgrest: '/posts?select=id,title&order=id.asc', nestjsx: '/posts?fields=title&sort=id,ASC' },
  { id: 'eqv-embed-join', postgrest: '/posts?select=id,author(name)&order=id.asc', nestjsx: '/posts?fields=id&join=author||name&sort=id,ASC' },
  { id: 'eqv-nested', postgrest: '/comments?select=id,post(id,author(name))&order=id.asc', nestjsx: '/comments?fields=id&join=post||id&join=post.author||name&sort=id,ASC' },
];

/** Access must be identical across dialects: guards, scoping, allowlist. */
export interface AccessCase {
  id: string;
  kind: 'status-parity' | 'row-parity';
  postgrest: string;
  nestjsx: string;
  headers?: Record<string, string>;
}

export const ACCESS_PARITY: AccessCase[] = [
  { id: 'acc-guard-denied', kind: 'status-parity', postgrest: '/secure-posts?select=id', nestjsx: '/secure-posts?fields=id' },
  { id: 'acc-guard-allowed-embed', kind: 'row-parity', postgrest: '/secure-posts?select=id,author(name)&order=id.asc', nestjsx: '/secure-posts?fields=id&join=author||name&sort=id,ASC', headers: { 'x-test-auth': 'letmein' } },
  { id: 'acc-scope-rows', kind: 'row-parity', postgrest: '/scoped-posts?select=id&order=id.asc', nestjsx: '/scoped-posts?fields=id&sort=id,ASC' },
  { id: 'acc-scope-cannot-widen', kind: 'row-parity', postgrest: '/scoped-posts?select=id&authorId=eq.2&order=id.asc', nestjsx: '/scoped-posts?fields=id&filter=authorId||$eq||2&sort=id,ASC' },
  // Non-allowlisted embed must behave EXACTLY like the non-allowlisted join,
  // whatever that behavior is (currently: silently ignored, nestjsx-style).
  { id: 'acc-non-allowlisted-embed', kind: 'row-parity', postgrest: '/posts?select=id,reviews(id)&order=id.asc', nestjsx: '/posts?fields=id&join=reviews&sort=id,ASC' },
];
