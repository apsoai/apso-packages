/**
 * Two DELETE requests for one row at the same time: one answers 200, the
 * other 404. A caller that reads a row and then deletes it (a single-use
 * code) relies on that answer to know whether it was the one that took it.
 *
 * Runs against the @apso app on pglite. The HTTP test states the contract.
 * The test that calls the service twice in the same tick is the one that
 * failed before the fix (both calls deleted the row for 20 of 20 rows): over
 * HTTP on pglite the two requests did not overlap.
 */
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, Like } from 'typeorm';
import { ApCommentService, buildApsoModule } from '../src/app-apso';
import { createSeededDataSource } from '../src/datasource';
import { Comment } from '../src/entities';

jest.setTimeout(180000);

let app: INestApplication;
let ds: DataSource;

beforeAll(async () => {
  ds = await createSeededDataSource('concurrent_delete');
  const module = await Test.createTestingModule({ imports: [buildApsoModule(async () => ds)] }).compile();
  app = module.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app?.close();
  if (ds?.isInitialized) await ds.destroy();
});

describe('concurrent deleteOne', () => {
  it('of two deletes of one row, one answers 200 and the other 404', async () => {
    const rows = await ds
      .getRepository(Comment)
      .save(Array.from({ length: 20 }, (_, i) => ({ text: `single use ${i}`, likes: 0, postId: 1 })));

    const outcomes: string[] = [];
    for (const { id } of rows) {
      const answers = await Promise.all([
        request(app.getHttpServer()).delete(`/comments/${id}`),
        request(app.getHttpServer()).delete(`/comments/${id}`),
      ]);
      outcomes.push(
        answers
          .map((res) => res.status)
          .sort()
          .join(','),
      );
    }

    expect(outcomes).toEqual(rows.map(() => '200,404'));
    expect(await ds.getRepository(Comment).countBy({ text: Like('single use %') })).toBe(0);
  });

  it('two deleteOne calls that both start before either finishes: one deletes, one throws NotFound', async () => {
    const service = app.get(ApCommentService);
    const rows = await ds
      .getRepository(Comment)
      .save(Array.from({ length: 20 }, (_, i) => ({ text: `same tick ${i}`, likes: 0, postId: 1 })));

    const outcomes: string[] = [];
    for (const { id } of rows) {
      const req: any = { parsed: { paramsFilter: [{ field: 'id', operator: '$eq', value: id }], search: {} }, options: {} };
      const settled = await Promise.allSettled([service.deleteOne(req), service.deleteOne(req)]);
      outcomes.push(
        settled
          .map((r) => (r.status === 'fulfilled' ? 'deleted' : (r.reason as Error).constructor.name))
          .sort()
          .join(','),
      );
    }

    expect(outcomes).toEqual(rows.map(() => 'NotFoundException,deleted'));
    expect(await ds.getRepository(Comment).countBy({ likes: 0, postId: 1, text: Like('same tick %') })).toBe(0);
  });

  it('a delete of a row that is not there still answers 404', async () => {
    const res = await request(app.getHttpServer()).delete('/comments/999999');
    expect(res.status).toBe(404);
  });
});
