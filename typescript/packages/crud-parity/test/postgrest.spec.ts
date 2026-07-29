/**
 * PostgREST dialect runner (#36 criterion 4, #52). Three modes against the
 * @apso app only (the nestjsx reference app has no PostgREST dialect; the
 * nestjsx-dialect side of equivalence/access cases also runs on the @apso
 * app, isolating dialect behavior from engine behavior).
 *
 * Availability probe: until apso-build's dialect work is on the branch, a
 * ?select= probe detects the dialect's absence and every case fails with
 * one clear DIALECT_UNAVAILABLE message instead of 40 noisy diffs.
 *
 * Writes postgrest-report.json for issue filing under #36.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { buildApsoModule } from '../src/app-apso';
import { createSeededDataSource } from '../src/datasource';
import {
  ACCESS_PARITY,
  CROSS_DIALECT_EQUIVALENCE,
  POSTGREST_CONFORMANCE,
  ConformanceCase,
} from '../src/postgrest-matrix';

jest.setTimeout(180000);

let app: INestApplication;
let ds: DataSource;
let dialectAvailable = false;
const results: Array<{ id: string; mode: string; ok: boolean; detail?: string }> = [];

beforeAll(async () => {
  ds = await createSeededDataSource('pgrest');
  const mod = await Test.createTestingModule({
    imports: [buildApsoModule(async () => ds)],
  }).compile();
  app = mod.createNestApplication();
  await app.init();

  // Probe: with the dialect present, select=id returns rows shaped {id}.
  const probe = await request(app.getHttpServer()).get('/posts?select=id&order=id.asc');
  const row = Array.isArray(probe.body) ? probe.body[0] : probe.body?.data?.[0];
  dialectAvailable =
    probe.status === 200 && row && Object.keys(row).length === 1 && 'id' in row;
});

afterAll(async () => {
  const report = {
    generatedBy: 'crud-parity postgrest battery (#36/#52)',
    dialectAvailable,
    total: results.length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
  fs.writeFileSync(path.join(__dirname, '..', 'postgrest-report.json'), JSON.stringify(report, null, 2));
  for (const c of [() => app?.close(), () => ds?.destroy()]) {
    try {
      await c();
    } catch {
      // shared-pglite teardown noise
    }
  }
});

/**
 * When the dialect is absent (apso-build's #49-#51 not yet on the branch),
 * exactly ONE test fails — the availability check below — and every case
 * early-returns as 'staged' so the signal stays clean.
 */
function dialectMissing(id: string, mode: string): boolean {
  if (!dialectAvailable) {
    results.push({ id, mode, ok: true, detail: 'staged: dialect unavailable' });
    return true;
  }
  return false;
}

describe('dialect availability', () => {
  it('PostgREST dialect responds to select= (fails until #49-#51 land)', () => {
    expect(dialectAvailable).toBe(true);
  });
});

const rowsOf = (body: unknown): any[] => (Array.isArray(body) ? body : (body as any)?.data ?? []);
const idsOf = (body: unknown): number[] => rowsOf(body).map((r) => r?.id);

