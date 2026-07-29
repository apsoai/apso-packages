import { PostgrestRequestParser } from './postgrest-parser';

const p = new PostgrestRequestParser();

describe('PostgrestRequestParser', () => {
  describe('select', () => {
    it('parses plain columns into fields', () => {
      expect(p.parse({ select: 'id,name,age' }).parsed.fields).toEqual(['id', 'name', 'age']);
    });
    it('strips embeds and rename/cast for the core field list', () => {
      // rel(...) is an embed (#50); alias:col keeps the column; col::text drops the cast
      expect(p.parse({ select: 'id,alias:name,age::text,posts(id)' }).parsed.fields)
        .toEqual(['id', 'name', 'age']);
    });
  });

  describe('comparison operators', () => {
    const one = (q: any) => p.parse(q).parsed.filter[0];
    it('maps eq/neq/gt/gte/lt/lte', () => {
      expect(one({ age: 'eq.30' })).toEqual({ field: 'age', operator: '$eq', value: 30 });
      expect(one({ age: 'neq.30' })).toEqual({ field: 'age', operator: '$ne', value: 30 });
      expect(one({ age: 'gt.30' })).toEqual({ field: 'age', operator: '$gt', value: 30 });
      expect(one({ age: 'gte.30' })).toEqual({ field: 'age', operator: '$gte', value: 30 });
      expect(one({ age: 'lt.30' })).toEqual({ field: 'age', operator: '$lt', value: 30 });
      expect(one({ age: 'lte.30' })).toEqual({ field: 'age', operator: '$lte', value: 30 });
    });
    it('coerces booleans and null', () => {
      expect(one({ active: 'eq.true' }).value).toBe(true);
      expect(one({ active: 'eq.false' }).value).toBe(false);
    });
  });

  describe('like / ilike convert * to %', () => {
    const one = (q: any) => p.parse(q).parsed.filter[0];
    it('like', () => {
      expect(one({ name: 'like.*ada*' })).toEqual({ field: 'name', operator: '$like', value: '%ada%' });
    });
    it('ilike', () => {
      expect(one({ name: 'ilike.A*' })).toEqual({ field: 'name', operator: '$ilike', value: 'A%' });
    });
  });

  describe('in', () => {
    const one = (q: any) => p.parse(q).parsed.filter[0];
    it('parses in.(a,b,c)', () => {
      expect(one({ plan: 'in.(Pro,Team)' })).toEqual({ field: 'plan', operator: '$in', value: ['Pro', 'Team'] });
    });
    it('handles quoted values with commas', () => {
      expect(one({ tag: 'in.("a,b",c)' }).value).toEqual(['a,b', 'c']);
    });
    it('coerces numeric list', () => {
      expect(one({ id: 'in.(1,2,3)' }).value).toEqual([1, 2, 3]);
    });
  });

  describe('is', () => {
    const one = (q: any) => p.parse(q).parsed.filter[0];
    it('is.null -> $isnull', () => {
      expect(one({ email: 'is.null' })).toEqual({ field: 'email', operator: '$isnull', value: undefined });
    });
    it('is.true -> $eq true', () => {
      expect(one({ active: 'is.true' })).toEqual({ field: 'active', operator: '$eq', value: true });
    });
  });

  describe('not negation', () => {
    const one = (q: any) => p.parse(q).parsed.filter[0];
    it('not.eq -> $ne', () => {
      expect(one({ name: 'not.eq.Ada' })).toEqual({ field: 'name', operator: '$ne', value: 'Ada' });
    });
    it('not.in -> $notin', () => {
      expect(one({ plan: 'not.in.(Free)' })).toEqual({ field: 'plan', operator: '$notin', value: ['Free'] });
    });
    it('not.is.null -> $notnull', () => {
      expect(one({ email: 'not.is.null' })).toEqual({ field: 'email', operator: '$notnull', value: undefined });
    });
  });

  describe('order', () => {
    it('parses direction and nulls placement', () => {
      const s = p.parse({ order: 'age.desc.nullslast,name.asc' }).parsed.sort;
      expect(s).toEqual([
        { field: 'age', order: 'DESC', nulls: 'NULLS LAST' },
        { field: 'name', order: 'ASC' },
      ]);
    });
    it('defaults to ASC', () => {
      expect(p.parse({ order: 'age' }).parsed.sort).toEqual([{ field: 'age', order: 'ASC' }]);
    });
    it('400s an invalid modifier', () => {
      expect(() => p.parse({ order: 'age.sideways' })).toThrow('Invalid order modifier');
    });
  });

  describe('pagination', () => {
    it('parses limit/offset and derives page', () => {
      const parsed = p.parse({ limit: '2', offset: '2' }).parsed;
      expect(parsed.limit).toBe(2);
      expect(parsed.offset).toBe(2);
      expect(parsed.page).toBe(2);
    });
  });

  describe('search tree', () => {
    it('ANDs multiple filters', () => {
      const parsed = p.parse({ active: 'eq.true', age: 'gt.30' }).parsed;
      expect(parsed.search).toEqual({
        $and: [{ active: { $eq: true } }, { age: { $gt: 30 } }],
      });
    });
    it('ANDs an auth filter at the top (cannot be widened)', () => {
      const parsed = p.parse({ active: 'eq.false' }, {}, { filter: { workspaceId: { $eq: 42 } } }).parsed;
      expect(parsed.search).toEqual({
        $and: [{ workspaceId: { $eq: 42 } }, { active: { $eq: false } }],
      });
    });
  });

  describe('resource embedding (#50)', () => {
    it('maps a simple embed to a JoinCondition with per-embed select', () => {
      const parsed = p.parse({ select: 'title,directors(id,last_name)' }).parsed;
      expect(parsed.fields).toEqual(['title']);
      expect(parsed.join).toEqual([{ field: 'directors', select: ['id', 'last_name'] }]);
    });
    it('nests embeds into dotted join paths (rel.sub)', () => {
      const parsed = p.parse({ select: 'roles(character,films(title,year))' }).parsed;
      expect(parsed.fields).toEqual([]);
      expect(parsed.join).toEqual([
        { field: 'roles', select: ['character'] },
        { field: 'roles.films', select: ['title', 'year'] },
      ]);
    });
    it('aliased embed keeps the relation name as the join path', () => {
      const parsed = p.parse({ select: 'name,director:directors(first_name)' }).parsed;
      expect(parsed.fields).toEqual(['name']);
      expect(parsed.join).toEqual([{ field: 'directors', select: ['first_name'] }]);
    });
    it('rel(*) → full join (no explicit select), like a nestjsx join with no column list', () => {
      const parsed = p.parse({ select: 'title,actors(*)' }).parsed;
      expect(parsed.join).toEqual([{ field: 'actors' }]);
    });
    it('strips the !inner/!left join-type hint from the relation name', () => {
      const parsed = p.parse({ select: 'title,actors!inner(first_name)' }).parsed;
      expect(parsed.join).toEqual([{ field: 'actors', select: ['first_name'] }]);
    });
    it('embedded filter (rel.col=op.val) lands in the search tree as a dotted key', () => {
      // The engine resolves the dotted key through the alias the embed registers.
      const parsed = p.parse({ select: 'title,actors(*)', 'actors.first_name': 'eq.Jehanne' }).parsed;
      expect(parsed.search).toEqual({ 'actors.first_name': { $eq: 'Jehanne' } });
    });
    it('embedded order rel(col).desc → sort on the dotted rel.col', () => {
      const parsed = p.parse({ select: 'title,directors(last_name)', order: 'directors(last_name).desc' }).parsed;
      expect(parsed.sort).toEqual([{ field: 'directors.last_name', order: 'DESC' }]);
    });
  });

  describe('cross-dialect access parity (#50)', () => {
    // The access boundary is @apso/crud's applyJoins allowlist, which reads
    // parsed.join identically for both dialects. Proven here at the parse
    // layer: a PostgREST embed for `secrets` produces the SAME join path
    // string the nestjsx `join=secrets` path produces, so whatever the
    // allowlist denies for one, it denies for the other.
    it('a PostgREST embed yields the same join path a nestjsx join would', () => {
      const parsed = p.parse({ select: 'id,secrets(token)' }).parsed;
      expect(parsed.join.map(j => j.field)).toEqual(['secrets']);
      // nestjsx `join=secrets` parses to JoinCondition{ field: 'secrets' } —
      // same key applyJoins looks up in options.query.join. Identical access.
    });
  });

  describe('errors', () => {
    it('400s a filter with no op.value', () => {
      expect(() => p.parse({ age: '30' })).toThrow('expected op.value');
    });
    it('400s an unsupported operator', () => {
      expect(() => p.parse({ age: 'bogus.5' })).toThrow('Unsupported PostgREST operator');
    });
  });
});
