/**
 * PATCH /:id with a condition next to the id: the row is updated only while
 * it still meets the condition, and the request answers 404 otherwise. A
 * caller that marks a row used (set revoked where revoked is null) relies on
 * that answer to know whether it was the one that marked it.
 *
 * Runs real HTTP requests against the @apso app on pglite. pglite cannot show
 * two overlapping requests being separated: every request shares one session
 * there, so a row lock does not make the second wait. This spec checks the
 * condition in both dialects and that the read takes the row lock inside the
 * save's transaction. The overlap itself was run on Postgres 16 through a
 * generated service (see the pull request).
 */
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { buildApsoModule } from '../src/app-apso';
import { createSeededDataSource } from '../src/datasource';
import { Comment } from '../src/entities';

jest.setTimeout(180000);

let app: INestApplication;
let ds: DataSource;
const comments = () => ds.getRepository(Comment);
const fresh = async () => (await comments().save({ text: 'unused', likes: 0, postId: 1 })).id;

beforeAll(async () => {
  ds = await createSeededDataSource('conditional_update');
  const module = await Test.createTestingModule({ imports: [buildApsoModule(async () => ds)] }).compile();
  app = module.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app?.close();
  if (ds?.isInitialized) await ds.destroy();
});

describe('PATCH /:id with a condition', () => {
  it.each([
    ['nestjsx', (id: number) => `/comments/${id}?filter=${encodeURIComponent('likes||$eq||0')}`, {}],
    ['postgrest', (id: number) => `/comments/${id}?likes=eq.0`, { 'X-Crud-Dialect': 'postgrest' }],
  ])('%s: the first update that ends the condition answers 200, the next one 404', async (_dialect, path, headers) => {
    const id = await fresh();
    const first = await request(app.getHttpServer()).patch(path(id)).set(headers).send({ likes: 1, text: 'first' });
    const second = await request(app.getHttpServer()).patch(path(id)).set(headers).send({ likes: 2, text: 'second' });

    expect([first.status, second.status]).toEqual([200, 404]);
    expect(await comments().findOneBy({ id })).toMatchObject({ likes: 1, text: 'first' });
  });

  it('postgrest: a null condition (is.null) is checked the same way', async () => {
    const id = await fresh();
    const path = `/comments/${id}?text=is.null`;
    const res = await request(app.getHttpServer()).patch(path).set('X-Crud-Dialect', 'postgrest').send({ likes: 9 });

    expect(res.status).toBe(404);
    expect(await comments().findOneBy({ id })).toMatchObject({ likes: 0 });
  });

  it('a PATCH without a condition still updates the row', async () => {
    const id = await fresh();
    const res = await request(app.getHttpServer()).patch(`/comments/${id}`).send({ likes: 3 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, likes: 3 });
  });

  it('reads the row with a lock, in the same transaction as the write', async () => {
    const id = await fresh();
    const queries: string[] = [];
    const logger = ds.logger;
    (ds as any).logger = {
      logQuery: (query: string) => queries.push(query),
      logQueryError: () => undefined,
      logQuerySlow: () => undefined,
      logSchemaBuild: () => undefined,
      logMigration: () => undefined,
      log: () => undefined,
    };
    try {
      await request(app.getHttpServer()).patch(`/comments/${id}?filter=${encodeURIComponent('likes||$eq||0')}`).send({ likes: 1 });
    } finally {
      (ds as any).logger = logger;
    }

    const step = (pattern: RegExp) => queries.findIndex((q) => pattern.test(q));
    const begin = step(/^START TRANSACTION/i);
    const read = step(/^SELECT[\s\S]*"likes" = [\s\S]*FOR UPDATE/i);
    const write = step(/^UPDATE/i);
    const commit = step(/^COMMIT/i);
    expect([begin, read, write, commit].every((i) => i >= 0)).toBe(true);
    expect([begin, read, write, commit]).toEqual([begin, read, write, commit].slice().sort((a, b) => a - b));
    // One transaction: the save does not open its own.
    expect(queries.filter((q) => /^START TRANSACTION/i.test(q))).toHaveLength(1);
  });
});
