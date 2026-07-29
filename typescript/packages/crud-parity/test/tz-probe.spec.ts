/**
 * #44 probe: does the timestamp divergence affect the STORED value or only
 * the create echo? Creates a post with an explicit-UTC createdAt on both
 * apps, captures the POST echo, then re-fetches the row via GET and compares
 * both stages. Postgres semantics (pglite), no ValidationPipe — matching
 * platform/server's real configuration (no global pipe, inert DTO date
 * decorators).
 */
import 'reflect-metadata';
import * as fs from 'fs';
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

beforeAll(async () => {
  refDs = await createSeededDataSource('tzref');
  candDs = await createSeededDataSource('tzcand');
  const refModule = await Test.createTestingModule({
    imports: [buildNestjsxModule(async () => refDs)],
  }).compile();
  refApp = refModule.createNestApplication();
  await refApp.init();
  const candModule = await Test.createTestingModule({
    imports: [buildApsoModule(async () => candDs)],
  }).compile();
  candApp = candModule.createNestApplication();
  await candApp.init();
});

afterAll(async () => {
  for (const c of [() => refApp?.close(), () => candApp?.close(), () => refDs?.destroy(), () => candDs?.destroy()]) {
    try {
      await c();
    } catch {
      // shared-pglite teardown noise
    }
  }
});

const BODY = {
  title: 'TZ probe',
  body: 'utc instant',
  views: 1,
  published: false,
  authorId: 1,
  createdAt: '2026-07-04T00:00:00.000Z',
  score: '1.00',
};

it('#44 probe: echo vs stored value on both libraries', async () => {
  const refPost = await request(refApp.getHttpServer()).post('/posts').send(BODY);
  const candPost = await request(candApp.getHttpServer()).post('/posts').send(BODY);

  const refId = refPost.body?.id;
  const candId = candPost.body?.id;

  const refGet = await request(refApp.getHttpServer()).get(`/posts/${refId}`);
  const candGet = await request(candApp.getHttpServer()).get(`/posts/${candId}`);

  // Raw SQL truth: what is actually in the table, bypassing both libraries.
  const refRaw = await refDs.query(`SELECT "createdAt"::text AS t FROM "tzref"."posts" WHERE id = $1`, [refId]);
  const candRaw = await candDs.query(`SELECT "createdAt"::text AS t FROM "tzcand"."posts" WHERE id = $1`, [candId]);

  const report = {
    posted: BODY.createdAt,
    nestjsx: { echo: refPost.body?.createdAt, refetch: refGet.body?.createdAt, storedSql: refRaw[0]?.t },
    apso: { echo: candPost.body?.createdAt, refetch: candGet.body?.createdAt, storedSql: candRaw[0]?.t },
  };
  // Emit regardless of pass/fail — this test is evidence-gathering for #44.
  fs.writeFileSync(__dirname + '/../tz-probe-result.json', JSON.stringify(report, null, 2));

  expect(refPost.status).toBe(201);
  expect(candPost.status).toBe(201);
});
