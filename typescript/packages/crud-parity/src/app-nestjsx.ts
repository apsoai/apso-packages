/**
 * Reference app: @nestjsx/crud 4.5.0 — the parity baseline.
 */
import { Controller, Injectable, Module, UseGuards } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Crud } from '@nestjsx/crud';
import { TypeOrmCrudService } from '@nestjsx/crud-typeorm';
import { ALL_ENTITIES, Author, Comment, Post, Review } from './entities';
import {
  AUTHOR_CRUD_QUERY,
  COMMENT_CRUD_QUERY,
  POST_CRUD_QUERY,
  REVIEW_CRUD_QUERY,
  SECURE_ROUTES,
} from './crud-config';
import { HeaderGuard } from './auth';

@Injectable()
export class NxPostService extends TypeOrmCrudService<Post> {
  constructor(@InjectRepository(Post) repo: Repository<Post>) {
    super(repo);
  }
}

@Crud({
  model: { type: Post },
  query: POST_CRUD_QUERY,
})
@Controller('posts')
export class NxPostController {
  constructor(public service: NxPostService) {}
}

@Injectable()
export class NxCommentService extends TypeOrmCrudService<Comment> {
  constructor(@InjectRepository(Comment) repo: Repository<Comment>) {
    super(repo);
  }
}

@Crud({
  model: { type: Comment },
  query: COMMENT_CRUD_QUERY,
})
@Controller('comments')
export class NxCommentController {
  constructor(public service: NxCommentService) {}
}

@Injectable()
export class NxAuthorService extends TypeOrmCrudService<Author> {
  constructor(@InjectRepository(Author) repo: Repository<Author>) {
    super(repo);
  }
}

@Crud({
  model: { type: Author },
  query: AUTHOR_CRUD_QUERY,
})
@Controller('authors')
export class NxAuthorController {
  constructor(public service: NxAuthorService) {}
}

@Injectable()
export class NxReviewService extends TypeOrmCrudService<Review> {
  constructor(@InjectRepository(Review) repo: Repository<Review>) {
    super(repo);
  }
}

@Crud({
  model: { type: Review },
  query: REVIEW_CRUD_QUERY,
})
@Controller('reviews')
export class NxReviewController {
  constructor(public service: NxReviewService) {}
}

@UseGuards(HeaderGuard)
@Crud({
  model: { type: Post },
  query: POST_CRUD_QUERY,
  routes: SECURE_ROUTES,
})
@Controller('secure-posts')
export class NxSecurePostController {
  constructor(public service: NxPostService) {}
}

export function buildNestjsxModule(dataSourceFactory: () => Promise<DataSource>) {
  @Module({
    imports: [
      TypeOrmModule.forRootAsync({
        useFactory: () => ({}) as any,
        dataSourceFactory: async () => dataSourceFactory(),
      }),
      TypeOrmModule.forFeature(ALL_ENTITIES),
    ],
    controllers: [
      NxPostController,
      NxCommentController,
      NxAuthorController,
      NxReviewController,
      NxSecurePostController,
    ],
    providers: [NxPostService, NxCommentService, NxAuthorService, NxReviewService, HeaderGuard],
  })
  class NestjsxAppModule {}
  return NestjsxAppModule;
}
