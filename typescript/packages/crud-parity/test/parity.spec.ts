/**
 * Differential parity runner.
 *
 * Boots the @nestjsx/crud 4.5.0 reference app and the @apso/crud candidate
 * app over identically seeded pglite databases, fires every matrix case at
 * both, and diffs status + normalized body. Each case is its own jest test
 * so the full mismatch surface is visible in one run (no fail-fast).
 *
 * A machine-readable summary is written to parity-report.json for filing
 * sub-issues under apsoai/apso-packages#14.
 */
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { buildNestjsxModule } from '../src/app-nestjsx';
import { buildApsoModule } from '../src/app-apso';
import { createSeededDataSource } from '../src/datasource';
import { MATRIX, ParityCase } from '../src/matrix';

jest.setTimeout(180000);

interface CaseResult {
  id: string;
  category: string;
  path: string;
  reference: { status: number; body: unknown };
  candidate: { status: number; body: unknown };
  match: boolean;
}

let refApp: INestApplication;
let candApp: INestApplication;
let refDs: DataSource;
let candDs: DataSource;
const results: CaseResult[] = [];

/** Normalize a body for comparison: sort object keys; optionally sort rows by id. */
function normalize(value: unknown, unordered: boolean): unknown {
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
  let out = sortKeys(value);
  const byId = (a: any, b: any) => (a?.id ?? 0) - (b?.id ?? 0);
  if (unordered) {
    if (Array.isArray(out)) out = [...(out as any[])].sort(byId);
    else if (out && typeof out === 'object' && Array.isArray((out as any).data)) {
      (out as any).data = [...(out as any).data].sort(byId);
    }
  }
  // Nested relation arrays (1:M / M:M) carry no ordering guarantee in either
  // library; sort them by id everywhere so row-internal order noise does not
  // mask real differences.
  const sortNestedArrays = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      const mapped = v.map(sortNestedArrays);
      return mapped.every((x) => x && typeof x === 'object' && 'id' in (x as any))
        ? [...mapped].sort(byId)
        : mapped;
    }
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      for (const k of Object.keys(o)) {
        if (Array.isArray(o[k])) o[k] = sortNestedArrays(o[k]);
      }
    }
    return v;
  };
  return sortNestedArrays(out);
}

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
  // Emit the report FIRST: teardown of the shared pglite instance can throw
  // (both DataSources share one PGlite singleton) and must not eat the report.
  const mismatches = results.filter((r) => !r.match);
  const report = {
    generatedBy: 'crud-parity (apsoai/apso-packages#16, sub-issue of #14)',
    reference: '@nestjsx/crud@4.5.0',
    candidate: '@apso/crud@local',
    total: results.length,
    mismatched: mismatches.length,
    byCategory: results.reduce((acc: Record<string, { total: number; failed: number }>, r) => {
      acc[r.category] = acc[r.category] || { total: 0, failed: 0 };
      acc[r.category].total++;
      if (!r.match) acc[r.category].failed++;
      return acc;
    }, {}),
    mismatches,
  };
  fs.writeFileSync(path.join(__dirname, '..', 'parity-report.json'), JSON.stringify(report, null, 2));

  for (const closer of [
    () => refApp?.close(),
    () => candApp?.close(),
    () => refDs?.destroy(),
    () => candDs?.destroy(),
  ]) {
    try {
      await closer();
    } catch {
      // shared-pglite teardown noise; isolation is per-schema, not per-instance
    }
  }
});

describe('boot smoke', () => {
  it('reference app answers GET /posts', async () => {
    const res = await request(refApp.getHttpServer()).get('/posts');
    expect(res.status).toBe(200);
  });

  it('candidate app answers GET /posts', async () => {
    const res = await request(candApp.getHttpServer()).get('/posts');
    expect(res.status).toBe(200);
  });
});

describe('parity: @apso/crud vs @nestjsx/crud 4.5.0', () => {
  it.each(MATRIX.map((c) => [c.id, c] as [string, ParityCase]))('%s', async (_id, c) => {
    const ref = await request(refApp.getHttpServer()).get(c.path).set(c.headers ?? {});
    const cand = await request(candApp.getHttpServer()).get(c.path).set(c.headers ?? {});

    const refNorm = { status: ref.status, body: normalize(ref.body, !!c.unordered) };
    const candNorm = { status: cand.status, body: normalize(cand.body, !!c.unordered) };
    const match = JSON.stringify(refNorm) === JSON.stringify(candNorm);

    results.push({
      id: c.id,
      category: c.category,
      path: c.path,
      reference: refNorm,
      candidate: candNorm,
      match,
    });

    expect(candNorm).toEqual(refNorm);
  });
});
