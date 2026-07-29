import { detectDialect } from './dialect';
import { RequestQueryException } from '@apso/crud-core';

describe('detectDialect (#51)', () => {
  describe('header override (highest precedence)', () => {
    it('forces postgrest', () => {
      // header wins even against nestjsx-shaped params
      expect(detectDialect({ filter: 'name||$eq||Ada' }, 'postgrest')).toBe('postgrest');
    });
    it('forces nestjsx', () => {
      expect(detectDialect({ select: 'id,name' }, 'nestjsx')).toBe('nestjsx');
    });
    it('is case-insensitive and trims', () => {
      expect(detectDialect({}, '  PostgREST ')).toBe('postgrest');
    });
    it('takes the first value when the header is an array', () => {
      expect(detectDialect({}, ['nestjsx', 'postgrest'])).toBe('nestjsx');
    });
    it('400s an invalid header value', () => {
      expect(() => detectDialect({}, 'graphql')).toThrow(RequestQueryException);
      expect(() => detectDialect({}, 'graphql')).toThrow('Invalid X-Crud-Dialect');
    });
    it('ignores an empty header and falls back to param detection', () => {
      expect(detectDialect({ select: 'id' }, '')).toBe('postgrest');
    });
  });

  describe('param-shape detection', () => {
    it('nestjsx keys => nestjsx', () => {
      expect(detectDialect({ fields: 'name' })).toBe('nestjsx');
      expect(detectDialect({ filter: 'age||$gt||30' })).toBe('nestjsx');
      expect(detectDialect({ join: 'posts' })).toBe('nestjsx');
      expect(detectDialect({ sort: 'age,DESC' })).toBe('nestjsx');
      expect(detectDialect({ s: '{"age":{"$gt":30}}' })).toBe('nestjsx');
    });
    it('PostgREST keys => postgrest', () => {
      expect(detectDialect({ select: 'id,name' })).toBe('postgrest');
      expect(detectDialect({ order: 'age.desc' })).toBe('postgrest');
    });
    it('a bare col=op.value => postgrest', () => {
      expect(detectDialect({ age: 'gt.30' })).toBe('postgrest');
      expect(detectDialect({ email: 'is.null' })).toBe('postgrest');
      expect(detectDialect({ name: 'not.eq.Ada' })).toBe('postgrest');
      expect(detectDialect({ name: 'ilike.*ada*' })).toBe('postgrest');
    });
    it('takes the first value for a repeated bare param', () => {
      expect(detectDialect({ age: ['gt.30', 'lt.50'] })).toBe('postgrest');
    });
  });

  describe('neutral / default', () => {
    it('empty query defaults to nestjsx (the incumbent)', () => {
      expect(detectDialect({})).toBe('nestjsx');
      expect(detectDialect(undefined)).toBe('nestjsx');
    });
    it('neutral-only params default to nestjsx and never force postgrest', () => {
      expect(detectDialect({ limit: '10', offset: '20', page: '2', cache: '0' })).toBe('nestjsx');
    });
    it('an unknown param that is not op.value shaped stays neutral', () => {
      // e.g. a stray non-filter param must not flip the dialect
      expect(detectDialect({ foo: 'bar' })).toBe('nestjsx');
    });
  });

  describe('collision (refuse to guess)', () => {
    it('400s when nestjsx and PostgREST keys are mixed', () => {
      expect(() => detectDialect({ fields: 'name', select: 'id' })).toThrow(RequestQueryException);
      expect(() => detectDialect({ fields: 'name', select: 'id' })).toThrow('Ambiguous query');
    });
    it('400s when a nestjsx key mixes with a bare col=op.value', () => {
      expect(() => detectDialect({ filter: 'a||$eq||b', age: 'gt.30' })).toThrow('Ambiguous query');
    });
  });
});
