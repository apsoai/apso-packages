/**
 * Per-entity @Crud query options, shared verbatim by both apps so any
 * behavioral difference comes from the library, not the config.
 * Join whitelists mirror how platform/server declares joins (eager: false,
 * nested paths declared explicitly).
 */
export const POST_CRUD_QUERY = {
  join: {
    author: { eager: false },
    'author.profile': { eager: false },
    comments: { eager: false },
    categories: { eager: false },
  },
};

export const COMMENT_CRUD_QUERY = {
  join: {
    post: { eager: false },
    'post.author': { eager: false },
    'post.author.profile': { eager: false },
  },
};

export const AUTHOR_CRUD_QUERY = {
  join: {
    posts: { eager: false },
    profile: { eager: false },
    'posts.categories': { eager: false },
    'posts.comments': { eager: false },
  },
};

/**
 * Eager semantics coverage: config-level eager join (post) must auto-join on
 * every request; the entity-level TypeORM eager relation (author) gets
 * whatever treatment the reference gives it — the tests pin that behavior.
 */
export const REVIEW_CRUD_QUERY = {
  join: {
    post: { eager: true },
    author: { eager: false },
  },
};

/** Route surface restriction parity for the secure controller. */
export const SECURE_ROUTES = {
  exclude: ['deleteOneBase', 'createManyBase'] as any,
};


/**
 * Auth scoping parity (mirrors platform/server tenant isolation): reads are
 * hard-scoped to authorId=1 and creates persist authorId=1 regardless of the
 * posted body. Filters/or must NOT be able to widen the scope.
 * Shape is nestjsx AuthOptions; both libraries receive the identical object.
 */
export const SCOPED_AUTH = {
  filter: () => ({ authorId: 1 }),
  persist: () => ({ authorId: 1 }),
};
