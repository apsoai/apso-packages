/**
 * Declarative request matrix. Every case is fired at BOTH apps and the
 * responses diffed. `unordered: true` compares result sets ignoring row
 * order (for requests with no deterministic sort).
 *
 * Operator list mirrors @nestjsx/crud 4.5.0's QueryFilterOperator set,
 * which is the parity target for the platform/server migration.
 */
export interface ParityCase {
  id: string;
  category:
    | 'baseline'
    | 'fields'
    | 'filter'
    | 'filter-L'
    | 'or'
    | 'search'
    | 'join'
    | 'join-nested'
    | 'join-eager'
    | 'sort'
    | 'pagination'
    | 'getone'
    | 'auth';
  path: string;
  unordered?: boolean;
  headers?: Record<string, string>;
}

export const MATRIX: ParityCase[] = [
  // --- baseline ---
  { id: 'baseline-getmany', category: 'baseline', path: '/posts', unordered: true },
  { id: 'baseline-sorted', category: 'baseline', path: '/posts?sort=id,ASC' },

  // --- field selection ---
  { id: 'fields-two', category: 'fields', path: '/posts?fields=title,views&sort=id,ASC' },
  { id: 'fields-dup', category: 'fields', path: '/posts?fields=title,title,views&sort=id,ASC' },
  { id: 'fields-with-join', category: 'fields', path: '/posts?fields=title&join=author||name&sort=id,ASC' },

  // --- filter operators (case-sensitive) ---
  { id: 'filter-eq', category: 'filter', path: '/posts?filter=views||$eq||250&sort=id,ASC' },
  { id: 'filter-ne', category: 'filter', path: '/posts?filter=views||$ne||250&sort=id,ASC' },
  { id: 'filter-gt', category: 'filter', path: '/posts?filter=views||$gt||100&sort=id,ASC' },
  { id: 'filter-gte', category: 'filter', path: '/posts?filter=views||$gte||100&sort=id,ASC' },
  { id: 'filter-lt', category: 'filter', path: '/posts?filter=views||$lt||100&sort=id,ASC' },
  { id: 'filter-lte', category: 'filter', path: '/posts?filter=views||$lte||100&sort=id,ASC' },
  { id: 'filter-starts', category: 'filter', path: '/posts?filter=title||$starts||Engine&sort=id,ASC' },
  { id: 'filter-ends', category: 'filter', path: '/posts?filter=title||$ends||Numbers&sort=id,ASC' },
  { id: 'filter-cont', category: 'filter', path: '/posts?filter=title||$cont||Engine&sort=id,ASC' },
  { id: 'filter-excl', category: 'filter', path: '/posts?filter=title||$excl||Engine&sort=id,ASC' },
  { id: 'filter-in', category: 'filter', path: '/posts?filter=views||$in||100,250&sort=id,ASC' },
  { id: 'filter-notin', category: 'filter', path: '/posts?filter=views||$notin||100,250&sort=id,ASC' },
  { id: 'filter-isnull', category: 'filter', path: '/posts?filter=body||$isnull&sort=id,ASC' },
  { id: 'filter-notnull', category: 'filter', path: '/posts?filter=body||$notnull&sort=id,ASC' },
  { id: 'filter-between', category: 'filter', path: '/posts?filter=views||$between||10,250&sort=id,ASC' },
  { id: 'filter-bool', category: 'filter', path: '/posts?filter=published||$eq||true&sort=id,ASC' },
  { id: 'filter-and-two', category: 'filter', path: '/posts?filter=published||$eq||true&filter=views||$gt||50&sort=id,ASC' },
  { id: 'filter-and-three', category: 'filter', path: '/posts?filter=published||$eq||true&filter=views||$gt||50&filter=title||$cont||o&sort=id,ASC' },

  // --- case-insensitive variants ---
  { id: 'filterL-eqL', category: 'filter-L', path: '/authors?filter=name||$eqL||ada lovelace&sort=id,ASC' },
  { id: 'filterL-neL', category: 'filter-L', path: '/authors?filter=name||$neL||ada lovelace&sort=id,ASC' },
  { id: 'filterL-startsL', category: 'filter-L', path: '/authors?filter=name||$startsL||ALAN&sort=id,ASC' },
  { id: 'filterL-endsL', category: 'filter-L', path: '/authors?filter=email||$endsL||EXAMPLE.COM&sort=id,ASC' },
  { id: 'filterL-contL', category: 'filter-L', path: '/posts?filter=title||$contL||engine&sort=id,ASC' },
  { id: 'filterL-exclL', category: 'filter-L', path: '/posts?filter=title||$exclL||engine&sort=id,ASC' },
  { id: 'filterL-inL', category: 'filter-L', path: '/authors?filter=name||$inL||ADA LOVELACE,GRACE HOPPER&sort=id,ASC' },
  { id: 'filterL-notinL', category: 'filter-L', path: '/authors?filter=name||$notinL||ADA LOVELACE&sort=id,ASC' },

  // --- OR conditions ---
  { id: 'or-simple', category: 'or', path: '/posts?or=views||$eq||100&or=views||$eq||999&sort=id,ASC' },
  { id: 'or-with-filter', category: 'or', path: '/posts?filter=published||$eq||true&or=views||$gt||900&sort=id,ASC' },
  { id: 'or-two-filters-one-or', category: 'or', path: '/posts?filter=published||$eq||true&filter=views||$lt||500&or=title||$cont||Imitation&sort=id,ASC' },

  // --- search (s parameter) ---
  { id: 'search-simple-eq', category: 'search', path: '/posts?s=' + encodeURIComponent('{"views":250}') + '&sort=id,ASC' },
  { id: 'search-operator', category: 'search', path: '/posts?s=' + encodeURIComponent('{"views":{"$gt":100}}') + '&sort=id,ASC' },
  { id: 'search-and', category: 'search', path: '/posts?s=' + encodeURIComponent('{"$and":[{"published":true},{"views":{"$gte":100}}]}') + '&sort=id,ASC' },
  { id: 'search-or', category: 'search', path: '/posts?s=' + encodeURIComponent('{"$or":[{"views":999},{"title":{"$cont":"Moths"}}]}') + '&sort=id,ASC' },
  { id: 'search-nested-and-or', category: 'search', path: '/posts?s=' + encodeURIComponent('{"$and":[{"published":true},{"$or":[{"views":{"$lt":50}},{"title":{"$cont":"Engine"}}]}]}') + '&sort=id,ASC' },
  { id: 'search-cont-case', category: 'search', path: '/posts?s=' + encodeURIComponent('{"title":{"$contL":"engine"}}') + '&sort=id,ASC' },

  // --- joins (single level) ---
  { id: 'join-m1', category: 'join', path: '/posts?join=author&sort=id,ASC' },
  { id: 'join-m1-fields', category: 'join', path: '/posts?join=author||name&sort=id,ASC' },
  { id: 'join-1m', category: 'join', path: '/posts?join=comments&sort=id,ASC' },
  { id: 'join-mm', category: 'join', path: '/posts?join=categories&sort=id,ASC' },
  { id: 'join-two', category: 'join', path: '/posts?join=author&join=comments&sort=id,ASC' },
  { id: 'join-filter-on-joined', category: 'join', path: '/posts?join=author&filter=author.name||$eq||Ada Lovelace&sort=id,ASC' },
  { id: 'join-filter-joined-cont', category: 'join', path: '/comments?join=post&filter=post.title||$cont||Engine&sort=id,ASC' },
  { id: 'join-sort-on-joined', category: 'join', path: '/posts?join=author&sort=author.name,ASC&sort=id,ASC' },
  { id: 'join-11', category: 'join', path: '/authors?join=profile&sort=id,ASC' },

  // --- nested joins (two level) ---
  { id: 'joinN-comment-post-author', category: 'join-nested', path: '/comments?join=post&join=post.author&sort=id,ASC' },
  { id: 'joinN-post-author-profile', category: 'join-nested', path: '/posts?join=author&join=author.profile&sort=id,ASC' },
  { id: 'joinN-author-posts-categories', category: 'join-nested', path: '/authors?join=posts&join=posts.categories&sort=id,ASC' },
  { id: 'joinN-filter-on-nested', category: 'join-nested', path: '/comments?join=post&join=post.author&filter=post.author.name||$eq||Grace Hopper&sort=id,ASC' },
  { id: 'joinN-fields-on-nested', category: 'join-nested', path: '/comments?join=post||title&join=post.author||name&sort=id,ASC' },

  // --- sort ---
  { id: 'sort-desc', category: 'sort', path: '/posts?sort=views,DESC' },
  { id: 'sort-multi', category: 'sort', path: '/posts?sort=views,DESC&sort=title,ASC' },
  { id: 'sort-string-asc', category: 'sort', path: '/posts?sort=title,ASC' },

  // --- pagination ---
  { id: 'page-limit', category: 'pagination', path: '/posts?limit=3&sort=id,ASC' },
  { id: 'page-limit-page2', category: 'pagination', path: '/posts?limit=3&page=2&sort=id,ASC' },
  { id: 'page-offset', category: 'pagination', path: '/posts?limit=2&offset=2&sort=id,ASC' },
  { id: 'page-envelope-with-filter', category: 'pagination', path: '/posts?limit=2&page=1&filter=published||$eq||true&sort=id,ASC' },
  { id: 'page-beyond-end', category: 'pagination', path: '/posts?limit=5&page=4&sort=id,ASC' },

  // --- getOne ---
  { id: 'getone-plain', category: 'getone', path: '/posts/3' },
  { id: 'getone-fields', category: 'getone', path: '/posts/3?fields=title,views' },
  { id: 'getone-join', category: 'getone', path: '/posts/3?join=author&join=categories' },
  { id: 'getone-missing', category: 'getone', path: '/posts/404' },

  // --- eager semantics ---
  // Config-level eager (post) should auto-join without a join param; the
  // entity-level TypeORM eager relation (author) gets whatever the reference
  // does. Both apps must agree in every combination.
  { id: 'eager-plain-getmany', category: 'join-eager', path: '/reviews?sort=id,ASC' },
  { id: 'eager-plain-getone', category: 'join-eager', path: '/reviews/1' },
  { id: 'eager-explicit-join', category: 'join-eager', path: '/reviews?join=author&sort=id,ASC' },
  { id: 'eager-both-joins', category: 'join-eager', path: '/reviews?join=post&join=author&sort=id,ASC' },
  { id: 'eager-filter-on-config-eager', category: 'join-eager', path: '/reviews?filter=post.published||$eq||true&sort=id,ASC' },

  // --- access control on generated routes ---
  { id: 'auth-getmany-denied', category: 'auth', path: '/secure-posts?sort=id,ASC' },
  { id: 'auth-getone-denied', category: 'auth', path: '/secure-posts/1' },
  { id: 'auth-getmany-allowed', category: 'auth', path: '/secure-posts?sort=id,ASC', headers: { 'x-test-auth': 'letmein' } },
  { id: 'auth-getone-allowed', category: 'auth', path: '/secure-posts/1', headers: { 'x-test-auth': 'letmein' } },
  { id: 'auth-join-allowed', category: 'auth', path: '/secure-posts?join=author&sort=id,ASC', headers: { 'x-test-auth': 'letmein' } },
];
