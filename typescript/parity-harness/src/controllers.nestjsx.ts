/**
 * The nestjsx side. IMPORTANT: controllers.apso.ts must be IDENTICAL to
 * this file except for the two import lines — that identity is asserted by
 * the harness (import-swap is the whole migration claim of #14).
 */
import { Controller } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Crud, CrudAuth, CrudController } from '@nestjsx/crud';
import { TypeOrmCrudService } from '@nestjsx/crud-typeorm';
import { Author } from './entities';

@Injectable()
export class AuthorService extends TypeOrmCrudService<Author> {
  constructor(@InjectRepository(Author) repo: Repository<Author>) {
    super(repo);
  }
}

@Crud({
  model: { type: Author },
  params: {
    id: { field: 'id', type: 'number', primary: true },
  },
  query: {
    limit: 20,
    join: {
      posts: {},
      'posts.comments': {},
    },
  },
})
@Controller('authors')
export class AuthorController implements CrudController<Author> {
  constructor(public service: AuthorService) {}
}

@Crud({
  model: { type: Author },
  params: {
    id: { field: 'id', type: 'number', primary: true },
  },
  query: {
    limit: 20,
    join: {
      posts: {},
    },
  },
})
@CrudAuth({
  filter: () => ({ active: true }),
})
@Controller('scoped-authors')
export class ScopedAuthorController implements CrudController<Author> {
  constructor(public service: AuthorService) {}
}
