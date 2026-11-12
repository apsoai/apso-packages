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

describe('detectDialect: `or` exists in both dialects', () => {
  it('or=(...) is a PostgREST signal, alone or next to order/select', () => {
    expect(detectDialect({ or: '(a.eq.1,b.eq.2)' })).toBe('postgrest');
    expect(detectDialect({ or: '(a.eq.1,b.eq.2)', order: 'id.asc' })).toBe('postgrest');
  });
  it('or=field||$op||value stays nestjsx', () => {
    expect(detectDialect({ or: 'a||$eq||1' })).toBe('nestjsx');
    expect(detectDialect({ or: ['a||$eq||1', 'b||$eq||2'], filter: 'c||$eq||3' })).toBe('nestjsx');
  });
});

describe('resolveDialect (accepted dialects)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { resolveDialect, setAcceptedDialects } = require('./dialect');
  afterEach(() => setAcceptedDialects());

  it('both accepted (the default) behaves exactly like detectDialect', () => {
    expect(resolveDialect({ filter: 'a||$eq||1' })).toBe('nestjsx');
    expect(resolveDialect({ select: 'id' })).toBe('postgrest');
    expect(resolveDialect({}, 'nestjsx', ['nestjsx', 'postgrest'])).toBe('nestjsx');
    expect(() => resolveDialect({ fields: 'a', select: 'id' })).toThrow('Ambiguous');
  });

  describe("['postgrest']", () => {
    const only = ['postgrest'];
    it('skips detection: an empty or neutral query is PostgREST', () => {
      expect(resolveDialect({}, undefined, only)).toBe('postgrest');
      expect(resolveDialect({ limit: '2', offset: '4' }, undefined, only)).toBe('postgrest');
    });
    it.each([
      ['fields', 'id,name', 'select'],
      ['filter', 'age||$gt||30', 'age=gt.30'],
      ['filter', ['a||$eq||1', 'b||$eq||2'], 'age=gt.30'],
      ['or', 'age||$lt||18', 'or=('],
      ['join', 'posts||title', 'select=*,posts(title)'],
      ['sort', 'age,DESC', 'order=age.desc'],
      ['s', '{"age":{"$gt":30}}', 'and=('],
      ['per_page', '10', 'limit'],
      ['page', '2', 'offset'],
      ['cache', '0', 'no cache parameter'],
    ])('400s nestjsx %s and names the equivalent', (key, value, hint) => {
      const call = () => resolveDialect({ [key]: value }, undefined, only);
      expect(call).toThrow(RequestQueryException);
      expect(call).toThrow(`'${key}' query parameter is nestjsx syntax`);
      expect(call).toThrow(hint);
    });
    it('400s a nestjsx param even with X-Crud-Dialect: postgrest', () => {
      expect(() => resolveDialect({ filter: 'a||$eq||1' }, 'postgrest', only)).toThrow("'filter'");
    });
    it('400s the X-Crud-Dialect: nestjsx header', () => {
      expect(() => resolveDialect({}, 'nestjsx', only)).toThrow("X-Crud-Dialect 'nestjsx' is not accepted");
      expect(() => resolveDialect({}, 'NestJSX', only)).toThrow(RequestQueryException);
    });
    it('still 400s an unknown header value and accepts postgrest', () => {
      expect(() => resolveDialect({}, 'graphql', only)).toThrow('Invalid X-Crud-Dialect');
      expect(resolveDialect({}, 'postgrest', only)).toBe('postgrest');
    });
    it('PostgREST or=(...) and a column named like a nestjsx param are not refused', () => {
      expect(resolveDialect({ or: '(a.eq.1,b.eq.2)' }, undefined, only)).toBe('postgrest');
      expect(resolveDialect({ page: 'eq.2', sort: 'is.null', s: 'not.in.(a,b)' }, undefined, only)).toBe('postgrest');
    });
  });

  it("['nestjsx'] skips detection and 400s the postgrest header", () => {
    expect(resolveDialect({ select: 'id' }, undefined, ['nestjsx'])).toBe('nestjsx');
    expect(() => resolveDialect({}, 'postgrest', ['nestjsx'])).toThrow("X-Crud-Dialect 'postgrest' is not accepted");
  });

  it('setAcceptedDialects sets the app default; a controller option wins; no argument resets', () => {
    setAcceptedDialects(['postgrest']);
    expect(() => resolveDialect({ filter: 'a||$eq||1' })).toThrow("'filter'");
    expect(resolveDialect({ filter: 'a||$eq||1' }, undefined, ['nestjsx', 'postgrest'])).toBe('nestjsx');
    // An empty controller list means "not set": the app default applies.
    expect(() => resolveDialect({ filter: 'a||$eq||1' }, undefined, [])).toThrow("'filter'");
    setAcceptedDialects();
    expect(resolveDialect({ filter: 'a||$eq||1' })).toBe('nestjsx');
  });
});
