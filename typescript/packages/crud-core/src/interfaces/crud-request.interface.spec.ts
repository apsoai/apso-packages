/**
 * Core Interface Tests
 *
 * Tests for core CRUD interfaces to ensure type correctness and compatibility
 */

import {
  FilterCondition,
  SearchCondition,
  SortCondition,
  JoinCondition,
  FilterOperator,
  ParsedRequest,
  CrudRequestOptions
} from './crud-request.interface';

describe('CRUD Request Interfaces', () => {
  describe('FilterCondition', () => {
    it('should create valid filter conditions', () => {
      const condition: FilterCondition = {
        field: 'status',
        operator: '$eq',
        value: 'Active'
      };

      expect(condition.field).toBe('status');
      expect(condition.operator).toBe('$eq');
      expect(condition.value).toBe('Active');
    });

    it('should support all filter operators', () => {
      const operators: FilterOperator[] = [
        '$eq', '$ne', '$gt', '$lt', '$gte', '$lte',
        '$starts', '$ends', '$cont', '$excl',
        '$in', '$notin', '$isnull', '$notnull', '$between',
        '$eqL', '$neL', '$startsL', '$endsL', '$contL', '$exclL',
        '$inL', '$notinL'
      ];

      operators.forEach(operator => {
        const condition: FilterCondition = {
          field: 'test',
          operator,
          value: 'test'
        };

        expect(condition.operator).toBe(operator);
      });
    });
  });

  describe('SearchCondition', () => {
    it('should create simple search conditions', () => {
      const search: SearchCondition = {
        name: { $contL: 'John' }
      };

      expect(search.name).toEqual({ $contL: 'John' });
    });

    it('should create complex AND search conditions', () => {
      const search: SearchCondition = {
        $and: [
          { status: { $eq: 'Active' } },
          { name: { $starts: 'John' } }
        ]
      };

      expect(search.$and).toHaveLength(2);
      expect(search.$and![0]).toEqual({ status: { $eq: 'Active' } });
      expect(search.$and![1]).toEqual({ name: { $starts: 'John' } });
    });

    it('should create complex OR search conditions', () => {
      const search: SearchCondition = {
        $or: [
          { state: { $eq: 'CA' } },
          { state: { $eq: 'NY' } }
        ]
      };

      expect(search.$or).toHaveLength(2);
      expect(search.$or![0]).toEqual({ state: { $eq: 'CA' } });
      expect(search.$or![1]).toEqual({ state: { $eq: 'NY' } });
    });
  });

  describe('SortCondition', () => {
    it('should create sort conditions', () => {
      const sort: SortCondition = {
        field: 'name',
        order: 'ASC'
      };

      expect(sort.field).toBe('name');
      expect(sort.order).toBe('ASC');
    });

    it('should support both ASC and DESC orders', () => {
      const ascSort: SortCondition = { field: 'name', order: 'ASC' };
      const descSort: SortCondition = { field: 'name', order: 'DESC' };

      expect(ascSort.order).toBe('ASC');
      expect(descSort.order).toBe('DESC');
    });
  });

  describe('JoinCondition', () => {
    it('should create simple join conditions', () => {
      const join: JoinCondition = {
        field: 'facilities'
      };

      expect(join.field).toBe('facilities');
    });

    it('should create join conditions with select fields', () => {
      const join: JoinCondition = {
        field: 'facilities',
        select: ['id', 'status']
      };

      expect(join.field).toBe('facilities');
      expect(join.select).toEqual(['id', 'status']);
    });

    it('should create join conditions with alias and conditions', () => {
      const join: JoinCondition = {
        field: 'facilities',
        select: ['id', 'status'],
        alias: 'f',
        on: [
          { field: 'status', operator: '$eq', value: 'Active' }
        ]
      };

      expect(join.alias).toBe('f');
      expect(join.on).toHaveLength(1);
      expect(join.on![0].field).toBe('status');
    });
  });

  describe('ParsedRequest', () => {
    it('should create complete parsed request structure', () => {
      const options: CrudRequestOptions = {
        query: {
          limit: 20,
          maxLimit: 100,
          alwaysPaginate: true
        }
      };

      const parsed: ParsedRequest = {
        query: {
          fields: ['name', 'status'],
          filter: [{ field: 'status', operator: '$eq', value: 'Active' }],
          sort: [{ field: 'name', order: 'ASC' }],
          limit: 20,
          page: 1
        },
        options,
        parsed: {
          fields: ['name', 'status'],
          paramsFilter: [],
          search: {},
          filter: [{ field: 'status', operator: '$eq', value: 'Active' }],
          or: [],
          join: [],
          sort: [{ field: 'name', order: 'ASC' }],
          limit: 20,
          offset: 0,
          page: 1,
          cache: 0
        }
      };

      expect(parsed.query.fields).toEqual(['name', 'status']);
      expect(parsed.parsed.limit).toBe(20);
      expect(parsed.options.query?.alwaysPaginate).toBe(true);
    });
  });

  describe('Type Safety', () => {
    it('should enforce correct types for FilterOperator', () => {
      // This test ensures TypeScript compilation catches invalid operators
      const validOperators: FilterOperator[] = ['$eq', '$ne', '$gt'];

      expect(validOperators).toContain('$eq');
      expect(validOperators).toContain('$ne');
      expect(validOperators).toContain('$gt');

      // The following should cause TypeScript errors if uncommented:
      // const invalidOperator: FilterOperator = '$invalid';
      // expect(invalidOperator).toBe('$invalid');
    });

    it('should enforce correct sort order values', () => {
      const ascSort: SortCondition = { field: 'name', order: 'ASC' };
      const descSort: SortCondition = { field: 'name', order: 'DESC' };

      expect(['ASC', 'DESC']).toContain(ascSort.order);
      expect(['ASC', 'DESC']).toContain(descSort.order);

      // The following should cause TypeScript errors if uncommented:
      // const invalidSort: SortCondition = { field: 'name', order: 'INVALID' };
    });
  });
});