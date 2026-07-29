/**
 * Mutation-route parity: the same deterministic sequence of writes is applied
 * to both apps (each on its own identically-seeded pglite). Because the
 * sequence and the seeds are identical, generated IDs and final state must be
 * identical too. Covers createOne, createMany (bulk), updateOne (PATCH),
 * replaceOne (PUT), deleteOne, their error paths, route exclusion, and
 * guarded mutations.
 */
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { buildNestjsxModule } from '../src/app-nestjsx';
import { buildApsoModule } from '../src/app-apso';
import { createSeededDataSource } from '../src/datasource';

jest.setTimeout(180000);

let refApp: INestApplication;
let candApp: INestApplication;
let refDs: DataSource;
let candDs: DataSource;

const sortKeys = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.keys(v as Record<string, unknown>)
      .sort()
      .reduce((acc: Record<string, unknown>, k) => {
        acc[k] = sortKeys((v as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return v;
};

interface Step {
  id: string;
  method: 'post' | 'patch' | 'put' | 'delete';
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/** Applied in order; both apps see the exact same sequence. */
const STEPS: Step[] = [
  {
    id: 'create-one',
    method: 'post',
    path: '/posts',
    body: { title: 'Parity Post', body: 'created by suite', views: 1, published: false, authorId: 1, createdAt: '2026-07-04T00:00:00.000Z', score: '4.00' },
  },
  {
    id: 'create-one-null-body-field',
    method: 'post',
    path: '/posts',
    body: { title: 'Null body', body: null, views: 2, published: true, authorId: 2, createdAt: '2026-07-05T00:00:00.000Z', score: '5.00' },
  },
  {
    id: 'create-many-bulk',
    method: 'post',
    path: '/posts/bulk',
    body: {
      bulk: [
        { title: 'Bulk A', views: 10, published: false, authorId: 3, createdAt: '2026-07-06T00:00:00.000Z', score: '6.00' },
        { title: 'Bulk B', views: 20, published: true, authorId: 1, createdAt: '2026-07-07T00:00:00.000Z', score: '7.00' },
      ],
    },
  },
  { id: 'create-invalid-missing-notnull', method: 'post', path: '/posts', body: { views: 5 } },
  { id: 'update-patch', method: 'patch', path: '/posts/1', body: { views: 111 } },
  { id: 'update-patch-missing', method: 'patch', path: '/posts/404', body: { views: 1 } },
  {
    id: 'replace-put',
    method: 'put',
    path: '/posts/2',
    body: { id: 2, title: 'Replaced Moths', body: 'replaced', views: 300, published: false, authorId: 2, createdAt: '2026-07-08T00:00:00.000Z', score: '8.00' },
  },
  { id: 'delete-one', method: 'delete', path: '/posts/6' },
  { id: 'delete-missing', method: 'delete', path: '/posts/404' },
  // Route exclusion: deleteOneBase and createManyBase are excluded on
  // secure-posts in BOTH configs; whatever the reference answers (404), the
  // candidate must answer identically.
  {
    id: 'excluded-delete-route',
    method: 'delete',
    path: '/secure-posts/1',
    headers: { 'x-test-auth': 'letmein' },
  },
  {
    id: 'excluded-bulk-route',
    method: 'post',
    path: '/secure-posts/bulk',
    body: { bulk: [{ title: 'x', views: 0, published: false, authorId: 1, createdAt: '2026-07-10T00:00:00.000Z', score: '0.10' }] },
    headers: { 'x-test-auth': 'letmein' },
  },
  // Guarded mutations
  {
    id: 'auth-create-denied',
    method: 'post',
    path: '/secure-posts',
    body: { title: 'denied', views: 0, published: false, authorId: 1 },
  },
  {
    id: 'auth-create-allowed',
    method: 'post',
    path: '/secure-posts',
    body: { title: 'allowed', views: 7, published: false, authorId: 1, createdAt: '2026-07-09T00:00:00.000Z', score: '9.00' },
    headers: { 'x-test-auth': 'letmein' },
  },
  {
    id: 'auth-patch-allowed',
    method: 'patch',
    path: '/secure-posts/3',
    body: { views: 1000 },
    headers: { 'x-test-auth': 'letmein' },
  },
  // --- corpus expansion (#22 handoff): writes depth ---
  { id: 'bulk-empty-array', method: 'post', path: '/posts/bulk', body: { bulk: [] } },
  {
    id: 'create-extra-unknown-field',
    method: 'post',
    path: '/posts',
    body: { title: 'Extra field', views: 3, published: false, authorId: 1, createdAt: '2026-07-01T00:00:00.000Z', score: '1.00', notAColumn: 'ignored?' },
  },
  {
    id: 'patch-id-mismatch-in-body',
    method: 'patch',
    path: '/posts/1',
    body: { id: 999, views: 123 },
  },
  // auth.persist: authorId must be forced to 1 regardless of posted body
  {
    id: 'scoped-create-persist-overrides-body',
    method: 'post',
    path: '/scoped-posts',
    body: { title: 'Persisted scope', views: 9, published: false, authorId: 3, createdAt: '2026-07-02T00:00:00.000Z', score: '2.00' },
  },
  {
    id: 'scoped-patch-out-of-scope',
    method: 'patch',
    path: '/scoped-posts/2',
    body: { views: 55555 },
  },
  {
    id: 'scoped-bulk-persist',
    method: 'post',
    path: '/scoped-posts/bulk',
    body: { bulk: [{ title: 'Scoped bulk', views: 4, published: true, authorId: 2, createdAt: '2026-07-03T00:00:00.000Z', score: '3.00' }] },
  },
];

beforeAll(async () => {
  refDs = await createSeededDataSource('ref');
  candDs = await createSeededDataSource('cand');

  const refModule = await Test.createTestingModule({
    imports: [buildNestjsxModule(async () => refDs)],
  })
    .setLogger(console)
    .compile();
  refApp = refModule.createNestApplication();
  await refApp.init();

  const candModule = await Test.createTestingModule({
    imports: [buildApsoModule(async () => candDs)],
  })
    .setLogger(console)
    .compile();
  candApp = candModule.createNestApplication();
  await candApp.init();
});

afterAll(async () => {
  await refApp?.close();
  await candApp?.close();
  await refDs?.destroy();
  await candDs?.destroy();
});

describe('mutation-route parity', () => {
  // Sequential and order-dependent: each step mutates state that later steps
  // (and the final state check) depend on. it.each preserves order under
  // --runInBand.
  it.each(STEPS.map((s) => [s.id, s] as [string, Step]))('%s', async (_id, s) => {
    const refRes = await (request(refApp.getHttpServer()) as any)
      [s.method](s.path)
      .set(s.headers ?? {})
      .send(s.body as any);
    const candRes = await (request(candApp.getHttpServer()) as any)
      [s.method](s.path)
      .set(s.headers ?? {})
      .send(s.body as any);

    expect({ status: candRes.status, body: sortKeys(candRes.body) }).toEqual({
      status: refRes.status,
      body: sortKeys(refRes.body),
    });
  });

  it('final state identical after the full sequence', async () => {
    for (const path of ['/posts?sort=id,ASC', '/posts?join=author&join=comments&sort=id,ASC']) {
      const ref = await request(refApp.getHttpServer()).get(path);
      const cand = await request(candApp.getHttpServer()).get(path);
      expect({ status: cand.status, body: sortKeys(cand.body) }).toEqual({
        status: ref.status,
        body: sortKeys(ref.body),
      });
    }
  });
});
