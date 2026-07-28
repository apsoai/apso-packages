/**
 * Deterministic fixtures. Both apps get identical data, inserted in the same
 * order with explicit IDs so responses are byte-comparable.
 *
 * Data is shaped to exercise operators: mixed case for the L variants, nulls
 * for $isnull/$notnull, numeric spreads for ranges, and overlapping title
 * substrings for $cont/$excl.
 */
import { DataSource } from 'typeorm';
import { Author, Category, Comment, Post, Profile, Review } from './entities';

export async function seed(ds: DataSource, schema: string): Promise<void> {
  const authors = ds.getRepository(Author);
  const profiles = ds.getRepository(Profile);
  const posts = ds.getRepository(Post);
  const comments = ds.getRepository(Comment);
  const categories = ds.getRepository(Category);

  await authors.insert([
    { id: 1, name: 'Ada Lovelace', email: 'ada@example.com', active: true, age: 36 },
    { id: 2, name: 'Grace Hopper', email: 'GRACE@example.com', active: true, age: 85 },
    { id: 3, name: 'alan turing', email: 'alan@example.com', active: false, age: 41 },
  ]);

  await profiles.insert([
    { id: 1, bio: 'First programmer', website: 'https://ada.dev', authorId: 1 },
    { id: 2, bio: 'COBOL pioneer', website: null, authorId: 2 },
    { id: 3, bio: 'Computability', website: 'https://turing.dev', authorId: 3 },
  ]);

  await categories.insert([
    { id: 1, name: 'Math' },
    { id: 2, name: 'Computing' },
    { id: 3, name: 'History' },
    { id: 4, name: 'unused' },
  ]);

  await posts.insert([
    { id: 1, title: 'Notes on the Engine', body: 'analytical engine notes', views: 100, published: true, authorId: 1 },
    { id: 2, title: 'Bugs and Moths', body: null, views: 250, published: true, authorId: 2 },
    { id: 3, title: 'On Computable Numbers', body: 'entscheidungsproblem', views: 999, published: true, authorId: 3 },
    { id: 4, title: 'engine internals', body: 'lowercase title case test', views: 10, published: false, authorId: 1 },
    { id: 5, title: 'Compilers 101', body: 'flow-matic history', views: 250, published: false, authorId: 2 },
    { id: 6, title: 'Imitation Game', body: null, views: 0, published: true, authorId: 3 },
  ]);

  // M:M links via the join table
  await ds.query(
    `INSERT INTO "${schema}"."post_categories" ("postsId", "categoriesId") VALUES ` +
      `(1,1),(1,2),(2,2),(3,1),(3,2),(3,3),(5,3),(6,3)`
  );

  await comments.insert([
    { id: 1, text: 'brilliant', likes: 5, postId: 1 },
    { id: 2, text: 'Fascinating read', likes: 12, postId: 1 },
    { id: 3, text: 'found a moth', likes: 3, postId: 2 },
    { id: 4, text: 'UNDECIDABLE', likes: 40, postId: 3 },
    { id: 5, text: 'halting problem', likes: 0, postId: 3 },
    { id: 6, text: 'needs more detail', likes: 1, postId: 4 },
    { id: 7, text: 'compile this', likes: 7, postId: 5 },
    { id: 8, text: 'great movie too', likes: 2, postId: 6 },
    { id: 9, text: 'second thoughts', likes: 4, postId: 6 },
    { id: 10, text: 'Third opinion', likes: 6, postId: 3 },
    { id: 11, text: 'moth was real', likes: 9, postId: 2 },
    { id: 12, text: 'archived note', likes: 0, postId: 1 },
  ]);

  await ds.getRepository(Review).insert([
    { id: 1, rating: 5, text: 'seminal', authorId: 2, postId: 1 },
    { id: 2, rating: 3, text: 'dense', authorId: 3, postId: 1 },
    { id: 3, rating: 4, text: 'historic', authorId: 1, postId: 3 },
  ]);
}
