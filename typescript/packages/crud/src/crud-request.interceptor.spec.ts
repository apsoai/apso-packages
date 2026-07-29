/**
 * Interceptor-level dialect routing (#51): the right parser runs, the resolved
 * dialect is echoed on X-Crud-Dialect, and an ambiguous/invalid request 400s.
 */
import { BadRequestException } from '@nestjs/common';
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
const next: any = { handle: () => 'HANDLED' };

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

  it('proceeds to the handler on success', () => {
    const { context } = makeContext({});
    expect(interceptor.intercept(context, next)).toBe('HANDLED');
  });
});
