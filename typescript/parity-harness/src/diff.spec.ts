/**
 * Differential parity: identical queries -> identical responses.
 * apso-packages#22, toward #14's "zero difference to the end user".
 */
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as fs from 'fs';
import * as path from 'path';
import { bootApp } from './harness';
import { CORPUS, EXPECTED_DIVERGENCES } from './corpus';
import {
  AuthorController as NController,
  ScopedAuthorController as NScopedController,
  AuthorService as NService,
} from './controllers.nestjsx';
import {
  AuthorController as AController,
  ScopedAuthorController as AScopedController,
  AuthorService as AService,
} from './controllers.apso';

let nestjsxApp: INestApplication;
let apsoApp: INestApplication;

beforeAll(async () => {
  nestjsxApp = await bootApp([NController, NScopedController], [NService]);
  apsoApp = await bootApp([AController, AScopedController], [AService]);
});

afterAll(async () => {
  await nestjsxApp?.close();
  await apsoApp?.close();
});

describe('source parity', () => {
  it('controllers differ ONLY by the two import lines (the import-swap claim)', () => {
    const normalize = (file: string) =>
      fs
        .readFileSync(path.join(__dirname, file), 'utf-8')
        .split('\n')
        .filter(l => !l.startsWith('import ') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
        .join('\n');
    expect(normalize('controllers.apso.ts')).toBe(normalize('controllers.nestjsx.ts'));
  });
});

describe('differential parity: nestjsx 4.5.0 vs @apso/crud', () => {
  it.each(CORPUS)('%s', async (query) => {
    const [n, a] = await Promise.all([
      request(nestjsxApp.getHttpServer()).get(query),
      request(apsoApp.getHttpServer()).get(query),
    ]);

    const expectedDivergence = EXPECTED_DIVERGENCES[query];
    const same =
      n.status === a.status &&
      JSON.stringify(n.body) === JSON.stringify(a.body);

    if (expectedDivergence) {
      // A documented divergence must actually diverge — silent convergence
      // means the docs are stale.
      expect(same).toBe(false);
      return;
    }

    if (!same) {
      // Rich failure output for triage
      // eslint-disable-next-line no-console
      console.error(`DIVERGENCE on ${query}\n nestjsx: ${n.status} ${JSON.stringify(n.body)}\n apso:    ${a.status} ${JSON.stringify(a.body)}`);
    }
    expect(a.status).toBe(n.status);
    expect(a.body).toEqual(n.body);
  });
});
