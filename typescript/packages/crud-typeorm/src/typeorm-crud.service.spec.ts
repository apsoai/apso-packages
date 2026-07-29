/**
 * TypeORM CRUD Service Tests
 */

import { Repository, SelectQueryBuilder } from 'typeorm';
import { TypeOrmCrudService } from './typeorm-crud.service';
import { ParsedRequest, FilterCondition } from '@apso/crud-core';

// Mock entity for testing (a class so it can also serve as the repository
// target value)
class TestEntity {
  id!: number;
  name!: string;
  status!: string;
  createdAt!: Date;
}

// Mock repository
const mockRepository = {
  createQueryBuilder: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  target: TestEntity
} as unknown as Repository<TestEntity>;

// Mock query builder
const mockQueryBuilder = {
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orWhere: jest.fn().mockReturnThis(),
  leftJoin: jest.fn().mockReturnThis(),
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  addOrderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  offset: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  innerJoinAndSelect: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
  getManyAndCount: jest.fn(),
  getOne: jest.fn()
} as unknown as SelectQueryBuilder<TestEntity>;

describe('TypeOrmCrudService', () => {
  let service: TypeOrmCrudService<TestEntity>;

  beforeEach(() => {
    jest.clearAllMocks();
    (mockRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockQueryBuilder);

    service = new TypeOrmCrudService(mockRepository, {
      query: {
        limit: 20,
        maxLimit: 100,
        alwaysPaginate: false
      }
    });
  });

  describe('getMany', () => {
    it('should execute query and return paginated results', async () => {
      const mockData = [
        { id: 1, name: 'Test 1', status: 'Active', createdAt: new Date() },
        { id: 2, name: 'Test 2', status: 'Active', createdAt: new Date() }
      ];

      (mockQueryBuilder.getManyAndCount as jest.Mock).mockResolvedValue([mockData, 10]);

      const parsedRequest: ParsedRequest = {
        query: { limit: 5, page: 1 },
        options: {},
        parsed: {
          fields: [],
          paramsFilter: [],
          search: {},
          filter: [],
          or: [],
          join: [],
          sort: [],
          limit: 5,
          offset: 0,
          page: 1,
          cache: 0
        }
      };

      const result = await service.getMany(parsedRequest);

      expect(result).toEqual({
        data: mockData,
        count: 2,
        total: 10,
        page: 1,
        pageCount: 2
      });

      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('entity');
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(5);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(0);
    });

    it('should apply field selection and remove duplicates (fix for issue #777)', async () => {
      const parsedRequest: ParsedRequest = {
        query: { fields: ['name', 'status', 'name'] }, // Duplicate field
        options: {},
        parsed: {
          fields: ['name', 'status', 'name'], // Duplicate field
          paramsFilter: [],
          search: {},
          filter: [],
          or: [],
          join: [],
          sort: [],
          limit: 20,
          offset: 0,
          page: 1,
          cache: 0
        }
      };

      (mockQueryBuilder.getManyAndCount as jest.Mock).mockResolvedValue([[], 0]);

      await service.getMany(parsedRequest);

      // Verify that duplicates are removed
      // PK always included (nestjsx behavior), duplicates removed (#777)
      expect(mockQueryBuilder.select).toHaveBeenCalledWith([
        'entity.id',
        'entity.name',
        'entity.status'
      ]);
    });

    it('builds WHERE from the search tree (Brackets)', async () => {
      const parsedRequest: ParsedRequest = {
        query: {},
        options: {},
        parsed: {
          fields: [],
          paramsFilter: [],
          search: {
            $and: [{ status: { $eq: 'Active' } }, { id: { $gt: 5 } }]
          },
          filter: [],
          or: [],
          join: [],
          sort: [],
          limit: 20,
          offset: 0,
          page: 1,
          cache: 0
        }
      };

      (mockQueryBuilder.getManyAndCount as jest.Mock).mockResolvedValue([[], 0]);

      await service.getMany(parsedRequest);

      // The search tree is applied as a single top-level Brackets andWhere
      const calls = (mockQueryBuilder.andWhere as jest.Mock).mock.calls;
      expect(calls.length).toBe(1);
      expect(calls[0][0]?.constructor?.name).toBe('Brackets');
    });

    it('applies paramsFilter when search is empty (id targeting)', async () => {
      const parsedRequest: ParsedRequest = {
        query: {},
        options: {},
        parsed: {
          fields: [],
          paramsFilter: [{ field: 'id', operator: '$eq', value: 42 }],
          search: {},
          filter: [],
          or: [],
          join: [],
          sort: [],
          limit: 20,
          offset: 0,
          page: 1,
          cache: 0
        }
      };

      (mockQueryBuilder.getManyAndCount as jest.Mock).mockResolvedValue([[], 0]);

      await service.getMany(parsedRequest);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'entity.id = :p0',
        { p0: 42 }
      );
    });

    it('should apply sort conditions', async () => {
      const parsedRequest: ParsedRequest = {
        query: {},
        options: {},
        parsed: {
          fields: [],
          paramsFilter: [],
          search: {},
          filter: [],
          or: [],
          join: [],
          sort: [
            { field: 'name', order: 'ASC' },
            { field: 'createdAt', order: 'DESC' }
          ],
          limit: 20,
          offset: 0,
          page: 1,
          cache: 0
        }
      };

      (mockQueryBuilder.getManyAndCount as jest.Mock).mockResolvedValue([[], 0]);

      await service.getMany(parsedRequest);

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('entity.name', 'ASC');
      expect(mockQueryBuilder.addOrderBy).toHaveBeenCalledWith('entity.createdAt', 'DESC');
    });

    it('should apply join conditions', async () => {
      const parsedRequest: ParsedRequest = {
        query: {},
        // joins are only honored from the options allowlist (nestjsx)
        options: { query: { join: { facilities: {}, customer: {} } } },
        parsed: {
          fields: [],
          paramsFilter: [],
          search: {},
          filter: [],
          or: [],
          join: [
            { field: 'facilities' },
            { field: 'customer', select: ['id', 'name'], alias: 'cust' }
          ],
          sort: [],
          limit: 20,
          offset: 0,
          page: 1,
          cache: 0
        }
      };

      (mockQueryBuilder.getManyAndCount as jest.Mock).mockResolvedValue([[], 0]);

      await service.getMany(parsedRequest);

      // No select list: join-and-select everything
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('entity.facilities', 'facilities');
      // Explicit select list: plain join + selected columns incl. the PK
      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledWith('entity.customer', 'cust');
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith(['cust.id', 'cust.name']);
    });

    it('should enforce max limit', async () => {
      const parsedRequest: ParsedRequest = {
        query: { limit: 1000 }, // Exceeds max limit
        options: {},
        parsed: {
          fields: [],
          paramsFilter: [],
          search: {},
          filter: [],
          or: [],
          join: [],
          sort: [],
          limit: 1000,
          offset: 0,
          page: 1,
          cache: 0
        }
      };

      (mockQueryBuilder.getManyAndCount as jest.Mock).mockResolvedValue([[], 0]);

      await service.getMany(parsedRequest);

      // Should be limited to maxLimit (100)
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(100);
    });
  });

  describe('getOne', () => {
    it('should return single entity', async () => {
      const mockEntity = { id: 1, name: 'Test', status: 'Active', createdAt: new Date() };
      (mockQueryBuilder.getOne as jest.Mock).mockResolvedValue(mockEntity);

      const parsedRequest: ParsedRequest = {
        query: {},
        options: {},
        parsed: {
          fields: [],
          paramsFilter: [{ field: 'id', operator: '$eq', value: 1 }],
          search: {},
          filter: [],
          or: [],
          join: [],
          sort: [],
          limit: 20,
          offset: 0,
          page: 1,
          cache: 0
        }
      };

      const result = await service.getOne(parsedRequest);

      expect(result).toEqual(mockEntity); // bare entity, nestjsx shape
      expect(mockQueryBuilder.getOne).toHaveBeenCalled();
    });

    it('should throw error when entity not found', async () => {
      (mockQueryBuilder.getOne as jest.Mock).mockResolvedValue(null);

      const parsedRequest: ParsedRequest = {
        query: {},
        options: {},
        parsed: {
          fields: [],
          paramsFilter: [{ field: 'id', operator: '$eq', value: 999 }],
          search: {},
          filter: [],
          or: [],
          join: [],
          sort: [],
          limit: 20,
          offset: 0,
          page: 1,
          cache: 0
        }
      };

      await expect(service.getOne(parsedRequest)).rejects.toThrow('Entity not found');
    });
  });

  describe('createOne', () => {
    it('should create and save entity', async () => {
      const dto = { name: 'New Entity', status: 'Active' };
      const mockEntity = { id: 1, ...dto, createdAt: new Date() };

      (mockRepository.create as jest.Mock).mockReturnValue(mockEntity);
      (mockRepository.save as jest.Mock).mockResolvedValue(mockEntity);

      const parsedRequest: ParsedRequest = {
        query: {},
        options: {},
        parsed: {
          fields: [],
          paramsFilter: [],
          search: {},
          filter: [],
          or: [],
          join: [],
          sort: [],
          limit: 20,
          offset: 0,
          page: 1,
          cache: 0
        }
      };

      const result = await service.createOne(parsedRequest, dto);

      expect(result).toEqual(mockEntity); // bare entity, nestjsx shape
      expect(mockRepository.create).toHaveBeenCalledWith(dto);
      expect(mockRepository.save).toHaveBeenCalledWith(mockEntity);
    });
  });

  describe('buildCondition', () => {
    const build = (operator: string, value: any = 'value') =>
      (service as any).buildCondition('field', operator, value, { n: 0 });

    it('builds scalar operator clauses with bound params', () => {
      expect(build('$eq')).toEqual({ clause: 'entity.field = :p0', params: { p0: 'value' } });
      expect(build('$ne')).toEqual({ clause: 'entity.field != :p0', params: { p0: 'value' } });
      expect(build('$gt', 5)).toEqual({ clause: 'entity.field > :p0', params: { p0: 5 } });
      expect(build('$lte', 5)).toEqual({ clause: 'entity.field <= :p0', params: { p0: 5 } });
    });

    it('wraps LIKE values at build time', () => {
      expect(build('$starts', 'Jo')).toEqual({ clause: 'entity.field LIKE :p0', params: { p0: 'Jo%' } });
      expect(build('$ends', 'hn')).toEqual({ clause: 'entity.field LIKE :p0', params: { p0: '%hn' } });
      expect(build('$cont', 'oh')).toEqual({ clause: 'entity.field LIKE :p0', params: { p0: '%oh%' } });
      expect(build('$excl', 'oh')).toEqual({ clause: 'entity.field NOT LIKE :p0', params: { p0: '%oh%' } });
      expect(build('$contL', 'OH')).toEqual({ clause: 'LOWER(entity.field) LIKE :p0', params: { p0: '%oh%' } });
    });

    it('binds arrays with the TypeORM spread syntax', () => {
      expect(build('$in', ['a', 'b'])).toEqual({
        clause: 'entity.field IN (:...p0)',
        params: { p0: ['a', 'b'] }
      });
      expect(build('$notin', [1, 2])).toEqual({
        clause: 'entity.field NOT IN (:...p0)',
        params: { p0: [1, 2] }
      });
      expect(build('$inL', ['A', 'B'])).toEqual({
        clause: 'LOWER(entity.field) IN (:...p0)',
        params: { p0: ['a', 'b'] }
      });
    });

    it('binds $between as two params', () => {
      expect(build('$between', [1, 10])).toEqual({
        clause: 'entity.field BETWEEN :p0 AND :p1',
        params: { p0: 1, p1: 10 }
      });
    });

    it('emits valueless clauses for null checks', () => {
      expect(build('$isnull', undefined)).toEqual({ clause: 'entity.field IS NULL', params: {} });
      expect(build('$notnull', undefined)).toEqual({ clause: 'entity.field IS NOT NULL', params: {} });
    });

    it('rejects empty arrays and unknown operators with 400', () => {
      expect(() => build('$in', [])).toThrow('$in expects a non-empty array');
      expect(() => build('$between', [1])).toThrow('$between expects exactly two values');
      expect(() => build('$bogus')).toThrow('Unknown filter operator: $bogus');
    });
  });
});