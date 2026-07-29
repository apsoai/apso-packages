import { RequestQueryBuilder, CondOperator } from './query-builder';
import { CrudRequestParser } from './request-parser';

/**
 * Simulate the HTTP layer: turn a built query string into the decoded,
 * Express-style query object (repeated keys -> arrays) the parser receives.
 */
function toQueryObject(qs: string): Record<string, any> {
  const sp = new URLSearchParams(qs);
  const out: Record<string, any> = {};
  for (const key of new Set(sp.keys())) {
    const all = sp.getAll(key);
    out[key] = all.length > 1 ? all : all[0];
  }
  return out;
}

const parse = (qb: RequestQueryBuilder) =>
  new CrudRequestParser().parse(toQueryObject(qb.query())).parsed;

describe('RequestQueryBuilder', () => {
  describe('serialization', () => {
    it('builds fields, filter, sort, limit/offset in nestjsx format', () => {
      const qs = RequestQueryBuilder.create()
        .select(['id', 'name'])
        .setFilter({ field: 'age', operator: '$gt', value: 30 })
        .sortBy({ field: 'id', order: 'ASC' })
        .setLimit(10)
        .setOffset(5)
        .query();
      expect(qs).toBe('fields=id,name&filter=age||$gt||30&sort=id,ASC&limit=10&offset=5');
    });

    it('serializes a valueless operator as field||op', () => {
      expect(RequestQueryBuilder.create().setFilter({ field: 'email', operator: '$isnull' }).query())
        .toBe('filter=email||$isnull');
    });

    it('serializes an array value ($in) as a comma list', () => {
      expect(RequestQueryBuilder.create().setFilter({ field: 'plan', operator: '$in', value: ['Pro', 'Team'] }).query())
        .toBe('filter=plan||$in||Pro,Team');
    });

    it('serializes a join with a column list', () => {
      expect(RequestQueryBuilder.create().setJoin({ field: 'posts', select: ['id', 'title'] }).query())
        .toBe('join=posts||id,title');
    });

    it('URL-encodes values but keeps delimiters and dotted fields literal', () => {
      const qs = RequestQueryBuilder.create()
        .setFilter({ field: 'posts.title', operator: '$cont', value: 'a b&c' })
        .query();
      expect(qs).toBe('filter=posts.title||$cont||a%20b%26c');
    });

    it('accepts unprefixed CondOperator values', () => {
      expect(RequestQueryBuilder.create().setFilter({ field: 'name', operator: CondOperator.EQUALS, value: 'Ada' }).query())
        .toBe('filter=name||eq||Ada');
    });
  });

  describe('round-trip through the parser', () => {
    it('filter round-trips to the canonical operator', () => {
      const p = parse(RequestQueryBuilder.create().setFilter({ field: 'age', operator: '$gt', value: 30 }));
      expect(p.filter).toEqual([{ field: 'age', operator: '$gt', value: 30 }]);
    });

    it('fields / sort / limit / offset round-trip', () => {
      const p = parse(
        RequestQueryBuilder.create().select(['id', 'name']).sortBy({ field: 'id', order: 'DESC' }).setLimit(2).setOffset(4),
      );
      expect(p.fields).toEqual(['id', 'name']);
      expect(p.sort).toEqual([{ field: 'id', order: 'DESC' }]);
      expect(p.limit).toBe(2);
      expect(p.offset).toBe(4);
    });

    it('$in list round-trips', () => {
      const p = parse(RequestQueryBuilder.create().setFilter({ field: 'plan', operator: '$in', value: ['Pro', 'Team'] }));
      expect(p.filter).toEqual([{ field: 'plan', operator: '$in', value: ['Pro', 'Team'] }]);
    });

    it('join with columns round-trips', () => {
      const p = parse(RequestQueryBuilder.create().setJoin({ field: 'posts', select: ['id', 'title'] }));
      expect(p.join).toEqual([{ field: 'posts', select: ['id', 'title'] }]);
    });

    it('an encoded value decodes back to the original', () => {
      const p = parse(RequestQueryBuilder.create().setFilter({ field: 'name', operator: '$cont', value: 'a b&c' }));
      expect(p.filter[0].value).toBe('a b&c');
    });

    it('unprefixed operator round-trips to the canonical $-form', () => {
      const p = parse(RequestQueryBuilder.create().setFilter({ field: 'name', operator: CondOperator.EQUALS, value: 'Ada' }));
      expect(p.filter).toEqual([{ field: 'name', operator: '$eq', value: 'Ada' }]);
    });
  });
});
