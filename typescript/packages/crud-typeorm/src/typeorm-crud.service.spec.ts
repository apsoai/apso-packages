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
  findOne: jest.fn(),
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
  setLock: jest.fn().mockReturnThis(),
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

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('entity.name', 'ASC', undefined);
      expect(mockQueryBuilder.addOrderBy).toHaveBeenCalledWith('entity.createdAt', 'DESC', undefined);
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

      // No select list: join-and-select everything. The trailing undefineds
      // are the (optional) ON clause + params, absent for a plain join (#59).
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('entity.facilities', 'facilities', undefined, undefined);
      // Explicit select list: plain join + selected columns incl. the PK
      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledWith('entity.customer', 'cust', undefined, undefined);
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

  describe('getMany PostgREST dialect (#57/#58/#60)', () => {
    const pgRequest = (over: Partial<ParsedRequest['parsed']> = {}, query: any = {}): ParsedRequest => ({
      query,
      options: {},
      parsed: {
        fields: [], paramsFilter: [], search: {}, filter: [], or: [], join: [],
        sort: [], limit: 20, offset: 0, page: 1, cache: 0,
        dialect: 'postgrest', ...over,
      },
    });

    it('#58 returns a bare array (never the {data,count} envelope), even with offset', async () => {
      const rows = [{ id: 3 }, { id: 4 }];
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue(rows);
      // offset present would trigger the nestjsx envelope in decidePagination;
      // the postgrest path must ignore that and return the bare array.
      const res = await service.getMany(pgRequest({ limit: 2, offset: 2 }, { limit: 2, offset: 2 }));
      expect(Array.isArray(res)).toBe(true);
      expect(res).toEqual(rows);
      expect(mockQueryBuilder.getManyAndCount).not.toHaveBeenCalled();
      // limit/offset still window the array
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(2);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(2);
    });

    it('#57 renames output keys from column to alias (fieldAliases)', async () => {
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([
        { id: 1, title: 'A' }, { id: 2, title: 'B' },
      ]);
      const res = await service.getMany(pgRequest({ fieldAliases: { title: 'name' } }));
      expect(res).toEqual([{ id: 1, name: 'A' }, { id: 2, name: 'B' }]);
    });

    it('#60 maps Postgres 42703 (undefined_column) to a 400', async () => {
      const err: any = new Error('column "nonexistent" does not exist');
      err.code = '42703';
      (mockQueryBuilder.getMany as jest.Mock).mockRejectedValue(err);
      await expect(service.getMany(pgRequest())).rejects.toMatchObject({ status: 400 });
    });

    it('#60 rethrows non-42703 errors unchanged', async () => {
      const err: any = new Error('boom');
      err.code = '08006';
      (mockQueryBuilder.getMany as jest.Mock).mockRejectedValue(err);
      await expect(service.getMany(pgRequest())).rejects.toThrow('boom');
    });

    it('nestjsx path is unaffected: 42703 is NOT swallowed to a 400', async () => {
      const err: any = new Error('column "x" does not exist');
      err.code = '42703';
      (mockQueryBuilder.getMany as jest.Mock).mockRejectedValue(err);
      // No dialect marker => nestjsx bare-array path => error propagates raw.
      const nx: ParsedRequest = {
        query: {}, options: {},
        parsed: {
          fields: [], paramsFilter: [], search: {}, filter: [], or: [], join: [],
          sort: [], limit: 20, offset: 0, page: 1, cache: 0,
        },
      };
      await expect(service.getMany(nx)).rejects.toMatchObject({ code: '42703' });
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

      // #44 (intended divergence): createOne echoes the SAVED entity as-is —
      // the correct UTC instant — not a re-fetch. We do not replicate
      // nestjsx's timezone-shifted persisted-echo.
      expect(result).toEqual(mockEntity);
      expect(mockRepository.create).toHaveBeenCalledWith(dto);
      expect(mockRepository.save).toHaveBeenCalledWith(mockEntity);
      expect(mockRepository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('createMany empty-bulk guard (#45)', () => {
    const emptyReq: ParsedRequest = {
      query: {}, options: {},
      parsed: { fields: [], paramsFilter: [], search: {}, filter: [], or: [], join: [], sort: [], limit: 20, offset: 0, page: 1, cache: 0 }
    };
    it('400s an empty bulk array with the class-validator message shape', async () => {
      // nestjsx's @ArrayNotEmpty produces {message: ['bulk should not be empty']};
      // Nest renders array-message BadRequestExceptions as 'Bad Request Exception'.
      for (const dto of [{ bulk: [] }, {}]) {
        const err = await service.createMany(emptyReq, dto as any).catch((e: any) => e);
        expect(err.getStatus()).toBe(400);
        expect(err.getResponse().message).toEqual(['bulk should not be empty']);
      }
    });
  });

  describe('primary-key safety on mutations (#43)', () => {
    const reqTargeting = (id: number): ParsedRequest => ({
      query: {},
      options: {},
      parsed: {
        fields: [],
        paramsFilter: [{ field: 'id', operator: '$eq', value: id }],
        search: { id: { $eq: id } },
        filter: [],
        or: [],
        join: [],
        sort: [],
        limit: 20,
        offset: 0,
        page: 1,
        cache: 0
      }
    });

    // updateOne reads and saves through one transaction's manager.
    const inTransaction = () => {
      const manager = {
        createQueryBuilder: jest.fn(() => mockQueryBuilder),
        save: jest.fn(async (_target: unknown, e: unknown) => e)
      };
      (mockRepository as any).manager = { transaction: (work: (m: unknown) => Promise<unknown>) => work(manager) };
      return manager;
    };

    it('updateOne ignores a primary key in the body (keeps the fetched row id)', async () => {
      const existing = { id: 1, name: 'Original', status: 'Active' };
      (mockQueryBuilder.getOne as jest.Mock).mockResolvedValue(existing);
      const manager = inTransaction();

      // Client echoes a fetched entity back with a different id
      await service.updateOne(reqTargeting(1), { id: 999, name: 'Changed' } as any);

      const saved = manager.save.mock.calls[0][1] as any;
      expect(saved.id).toBe(1);      // NOT 999 — identity preserved
      expect(saved.name).toBe('Changed');
    });

    it('updateOne locks the row it reads, and saves nothing when the row does not match', async () => {
      const manager = inTransaction();
      (mockQueryBuilder.getOne as jest.Mock).mockResolvedValue({ id: 1, name: 'Original', status: 'Active' });
      await service.updateOne(reqTargeting(1), { name: 'Changed' } as any);
      expect(mockQueryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(manager.save).toHaveBeenCalledTimes(1);

      (mockQueryBuilder.getOne as jest.Mock).mockResolvedValue(null);
      await expect(service.updateOne(reqTargeting(1), { name: 'Late' } as any)).rejects.toThrow('TestEntity not found');
      expect(manager.save).toHaveBeenCalledTimes(1);
    });

    it('replaceOne targets the route id, not a body id', async () => {
      const existing = { id: 1, name: 'Original', status: 'Active' };
      (mockQueryBuilder.getOne as jest.Mock).mockResolvedValue(existing);
      (mockRepository.save as jest.Mock).mockImplementation(async (e) => e);

      await service.replaceOne(reqTargeting(1), { id: 999, name: 'Replaced', status: 'Draft' } as any);

      const saved = (mockRepository.save as jest.Mock).mock.calls[0][0];
      expect(saved.id).toBe(1);      // route wins over body
      expect(saved.name).toBe('Replaced');
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

    it('$like / $ilike take raw patterns (PostgREST dialect, values pre-wildcarded)', () => {
      expect(build('$like', '%ada%')).toEqual({ clause: 'entity.field LIKE :p0', params: { p0: '%ada%' } });
      expect(build('$ilike', 'A%')).toEqual({ clause: 'LOWER(entity.field) LIKE LOWER(:p0)', params: { p0: 'A%' } });
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
      // #41: L-variant multi-value ops lower only the column; values as given
      expect(build('$inL', ['A', 'B'])).toEqual({
        clause: 'LOWER(entity.field) IN (:...p0)',
        params: { p0: ['A', 'B'] }
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

    it('rejects empty arrays with 400; unknown operators fall through to equality (nestjsx s= behavior)', () => {
      expect(() => build('$in', [])).toThrow('$in expects a non-empty array');
      expect(() => build('$between', [1])).toThrow('$between expects exactly two values');
      expect(build('$bogus', 5)).toEqual({ clause: 'entity.field = :p0', params: { p0: 5 } });
    });
  });

  // The read finds the row in every case below. What the DELETE statement
  // reports decides whether this request deleted it. The same behaviour runs
  // against a database in crud-parity/test/concurrent-delete.spec.ts.
  describe('deleteOne', () => {
    const row = { id: 7, name: 'single use', status: 'Active', createdAt: new Date('2026-11-13T00:00:00.000Z') };
    const req = {
      parsed: { paramsFilter: [{ field: 'id', operator: '$eq', value: 7 }], search: {} },
      options: {}
    } as unknown as ParsedRequest;

    const run = async (deleteResult: unknown, returning = true) => {
      (mockQueryBuilder.getOne as jest.Mock).mockResolvedValue(row);
      const take: any = {};
      for (const step of ['delete', 'from', 'where', 'callListeners', 'returning']) take[step] = jest.fn(() => take);
      take.execute = jest.fn().mockResolvedValue(deleteResult);
      const manager = {
        createQueryBuilder: jest.fn((target?: unknown) => (target ? mockQueryBuilder : take)),
        remove: jest.fn(),
        connection: { driver: { isReturningSqlSupported: () => returning } }
      };
      (mockRepository as any).manager = { transaction: (work: (m: unknown) => Promise<void>) => work(manager) };
      const outcome = await service.deleteOne(req).then(
        () => 'deleted',
        (error: Error) => error.message
      );
      return { outcome, manager, take };
    };

    it('deletes the row it read and still calls remove() with the entity', async () => {
      const { outcome, manager, take } = await run({ raw: [{ id: 7 }], affected: 1 });
      expect(outcome).toBe('deleted');
      expect(take.where).toHaveBeenCalledWith({ id: 7 });
      expect(take.callListeners).toHaveBeenCalledWith(false);
      expect(manager.remove).toHaveBeenCalledWith(row);
    });

    it('answers not found when another request deleted the row after the read', async () => {
      const { outcome, manager } = await run({ raw: [], affected: 0 });
      expect(outcome).toBe('TestEntity not found');
      expect(manager.remove).not.toHaveBeenCalled();
    });

    it('reads the deleted rows when the driver reports no row count', async () => {
      expect((await run({ raw: [] })).outcome).toBe('TestEntity not found');
      expect((await run({ raw: [{ id: 7 }] })).outcome).toBe('deleted');
    });

    it('does not ask for the row back where the database cannot return it', async () => {
      const { outcome, take } = await run({ raw: {}, affected: 1 }, false);
      expect(outcome).toBe('deleted');
      expect(take.returning).not.toHaveBeenCalled();
    });
  });
});
