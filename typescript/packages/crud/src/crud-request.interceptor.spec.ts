/**
 * Interceptor-level dialect routing (#51): the right parser runs, the resolved
 * dialect is echoed on X-Crud-Dialect, and an ambiguous/invalid request 400s.
 */
import { BadRequestException } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { PARSED_CRUD_REQUEST_KEY } from '@apso/crud-core';
import { CrudRequestInterceptor } from './crud-request.interceptor';

function makeContext(query: any, headers: any = {}, params: any = {}) {
  const request: any = { query, params, headers };
  const response: any = { headers: {}, headersSent: false, setHeader(k: string, v: string) { this.headers[k] = v; } };
  const context: any = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    getHandler: () => undefined,
    getClass: () => undefined,
  };
  return { context, request, response };
}

// Reflector stub: no @Crud/@CrudAuth metadata (options = {}, no auth).
const reflector: any = { get: () => undefined };
const next: any = { handle: () => of('HANDLED') };

describe('CrudRequestInterceptor dialect routing (#51)', () => {
  const interceptor = new CrudRequestInterceptor(reflector);

  it('routes a PostgREST-shaped query to the PostgREST parser', () => {
    const { context, request, response } = makeContext({ select: 'id,name', age: 'gt.30' });
    interceptor.intercept(context, next);
    const parsed = request[PARSED_CRUD_REQUEST_KEY];
    expect(parsed.parsed.fields).toEqual(['id', 'name']);
    // `age=gt.30` is a PostgREST filter, not a nestjsx one
    expect(parsed.parsed.filter).toEqual([{ field: 'age', operator: '$gt', value: 30 }]);
    expect(response.headers['X-Crud-Dialect']).toBe('postgrest');
  });

  it('routes a nestjsx-shaped query to the nestjsx parser', () => {
    const { context, request, response } = makeContext({ fields: 'id,name', filter: 'age||$gt||30' });
    interceptor.intercept(context, next);
    const parsed = request[PARSED_CRUD_REQUEST_KEY];
    expect(parsed.parsed.fields).toEqual(['id', 'name']);
    expect(response.headers['X-Crud-Dialect']).toBe('nestjsx');
  });

  it('honors the X-Crud-Dialect header override', () => {
    // nestjsx-shaped param, but header forces postgrest → parsed as a bare filter is absent,
    // and `select` is undefined → empty fields; the point is the parser CHOICE.
    const { context, request, response } = makeContext({ select: 'id' }, { 'x-crud-dialect': 'nestjsx' });
    interceptor.intercept(context, next);
    // nestjsx parser ignores `select` (it uses `fields`), so fields is empty
    expect(request[PARSED_CRUD_REQUEST_KEY].parsed.fields).toEqual([]);
    expect(response.headers['X-Crud-Dialect']).toBe('nestjsx');
  });

  it('empty query defaults to nestjsx', () => {
    const { context, response } = makeContext({});
    interceptor.intercept(context, next);
    expect(response.headers['X-Crud-Dialect']).toBe('nestjsx');
  });

  it('400s an ambiguous mixed-dialect query', () => {
    const { context } = makeContext({ fields: 'name', select: 'id' });
    expect(() => interceptor.intercept(context, next)).toThrow(BadRequestException);
  });

  it('400s an invalid X-Crud-Dialect header', () => {
    const { context } = makeContext({}, { 'x-crud-dialect': 'graphql' });
    expect(() => interceptor.intercept(context, next)).toThrow(BadRequestException);
  });

  it('proceeds to the handler on success', async () => {
    const { context } = makeContext({});
    expect(await lastValueFrom(interceptor.intercept(context, next))).toBe('HANDLED');
  });

  describe('PostgREST paging headers', () => {
    const pg = { 'x-crud-dialect': 'postgrest' };
    // Stands in for the engine: it leaves what the list returned on the request.
    const engine = (request: any, range: any) => ({
      handle: () => {
        request[PARSED_CRUD_REQUEST_KEY].range = range;
        return of([]);
      },
    });
    const withStatus = (response: any) => {
      response.status = (code: number) => { response.statusCode = code; return response; };
      return response;
    };

    it('reads Prefer: count and writes Content-Range, Preference-Applied and 206', async () => {
      const { context, request, response } = makeContext({ limit: '2' }, { ...pg, prefer: 'count=planned' });
      withStatus(response);
      await lastValueFrom(interceptor.intercept(context, engine(request, { offset: 0, rows: 2, total: 6 }) as any));
      expect(request[PARSED_CRUD_REQUEST_KEY].parsed.count).toBe('planned');
      expect(response.headers['Content-Range']).toBe('0-1/6');
      expect(response.headers['Preference-Applied']).toBe('count=exact');
      expect(response.headers['Access-Control-Expose-Headers']).toContain('Content-Range');
      expect(response.statusCode).toBe(206);
    });

    it('an empty page is */total and stays 200; an uncounted page is from-to/*', async () => {
      const empty = makeContext({}, pg);
      withStatus(empty.response);
      await lastValueFrom(interceptor.intercept(empty.context, engine(empty.request, { offset: 10, rows: 0, total: 6 }) as any));
      expect(empty.response.headers['Content-Range']).toBe('*/6');
      expect(empty.response.statusCode).toBeUndefined();

      const plain = makeContext({}, pg);
      await lastValueFrom(interceptor.intercept(plain.context, engine(plain.request, { offset: 4, rows: 2 }) as any));
      expect(plain.response.headers['Content-Range']).toBe('4-5/*');
      expect(plain.response.headers['Preference-Applied']).toBeUndefined();
    });

    it('Range: 2-3 becomes offset and limit; with limit it is a 400; bytes is ignored', () => {
      const ranged = makeContext({}, { ...pg, range: '2-3' });
      interceptor.intercept(ranged.context, next);
      expect(ranged.request[PARSED_CRUD_REQUEST_KEY].parsed).toMatchObject({ offset: 2, limit: 2 });

      const both = makeContext({ limit: '2' }, { ...pg, range: '0-1' });
      expect(() => interceptor.intercept(both.context, next)).toThrow(BadRequestException);

      const bytes = makeContext({}, { ...pg, range: 'bytes=0-99' });
      interceptor.intercept(bytes.context, next);
      expect(bytes.request[PARSED_CRUD_REQUEST_KEY].parsed.offset).toBe(0);
    });

    it('nestjsx requests get none of it', async () => {
      const { context, request, response } = makeContext({ limit: '2' }, { prefer: 'count=exact', range: '2-3' });
      await lastValueFrom(interceptor.intercept(context, next));
      expect(request[PARSED_CRUD_REQUEST_KEY].parsed.count).toBeUndefined();
      expect(request[PARSED_CRUD_REQUEST_KEY].parsed.offset).toBe(0);
      expect(response.headers['Content-Range']).toBeUndefined();
    });
  });
});
