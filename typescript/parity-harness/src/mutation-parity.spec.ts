/**
 * Differential WRITE parity: nestjsx 4.5.0 vs @apso/crud (apso-packages#22).
 * Covers the empty-bulk 400 body (#45) and confirms create/replace echo stays
 * byte-identical to nestjsx for fully-specified bodies.
 *
 * On #44 (create/replace timestamp echo): @apso/crud INTENTIONALLY diverges —
 * it echoes the correct UTC instant the client sent, whereas nestjsx re-hydrates
 * it through the server's local timezone (a shift). Matt's decision (2026-07-29)
 * is to keep the correct behavior and NOT replicate nestjsx's bug, so #44 is an
 * accepted divergence in the 147-case corpus, not a mismatch. That divergence
 * only manifests on Postgres (the timestamp driver path); this sqlite harness
 * can't reproduce it, so the create cases below use non-timestamp columns and
 * assert parity — proving the echo is otherwise unchanged.
 */
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootApp } from './harness';
import {
  AuthorController as NController,
  ScopedAuthorController as NScoped,
  AuthorService as NService,
} from './controllers.nestjsx';
import {
  AuthorController as AController,
  ScopedAuthorController as AScoped,
  AuthorService as AService,
} from './controllers.apso';

let nApp: INestApplication;
let aApp: INestApplication;

beforeAll(async () => {
  nApp = await bootApp([NController, NScoped], [NService]);
  aApp = await bootApp([AController, AScoped], [AService]);
});
afterAll(async () => {
  await nApp?.close();
  await aApp?.close();
});

async function bothPost(pathUrl: string, body: any) {
  const [n, a] = await Promise.all([
    request(nApp.getHttpServer()).post(pathUrl).send(body),
    request(aApp.getHttpServer()).post(pathUrl).send(body),
  ]);
  return { n, a };
}

describe('differential write parity: nestjsx 4.5.0 vs @apso/crud', () => {
  it('createOne echoes identically (fully-specified body)', async () => {
    const body = { name: 'Eve', email: 'eve@example.com', age: 33, active: true, plan: 'Pro' };
    const { n, a } = await bothPost('/authors', body);
    expect(a.status).toBe(n.status);
    expect(a.body).toEqual(n.body);
    expect(a.body).toMatchObject(body);
  });

  it('replaceOne (PUT) echoes identically', async () => {
    const body = { name: 'Ada Updated', email: 'ada2@example.com', age: 37, active: false, plan: 'Team' };
    const [n, a] = await Promise.all([
      request(nApp.getHttpServer()).put('/authors/1').send(body),
      request(aApp.getHttpServer()).put('/authors/1').send(body),
    ]);
    expect(a.status).toBe(n.status);
    expect(a.body).toEqual(n.body);
  });

  it('createMany bulk echoes identically (fully-specified rows)', async () => {
    const body = { bulk: [{ name: 'Zed', email: 'zed@example.com', age: 40, active: true, plan: 'Free' }] };
    const { n, a } = await bothPost('/authors/bulk', body);
    expect(a.status).toBe(n.status);
    expect(a.body).toEqual(n.body);
  });

  it('empty bulk array 400s with the identical class-validator body — #45', async () => {
    const { n, a } = await bothPost('/authors/bulk', { bulk: [] });
    expect(a.status).toBe(400);
    expect(a.status).toBe(n.status);
    expect(Array.isArray(a.body.message)).toBe(true);
    expect(a.body).toEqual(n.body);
  });
});
