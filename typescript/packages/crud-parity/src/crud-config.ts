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
  },
};

export const AUTHOR_CRUD_QUERY = {
  join: {
    posts: { eager: false },
    profile: { eager: false },
    'posts.categories': { eager: false },
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
