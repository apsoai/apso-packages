/**
 * Candidate app: @apso/crud with identical entities and query config.
 *
 * Deliberately a line-for-line mirror of app-nestjsx.ts except the two crud
 * import lines and class name prefixes — the same import-swap contract
 * apso-build's parity-harness enforces mechanically. The #23 forwarding
 * workaround is gone: the reworked @apso/crud injects base routes like
 * nestjsx's factory does.
 */
import { Controller, Injectable, Module, UseGuards } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Crud } from '@apso/crud';
import * as apsoCrud from '@apso/crud';
// Defensive: CrudAuth lands in apso-build's pending commit. Until then a
// no-op keeps the suite bootable and the scoped cases fail as parity diffs
// (candidate unscoped) instead of crashing the suite at import.
const ApCrudAuth: any = (apsoCrud as any).CrudAuth ?? (() => (t: any) => t);
import { TypeOrmCrudService } from '@apso/crud-typeorm';
import { ALL_ENTITIES, Author, Comment, Post, Review } from './entities';
import {
  AUTHOR_CRUD_QUERY,
  COMMENT_CRUD_QUERY,
  POST_CRUD_QUERY,
  REVIEW_CRUD_QUERY,
  SCOPED_AUTH,
  SECURE_ROUTES,
} from './crud-config';
import { HeaderGuard } from './auth';

@Injectable()
export class ApPostService extends TypeOrmCrudService<Post> {
  constructor(@InjectRepository(Post) repo: Repository<Post>) {
    super(repo);
  }
}

@Crud({
  model: { type: Post },
  query: POST_CRUD_QUERY,
})
@Controller('posts')
export class ApPostController {
  constructor(public service: ApPostService) {}
}

@Injectable()
export class ApCommentService extends TypeOrmCrudService<Comment> {
  constructor(@InjectRepository(Comment) repo: Repository<Comment>) {
    super(repo);
  }
}

@Crud({
  model: { type: Comment },
  query: COMMENT_CRUD_QUERY,
})
@Controller('comments')
export class ApCommentController {
  constructor(public service: ApCommentService) {}
}

@Injectable()
export class ApAuthorService extends TypeOrmCrudService<Author> {
  constructor(@InjectRepository(Author) repo: Repository<Author>) {
    super(repo);
  }
}

@Crud({
  model: { type: Author },
  query: AUTHOR_CRUD_QUERY,
})
@Controller('authors')
export class ApAuthorController {
  constructor(public service: ApAuthorService) {}
}

@Injectable()
export class ApReviewService extends TypeOrmCrudService<Review> {
  constructor(@InjectRepository(Review) repo: Repository<Review>) {
    super(repo);
  }
}

@Crud({
  model: { type: Review },
  query: REVIEW_CRUD_QUERY,
})
@Controller('reviews')
export class ApReviewController {
  constructor(public service: ApReviewService) {}
}

@UseGuards(HeaderGuard)
@Crud({
  model: { type: Post },
  query: POST_CRUD_QUERY,
  routes: SECURE_ROUTES,
})
@Controller('secure-posts')
export class ApSecurePostController {
  constructor(public service: ApPostService) {}
}

@Crud({
  model: { type: Post },
  query: POST_CRUD_QUERY,
})
@ApCrudAuth(SCOPED_AUTH)
@Controller('scoped-posts')
export class ApScopedPostController {
  constructor(public service: ApPostService) {}
}

export function buildApsoModule(dataSourceFactory: () => Promise<DataSource>) {
  @Module({
    imports: [
      TypeOrmModule.forRootAsync({
        useFactory: () => ({}) as any,
        dataSourceFactory: async () => dataSourceFactory(),
      }),
      TypeOrmModule.forFeature(ALL_ENTITIES),
    ],
    controllers: [
      ApPostController,
      ApCommentController,
      ApAuthorController,
      ApReviewController,
      ApSecurePostController,
      ApScopedPostController,
    ],
    providers: [ApPostService, ApCommentService, ApAuthorService, ApReviewService, HeaderGuard],
  })
  class ApsoAppModule {}
  return ApsoAppModule;
}
