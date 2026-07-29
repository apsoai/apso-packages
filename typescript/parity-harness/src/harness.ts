/**
 * Boot helper: one Nest app per library, each with its own in-memory
 * sqlite DB seeded identically.
 */
import { INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule, getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Author, Post, Comment, SEED } from './entities';

export async function bootApp(
  controllers: any[],
  providers: any[]
): Promise<INestApplication> {
  @Module({
    imports: [
      TypeOrmModule.forRoot({
        type: 'better-sqlite3',
        database: ':memory:',
        entities: [Author, Post, Comment],
        synchronize: true,
      }),
      TypeOrmModule.forFeature([Author, Post, Comment]),
    ],
    controllers,
    providers,
  })
  class HarnessModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [HarnessModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  const ds = app.get<DataSource>(getDataSourceToken());
  await seed(ds);
  return app;
}

async function seed(ds: DataSource): Promise<void> {
  for (const a of SEED.authors) await ds.getRepository(Author).save(ds.getRepository(Author).create(a));
  for (const p of SEED.posts) await ds.getRepository(Post).save(ds.getRepository(Post).create(p));
  for (const c of SEED.comments) await ds.getRepository(Comment).save(ds.getRepository(Comment).create(c));
}
