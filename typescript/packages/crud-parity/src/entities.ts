/**
 * Shared entity graph for both apps. Models the relationship shapes
 * platform/server uses: M:1, 1:M, 1:1, M:M, and two-level nesting
 * (comment -> post -> author, author -> posts -> categories).
 */
import {
  Column,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  Relation,
} from 'typeorm';

@Entity('authors')
export class Author {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column()
  email: string;

  @Column({ default: true })
  active: boolean;

  @Column('int')
  age: number;

  @OneToMany(() => Post, (p) => p.author)
  posts: Relation<Post>[];

  @OneToOne(() => Profile, (pr) => pr.author)
  profile: Relation<Profile>;
}

@Entity('profiles')
export class Profile {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  bio: string;

  @Column({ type: 'varchar', nullable: true })
  website: string | null;

  @OneToOne(() => Author, (a) => a.profile)
  @JoinColumn()
  author: Relation<Author>;

  @Column()
  authorId: number;
}

@Entity('posts')
export class Post {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @Column({ type: 'varchar', nullable: true })
  body: string | null;

  @Column('int')
  views: number;

  @Column({ default: false })
  published: boolean;

  @ManyToOne(() => Author, (a) => a.posts)
  author: Relation<Author>;

  @Column()
  authorId: number;

  @OneToMany(() => Comment, (c) => c.post)
  comments: Relation<Comment>[];

  @ManyToMany(() => Category, (c) => c.posts)
  @JoinTable({ name: 'post_categories' })
  categories: Relation<Category>[];
}

@Entity('comments')
export class Comment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  text: string;

  @Column('int')
  likes: number;

  @ManyToOne(() => Post, (p) => p.comments)
  post: Relation<Post>;

  @Column()
  postId: number;
}

@Entity('categories')
export class Category {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @ManyToMany(() => Post, (p) => p.categories)
  posts: Relation<Post>[];
}

@Entity('reviews')
export class Review {
  @PrimaryGeneratedColumn()
  id: number;

  @Column('int')
  rating: number;

  @Column()
  text: string;

  // TypeORM-level eager. @nestjsx/crud uses QueryBuilder, which ignores
  // entity eager flags; the candidate must reproduce that exact behavior,
  // whatever it is — that is what the /reviews cases establish.
  @ManyToOne(() => Author, { eager: true })
  author: Relation<Author>;

  @Column()
  authorId: number;

  @ManyToOne(() => Post)
  post: Relation<Post>;

  @Column()
  postId: number;
}

export const ALL_ENTITIES = [Author, Profile, Post, Comment, Category, Review];