describe('PostgREST conformance vs documented behavior', () => {
  it.each(POSTGREST_CONFORMANCE.map((c) => [c.id, c] as [string, ConformanceCase]))(
    '%s',
    async (_id, c) => {
      if (dialectMissing(c.id, 'conformance')) return;
      const res = await request(app.getHttpServer()).get(c.path);
      const problems: string[] = [];

      if (res.status !== c.status) problems.push(`status ${res.status} != ${c.status}`);
      if (c.status === 200) {
        if (!Array.isArray(res.body)) problems.push('body is not a bare JSON array (PostgREST returns arrays, no envelope)');
        if (c.ids) {
          const got = idsOf(res.body);
          const want = c.unordered ? [...c.ids].sort((a, b) => a - b) : c.ids;
          const gotCmp = c.unordered ? [...got].sort((a, b) => a - b) : got;
          if (JSON.stringify(gotCmp) !== JSON.stringify(want)) problems.push(`ids ${JSON.stringify(got)} != ${JSON.stringify(c.ids)}`);
        }
        if (c.onlyFields) {
          const bad = rowsOf(res.body).find(
            (r) => JSON.stringify(Object.keys(r).sort()) !== JSON.stringify([...c.onlyFields!].sort())
          );
          if (bad) problems.push(`row keys ${JSON.stringify(Object.keys(bad))} != ${JSON.stringify(c.onlyFields)}`);
        }
        // Embed shape spot-checks per docs: M:1 object, 1:M/M:M array
        if (c.id === 'pg-embed-m1') {
          const r0 = rowsOf(res.body)[0];
          if (!r0 || Array.isArray(r0.author) || typeof r0.author !== 'object') problems.push('M:1 embed is not a nested object');
        }
        if (c.id === 'pg-embed-1m' || c.id === 'pg-embed-mm') {
          const key = c.id === 'pg-embed-1m' ? 'posts' : 'categories';
          const r0 = rowsOf(res.body)[0];
          if (!r0 || !Array.isArray(r0[key])) problems.push(`${key} embed is not an array`);
        }
        if (c.id === 'pg-embed-filter-keeps-parents') {
          // p1 keeps [c2], p4/p6 keep [] — parents present, embeds filtered
          const byId = Object.fromEntries(rowsOf(res.body).map((r) => [r.id, r]));
          if (JSON.stringify((byId[1]?.comments ?? []).map((x: any) => x.id)) !== '[2]') problems.push('p1 embedded filter wrong');
          if ((byId[4]?.comments ?? ['sentinel']).length !== 0) problems.push('p4 should keep empty embed array');
        }
      }

      results.push({ id: c.id, mode: 'conformance', ok: problems.length === 0, detail: problems.join('; ') || undefined });
      expect(problems).toEqual([]);
    }
  );
});

describe('cross-dialect equivalence (same app, same rows)', () => {
  it.each(CROSS_DIALECT_EQUIVALENCE.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    if (dialectMissing(c.id, 'equivalence')) return;
    const pg = await request(app.getHttpServer()).get(c.postgrest);
    const nx = await request(app.getHttpServer()).get(c.nestjsx);
    const pgIds = idsOf(pg.body);
    const nxIds = idsOf(nx.body);
    const ok = pg.status === nx.status && JSON.stringify(pgIds) === JSON.stringify(nxIds);
    results.push({
      id: c.id,
      mode: 'equivalence',
      ok,
      detail: ok ? undefined : `pg ${pg.status} ids=${JSON.stringify(pgIds)} vs nx ${nx.status} ids=${JSON.stringify(nxIds)}`,
    });
    expect({ status: pg.status, ids: pgIds }).toEqual({ status: nx.status, ids: nxIds });
  });
});

describe('access parity across dialects', () => {
  it.each(ACCESS_PARITY.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    if (dialectMissing(c.id, 'access')) return;
    const pg = await request(app.getHttpServer()).get(c.postgrest).set(c.headers ?? {});
    const nx = await request(app.getHttpServer()).get(c.nestjsx).set(c.headers ?? {});
    let ok: boolean;
    let detail: string | undefined;
    if (c.kind === 'status-parity') {
      ok = pg.status === nx.status;
      detail = ok ? undefined : `status pg=${pg.status} nx=${nx.status}`;
    } else {
      ok = pg.status === nx.status && JSON.stringify(idsOf(pg.body)) === JSON.stringify(idsOf(nx.body));
      detail = ok ? undefined : `pg ${pg.status}/${JSON.stringify(idsOf(pg.body))} vs nx ${nx.status}/${JSON.stringify(idsOf(nx.body))}`;
    }
    results.push({ id: c.id, mode: 'access', ok, detail });
    expect(detail).toBeUndefined();
  });
});
