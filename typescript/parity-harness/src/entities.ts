/**
 * Shared entities for both apps: a 3-level graph so nested joins are real.
 * Author -> posts (one-to-many) -> comments (one-to-many).
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

@Entity('author')
export class Author {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  email: string | null;

  @Column({ type: 'integer' })
  age: number;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'text', default: 'Free' })
  plan: string;

  @OneToMany(() => Post, p => p.author)
  posts: Post[];
}

@Entity('post')
export class Post {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'integer', default: 0 })
  views: number;

  @Column({ type: 'text', default: 'draft' })
  status: string;

  @ManyToOne(() => Author, a => a.posts)
  @JoinColumn({ name: 'authorId' })
  author: Author;

  @Column({ type: 'integer' })
  authorId: number;

  @OneToMany(() => Comment, c => c.post)
  comments: Comment[];
}

@Entity('comment')
export class Comment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  text: string;

  @ManyToOne(() => Post, p => p.comments)
  @JoinColumn({ name: 'postId' })
  post: Post;

  @Column({ type: 'integer' })
  postId: number;
}

/** Deterministic seed, inserted in fixed order into a fresh DB. */
export const SEED = {
  authors: [
    { name: 'Ada', email: 'ada@example.com', age: 36, active: true, plan: 'Pro' },
    { name: 'Bob', email: null, age: 52, active: false, plan: 'Free' },
    { name: 'Cleo', email: 'cleo@example.com', age: 28, active: true, plan: 'Team' },
    { name: 'dan', email: 'dan@example.com', age: 41, active: true, plan: 'Free' },
  ],
  posts: [
    { title: 'Intro to CRUD', views: 100, status: 'published', authorId: 1 },
    { title: 'Advanced Joins', views: 250, status: 'published', authorId: 1 },
    { title: 'Draft thoughts', views: 3, status: 'draft', authorId: 2 },
    { title: 'Filters deep dive', views: 90, status: 'published', authorId: 3 },
    { title: 'sorting things', views: 40, status: 'review', authorId: 3 },
  ],
  comments: [
    { text: 'great post', postId: 1 },
    { text: 'thanks!', postId: 1 },
    { text: 'needs work', postId: 3 },
    { text: 'love it', postId: 4 },
  ],
};
