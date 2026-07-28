/**
 * Candidate app: @apso/crud with identical entities and query config.
 *
 * Note on @Controller: @apso/crud's @Crud applies Controller('') itself
 * (migration guide says to omit @Controller). We still need distinct route
 * prefixes for three entities in one app, so @Controller('<path>') is applied
 * ABOVE @Crud (decorators run bottom-up, so the path lands last). If that
 * does not produce prefixed routes, the boot smoke test fails and that is a
 * parity finding in its own right.
 */
import { Controller, Injectable, Module, Req, UseGuards } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Crud, CrudController } from '@apso/crud';
import { TypeOrmCrudService } from '@apso/crud-typeorm';
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
export class ApPostService extends TypeOrmCrudService<Post> {
  constructor(@InjectRepository(Post) repo: Repository<Post>) {
    super(repo);
  }
}

@Controller('posts')
@Crud({
  model: { type: Post },
  query: POST_CRUD_QUERY,
})
export class ApPostController extends CrudController<Post> {
  constructor(public service: ApPostService) {
    super();
  }

  // Workaround for apsoai/apso-packages#23: @Crud needs own-prototype methods.
  // Signatures mirror CrudControllerBase exactly (dto deliberately undecorated).
  override async getMany(@Req() req: any) { return super.getMany(req); }
  override async getOne(@Req() req: any) { return super.getOne(req); }
  override async createOne(@Req() req: any, dto: any) { return super.createOne(req, dto); }
  override async createMany(@Req() req: any, dto: any) { return super.createMany(req, dto); }
  override async updateOne(@Req() req: any, dto: any) { return super.updateOne(req, dto); }
  override async replaceOne(@Req() req: any, dto: any) { return super.replaceOne(req, dto); }
  override async deleteOne(@Req() req: any) { return super.deleteOne(req); }
  override async recoverOne(@Req() req: any) { return super.recoverOne(req); }
}

@Injectable()
export class ApCommentService extends TypeOrmCrudService<Comment> {
  constructor(@InjectRepository(Comment) repo: Repository<Comment>) {
    super(repo);
  }
}

@Controller('comments')
@Crud({
  model: { type: Comment },
  query: COMMENT_CRUD_QUERY,
})
export class ApCommentController extends CrudController<Comment> {
  constructor(public service: ApCommentService) {
    super();
  }

  // Workaround for apsoai/apso-packages#23: @Crud needs own-prototype methods.
  // Signatures mirror CrudControllerBase exactly (dto deliberately undecorated).
  override async getMany(@Req() req: any) { return super.getMany(req); }
  override async getOne(@Req() req: any) { return super.getOne(req); }
  override async createOne(@Req() req: any, dto: any) { return super.createOne(req, dto); }
  override async createMany(@Req() req: any, dto: any) { return super.createMany(req, dto); }
  override async updateOne(@Req() req: any, dto: any) { return super.updateOne(req, dto); }
  override async replaceOne(@Req() req: any, dto: any) { return super.replaceOne(req, dto); }
  override async deleteOne(@Req() req: any) { return super.deleteOne(req); }
  override async recoverOne(@Req() req: any) { return super.recoverOne(req); }
}

@Injectable()
export class ApAuthorService extends TypeOrmCrudService<Author> {
  constructor(@InjectRepository(Author) repo: Repository<Author>) {
    super(repo);
  }
}

@Controller('authors')
@Crud({
  model: { type: Author },
  query: AUTHOR_CRUD_QUERY,
})
export class ApAuthorController extends CrudController<Author> {
  constructor(public service: ApAuthorService) {
    super();
  }

  // Workaround for apsoai/apso-packages#23: @Crud needs own-prototype methods.
  // Signatures mirror CrudControllerBase exactly (dto deliberately undecorated).
  override async getMany(@Req() req: any) { return super.getMany(req); }
  override async getOne(@Req() req: any) { return super.getOne(req); }
  override async createOne(@Req() req: any, dto: any) { return super.createOne(req, dto); }
  override async createMany(@Req() req: any, dto: any) { return super.createMany(req, dto); }
  override async updateOne(@Req() req: any, dto: any) { return super.updateOne(req, dto); }
  override async replaceOne(@Req() req: any, dto: any) { return super.replaceOne(req, dto); }
  override async deleteOne(@Req() req: any) { return super.deleteOne(req); }
  override async recoverOne(@Req() req: any) { return super.recoverOne(req); }
}

@Injectable()
export class ApReviewService extends TypeOrmCrudService<Review> {
  constructor(@InjectRepository(Review) repo: Repository<Review>) {
    super(repo);
  }
}

@Controller('reviews')
@Crud({
  model: { type: Review },
  query: REVIEW_CRUD_QUERY,
})
export class ApReviewController extends CrudController<Review> {
  constructor(public service: ApReviewService) {
    super();
  }

  // Workaround for apsoai/apso-packages#23: @Crud needs own-prototype methods.
  // Signatures mirror CrudControllerBase exactly (dto deliberately undecorated).
  override async getMany(@Req() req: any) { return super.getMany(req); }
  override async getOne(@Req() req: any) { return super.getOne(req); }
  override async createOne(@Req() req: any, dto: any) { return super.createOne(req, dto); }
  override async createMany(@Req() req: any, dto: any) { return super.createMany(req, dto); }
  override async updateOne(@Req() req: any, dto: any) { return super.updateOne(req, dto); }
  override async replaceOne(@Req() req: any, dto: any) { return super.replaceOne(req, dto); }
  override async deleteOne(@Req() req: any) { return super.deleteOne(req); }
  override async recoverOne(@Req() req: any) { return super.recoverOne(req); }
}

@Controller('secure-posts')
@UseGuards(HeaderGuard)
@Crud({
  model: { type: Post },
  query: POST_CRUD_QUERY,
  routes: SECURE_ROUTES,
})
export class ApSecurePostController extends CrudController<Post> {
  constructor(public service: ApPostService) {
    super();
  }

  // Workaround for apsoai/apso-packages#23: @Crud needs own-prototype methods.
  // Signatures mirror CrudControllerBase exactly (dto deliberately undecorated).
  override async getMany(@Req() req: any) { return super.getMany(req); }
  override async getOne(@Req() req: any) { return super.getOne(req); }
  override async createOne(@Req() req: any, dto: any) { return super.createOne(req, dto); }
  override async createMany(@Req() req: any, dto: any) { return super.createMany(req, dto); }
  override async updateOne(@Req() req: any, dto: any) { return super.updateOne(req, dto); }
  override async replaceOne(@Req() req: any, dto: any) { return super.replaceOne(req, dto); }
  override async deleteOne(@Req() req: any) { return super.deleteOne(req); }
  override async recoverOne(@Req() req: any) { return super.recoverOne(req); }
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
    ],
    providers: [ApPostService, ApCommentService, ApAuthorService, ApReviewService, HeaderGuard],
  })
  class ApsoAppModule {}
  return ApsoAppModule;
}
