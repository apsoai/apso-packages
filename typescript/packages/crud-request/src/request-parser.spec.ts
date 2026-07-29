/**
 * Request Parser Tests
 *
 * These tests ensure our parser handles all nestjsx/crud query parameter formats
 * and maintains full compatibility.
 */

import { CrudRequestParser, parseRequest } from './request-parser';

describe('CrudRequestParser', () => {
  let parser: CrudRequestParser;

  beforeEach(() => {
    parser = new CrudRequestParser();
  });

  describe('Field Selection', () => {
    it('should parse comma-separated fields', () => {
      const query = { fields: 'name,status,id' };
      const result = parser.parse(query);

      expect(result.parsed.fields).toEqual(['name', 'status', 'id']);
    });

    it('should parse array of fields', () => {
      const query = { fields: ['name', 'status,id'] };
      const result = parser.parse(query);

      expect(result.parsed.fields).toEqual(['name', 'status', 'id']);
    });

    it('should handle empty fields', () => {
      const query = {};
      const result = parser.parse(query);

      expect(result.parsed.fields).toEqual([]);
    });
  });

  describe('Filter Parsing', () => {
    it('should parse single filter condition', () => {
      const query = { filter: 'status||$eq||Active' };
      const result = parser.parse(query);

      expect(result.parsed.filter).toEqual([
        { field: 'status', operator: '$eq', value: 'Active' }
      ]);
    });

    it('should parse multiple filter conditions as array', () => {
      const query = { filter: ['status||$eq||Active', 'id||$gt||5'] };
      const result = parser.parse(query);

      expect(result.parsed.filter).toEqual([
        { field: 'status', operator: '$eq', value: 'Active' },
        { field: 'id', operator: '$gt', value: 5 }
      ]);
    });

    it('should parse multiple filter conditions as object', () => {
      const query = {
        filter: {
          0: 'status||$eq||Active',
          1: 'id||$gt||5'
        }
      };
      const result = parser.parse(query);

      expect(result.parsed.filter).toEqual([
        { field: 'status', operator: '$eq', value: 'Active' },
        { field: 'id', operator: '$gt', value: 5 }
      ]);
    });

    it('should parse IN operator with array values', () => {
      const query = { filter: 'state||$in||CA,NY,TX' };
      const result = parser.parse(query);

      expect(result.parsed.filter).toEqual([
        { field: 'state', operator: '$in', value: ['CA', 'NY', 'TX'] }
      ]);
    });

    it('keeps LIKE operator values raw (wildcard wrapping happens in the SQL builder)', () => {
      // Wrapping at parse time would make filter= and s= behave differently
      // for the same operator, because s= values never pass the parser's
      // value coercion. nestjsx wraps at SQL build; so do we.
      const testCases = [
        { filter: 'name||$starts||John', expected: 'John' },
        { filter: 'name||$ends||son', expected: 'son' },
        { filter: 'name||$cont||oh', expected: 'oh' },
        { filter: 'name||$contL||OH', expected: 'OH' }
      ];

      testCases.forEach(testCase => {
        const query = { filter: testCase.filter };
        const result = parser.parse(query);

        expect(result.parsed.filter[0].value).toBe(testCase.expected);
      });
    });

    it('accepts two-part valueless conditions ($isnull/$notnull)', () => {
      const result = parser.parse({ filter: 'deletedAt||$isnull' });
      expect(result.parsed.filter[0]).toEqual({
        field: 'deletedAt',
        operator: '$isnull',
        value: undefined
      });
    });

    it('builds the merged search tree: (AND filters) OR (AND ors)', () => {
      const result = parser.parse({
        filter: ['status||$eq||Active', 'age||$gt||21'],
        or: ['role||$eq||admin', 'role||$eq||owner']
      });
      expect(result.parsed.search).toEqual({
        $or: [
          { $and: [{ status: { $eq: 'Active' } }, { age: { $gt: 21 } }] },
          { $and: [{ role: { $eq: 'admin' } }, { role: { $eq: 'owner' } }] }
        ]
      });
    });

    it('ANDs the auth filter at the top of the search tree', () => {
      const result = parser.parse(
        { filter: 'status||$eq||Active' },
        {},
        { filter: { workspaceId: { $eq: 42 } } }
      );
      expect(result.parsed.search).toEqual({
        $and: [{ workspaceId: { $eq: 42 } }, { status: { $eq: 'Active' } }]
      });
    });

    it('only configured route params become paramsFilter', () => {
      const p = new CrudRequestParser({
        params: { id: { field: 'id', type: 'number', primary: true } }
      });
      const result = p.parse({}, { id: '7', workspaceId: '99' });
      expect(result.parsed.paramsFilter).toEqual([
        { field: 'id', operator: '$eq', value: 7 }
      ]);
      expect(result.parsed.search).toEqual({ id: { $eq: 7 } });
    });

    it('should parse numeric values correctly', () => {
      const query = { filter: 'id||$eq||123' };
      const result = parser.parse(query);

      expect(result.parsed.filter[0].value).toBe(123);
      expect(typeof result.parsed.filter[0].value).toBe('number');
    });

    it('should parse boolean values correctly', () => {
      const testCases = [
        { filter: 'active||$eq||true', expected: true },
        { filter: 'active||$eq||false', expected: false }
      ];

      testCases.forEach(testCase => {
        const query = { filter: testCase.filter };
        const result = parser.parse(query);

        expect(result.parsed.filter[0].value).toBe(testCase.expected);
      });
    });
  });

  describe('Search Parsing', () => {
    it('should parse simple search conditions', () => {
      const query = { s: '{"name": {"$contL": "David"}}' };
      const result = parser.parse(query);

      expect(result.parsed.search).toEqual({
        name: { $contL: 'David' }
      });
    });

    it('should parse complex AND search conditions', () => {
      const searchQuery = '{"$and": [{"status": {"$eq":"Active"}},{"name": {"$ends": "Smith"}}]}';
      const query = { s: searchQuery };
      const result = parser.parse(query);

      expect(result.parsed.search).toEqual({
        $and: [
          { status: { $eq: 'Active' } },
          { name: { $ends: 'Smith' } }
        ]
      });
    });

    it('should parse complex OR search conditions', () => {
      const searchQuery = '{"$or": [{"state": {"$eq":"CA"}},{"state": {"$eq":"NY"}}]}';
      const query = { s: searchQuery };
      const result = parser.parse(query);

      expect(result.parsed.search).toEqual({
        $or: [
          { state: { $eq: 'CA' } },
          { state: { $eq: 'NY' } }
        ]
      });
    });

    it('should handle invalid JSON gracefully', () => {
      const query = { s: 'invalid json' };
      const result = parser.parse(query);

      expect(result.parsed.search).toEqual({});
    });
  });

  describe('Sort Parsing', () => {
    it('should parse single sort condition', () => {
      const query = { sort: 'name,ASC' };
      const result = parser.parse(query);

      expect(result.parsed.sort).toEqual([
        { field: 'name', order: 'ASC' }
      ]);
    });

    it('should parse multiple sort conditions', () => {
      const query = { sort: ['name,ASC', 'id,DESC'] };
      const result = parser.parse(query);

      expect(result.parsed.sort).toEqual([
        { field: 'name', order: 'ASC' },
        { field: 'id', order: 'DESC' }
      ]);
    });

    it('should default to ASC when order not specified', () => {
      const query = { sort: 'name' };
      const result = parser.parse(query);

      expect(result.parsed.sort).toEqual([
        { field: 'name', order: 'ASC' }
      ]);
    });

    it('should handle case insensitive order', () => {
      const query = { sort: 'name,desc' };
      const result = parser.parse(query);

      expect(result.parsed.sort).toEqual([
        { field: 'name', order: 'DESC' }
      ]);
    });
  });

  describe('Join Parsing', () => {
    it('should parse simple join', () => {
      const query = { join: 'facilities' };
      const result = parser.parse(query);

      expect(result.parsed.join).toEqual([
        { field: 'facilities' }
      ]);
    });

    it('should parse join with select fields', () => {
      const query = { join: 'facilities||id,status' };
      const result = parser.parse(query);

      expect(result.parsed.join).toEqual([
        { field: 'facilities', select: ['id', 'status'] }
      ]);
    });

    it('should parse multiple joins', () => {
      const query = { join: ['facilities||id,status', 'customer||name'] };
      const result = parser.parse(query);

      expect(result.parsed.join).toEqual([
        { field: 'facilities', select: ['id', 'status'] },
        { field: 'customer', select: ['name'] }
      ]);
    });
  });

  describe('Pagination Parsing', () => {
    it('should parse limit', () => {
      const query = { limit: '10' };
      const result = parser.parse(query);

      expect(result.parsed.limit).toBe(10);
    });

    it('should parse page and calculate offset', () => {
      const query = { page: '2', limit: '5' };
      const result = parser.parse(query);

      expect(result.parsed.page).toBe(2);
      expect(result.parsed.limit).toBe(5);
      expect(result.parsed.offset).toBe(5); // (page - 1) * limit
    });

    it('should parse explicit offset', () => {
      const query = { offset: '15' };
      const result = parser.parse(query);

      expect(result.parsed.offset).toBe(15);
    });

    it('should enforce max limit', () => {
      const parser = new CrudRequestParser({ query: { maxLimit: 50 } });
      const query = { limit: '1000' };
      const result = parser.parse(query);

      expect(result.parsed.limit).toBe(50);
    });
  });

  describe('Parameter Parsing', () => {
    it('should parse route parameters', () => {
      const params = { id: '123' };
      const result = parser.parse({}, params);

      expect(result.parsed.paramsFilter).toEqual([
        { field: 'id', operator: '$eq', value: 123 }
      ]);
    });

    it('should use custom field mapping for parameters', () => {
      const parser = new CrudRequestParser({
        params: {
          customerId: { field: 'customer_id', type: 'number' }
        }
      });

      const params = { customerId: '456' };
      const result = parser.parse({}, params);

      expect(result.parsed.paramsFilter).toEqual([
        { field: 'customer_id', operator: '$eq', value: 456 }
      ]);
    });
  });

  describe('Integration Tests', () => {
    it('should parse complex query from compatibility tests', () => {
      const query = {
        fields: 'name,status',
        filter: 'city||$eq||New York',
        sort: 'name,ASC',
        page: '1',
        limit: '5'
      };

      const result = parser.parse(query);

      expect(result.parsed.fields).toEqual(['name', 'status']);
      expect(result.parsed.filter).toEqual([
        { field: 'city', operator: '$eq', value: 'New York' }
      ]);
      expect(result.parsed.sort).toEqual([
        { field: 'name', order: 'ASC' }
      ]);
      expect(result.parsed.page).toBe(1);
      expect(result.parsed.limit).toBe(5);
    });

    it('should parse join with conditions query', () => {
      const query = {
        fields: 'name',
        join: 'facilities||status'
      };

      const result = parser.parse(query);

      expect(result.parsed.fields).toEqual(['name']);
      expect(result.parsed.join).toEqual([
        { field: 'facilities', select: ['status'] }
      ]);
    });
  });

  describe('Factory Functions', () => {
    it('should create parser with default options', () => {
      const query = { limit: '10' };
      const result = parseRequest(query);

      expect(result.parsed.limit).toBe(10);
    });

    it('should create parser with custom options', () => {
      const query = { limit: '1000' };
      const result = parseRequest(query, {}, { query: { maxLimit: 50 } });

      expect(result.parsed.limit).toBe(50);
    });
  });
});