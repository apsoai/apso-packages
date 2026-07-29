/**
 * CRUD Controller Base Tests
 */

import { CrudController, CrudControllerBase } from './crud-controller.base';
import { CrudService, ParsedRequest } from '@apso/crud-core';

// Mock entity
interface TestEntity {
  id: number;
  name: string;
  status: string;
}

// Mock CRUD service
const mockCrudService: CrudService<TestEntity> = {
  getMany: jest.fn(),
  getOne: jest.fn(),
  createOne: jest.fn(),
  createMany: jest.fn(),
  updateOne: jest.fn(),
  replaceOne: jest.fn(),
  deleteOne: jest.fn(),
  recoverOne: jest.fn()
};

// Mock request with parsed data
const mockRequest = {
  [Symbol.for('PARSED_CRUD_REQUEST_KEY')]: {
    query: {},
    options: {},
    parsed: {
      fields: ['name', 'status'],
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
  } as ParsedRequest
};

// Mock the extractParsedRequest function. The factory is hoisted above
// mockRequest's initialization, so it must dereference lazily (at call
// time), not capture the value at factory time.
jest.mock('./crud-request.interceptor', () => ({
  extractParsedRequest: jest.fn(
    (req: Record<symbol, unknown>) => req[Symbol.for('PARSED_CRUD_REQUEST_KEY')],
  ),
}));

describe('CrudControllerBase', () => {
  let controller: CrudControllerBase<TestEntity>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create concrete implementation for testing
    class TestController extends CrudControllerBase<TestEntity> {
      service = mockCrudService;
    }

    controller = new TestController();
  });

  describe('getMany', () => {
    it('should call service.getMany with parsed request', async () => {
      const expectedResult = { data: [], count: 0, total: 0, page: 1, pageCount: 0 };
      (mockCrudService.getMany as jest.Mock).mockResolvedValue(expectedResult);

      const result = await controller.getMany(mockRequest);

      expect(mockCrudService.getMany).toHaveBeenCalledWith(mockRequest[Symbol.for('PARSED_CRUD_REQUEST_KEY')]);
      expect(result).toBe(expectedResult);
    });
  });

  describe('getOne', () => {
    it('should call service.getOne with parsed request', async () => {
      const expectedResult = { data: { id: 1, name: 'Test', status: 'Active' } };
      (mockCrudService.getOne as jest.Mock).mockResolvedValue(expectedResult);

      const result = await controller.getOne(mockRequest);

      expect(mockCrudService.getOne).toHaveBeenCalledWith(mockRequest[Symbol.for('PARSED_CRUD_REQUEST_KEY')]);
      expect(result).toBe(expectedResult);
    });
  });

  describe('createOne', () => {
    it('should call service.createOne with parsed request and dto', async () => {
      const dto = { name: 'New Entity', status: 'Active' };
      const expectedResult = { data: { id: 1, ...dto } };
      (mockCrudService.createOne as jest.Mock).mockResolvedValue(expectedResult);

      const result = await controller.createOne(mockRequest, dto);

      expect(mockCrudService.createOne).toHaveBeenCalledWith(
        mockRequest[Symbol.for('PARSED_CRUD_REQUEST_KEY')],
        dto
      );
      expect(result).toBe(expectedResult);
    });
  });

  describe('createMany', () => {
    it('should call service.createMany with parsed request and dto', async () => {
      const dto = { bulk: [{ name: 'Entity 1' }, { name: 'Entity 2' }] };
      const expectedResult = { data: [{ id: 1, name: 'Entity 1' }, { id: 2, name: 'Entity 2' }] };
      (mockCrudService.createMany as jest.Mock).mockResolvedValue(expectedResult);

      const result = await controller.createMany(mockRequest, dto);

      expect(mockCrudService.createMany).toHaveBeenCalledWith(
        mockRequest[Symbol.for('PARSED_CRUD_REQUEST_KEY')],
        dto
      );
      expect(result).toBe(expectedResult);
    });
  });

  describe('updateOne', () => {
    it('should call service.updateOne with parsed request and dto', async () => {
      const dto = { name: 'Updated Entity' };
      const expectedResult = { data: { id: 1, name: 'Updated Entity', status: 'Active' } };
      (mockCrudService.updateOne as jest.Mock).mockResolvedValue(expectedResult);

      const result = await controller.updateOne(mockRequest, dto);

      expect(mockCrudService.updateOne).toHaveBeenCalledWith(
        mockRequest[Symbol.for('PARSED_CRUD_REQUEST_KEY')],
        dto
      );
      expect(result).toBe(expectedResult);
    });
  });

  describe('replaceOne', () => {
    it('should call service.replaceOne with parsed request and dto', async () => {
      const dto = { id: 1, name: 'Replaced Entity', status: 'Inactive' };
      const expectedResult = { data: dto };
      (mockCrudService.replaceOne as jest.Mock).mockResolvedValue(expectedResult);

      const result = await controller.replaceOne(mockRequest, dto);

      expect(mockCrudService.replaceOne).toHaveBeenCalledWith(
        mockRequest[Symbol.for('PARSED_CRUD_REQUEST_KEY')],
        dto
      );
      expect(result).toBe(expectedResult);
    });
  });

  describe('deleteOne', () => {
    it('should call service.deleteOne with parsed request', async () => {
      const expectedResult = {};
      (mockCrudService.deleteOne as jest.Mock).mockResolvedValue(expectedResult);

      const result = await controller.deleteOne(mockRequest);

      expect(mockCrudService.deleteOne).toHaveBeenCalledWith(mockRequest[Symbol.for('PARSED_CRUD_REQUEST_KEY')]);
      expect(result).toBe(expectedResult);
    });
  });

  describe('recoverOne', () => {
    it('should call service.recoverOne with parsed request', async () => {
      const expectedResult = { data: { id: 1, name: 'Recovered Entity', status: 'Active' } };
      (mockCrudService.recoverOne as jest.Mock).mockResolvedValue(expectedResult);

      const result = await controller.recoverOne(mockRequest);

      expect(mockCrudService.recoverOne).toHaveBeenCalledWith(mockRequest[Symbol.for('PARSED_CRUD_REQUEST_KEY')]);
      expect(result).toBe(expectedResult);
    });

    it('should throw error when service does not support recover', async () => {
      const serviceWithoutRecover = { ...mockCrudService };
      delete serviceWithoutRecover.recoverOne;

      class TestControllerWithoutRecover extends CrudControllerBase<TestEntity> {
        service = serviceWithoutRecover;
      }

      const controllerWithoutRecover = new TestControllerWithoutRecover();

      await expect(controllerWithoutRecover.recoverOne(mockRequest))
        .rejects.toThrow('Recover operation not supported by this service');
    });
  });
});

describe('CrudController with Hooks', () => {
  let controller: CrudController<TestEntity>;
  let beforeGetManyHook: jest.Mock;
  let afterGetManyHook: jest.Mock;
  let beforeCreateOneHook: jest.Mock;
  let afterCreateOneHook: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    beforeGetManyHook = jest.fn();
    afterGetManyHook = jest.fn();
    beforeCreateOneHook = jest.fn();
    afterCreateOneHook = jest.fn();

    // Create controller with hooks
    class TestControllerWithHooks extends CrudController<TestEntity> {
      service = mockCrudService;

      protected beforeGetMany = beforeGetManyHook;
      protected afterGetMany = afterGetManyHook;
      protected beforeCreateOne = beforeCreateOneHook;
      protected afterCreateOne = afterCreateOneHook;
    }

    controller = new TestControllerWithHooks();
  });

  describe('getMany with hooks', () => {
    it('should call beforeGetMany and afterGetMany hooks', async () => {
      const serviceResult = { data: [], count: 0, total: 0, page: 1, pageCount: 0 };
      const modifiedResult = { ...serviceResult, customField: 'added by hook' };

      (mockCrudService.getMany as jest.Mock).mockResolvedValue(serviceResult);
      afterGetManyHook.mockReturnValue(modifiedResult);

      const result = await controller.getMany(mockRequest);

      expect(beforeGetManyHook).toHaveBeenCalledWith(mockRequest[Symbol.for('PARSED_CRUD_REQUEST_KEY')]);
      expect(mockCrudService.getMany).toHaveBeenCalledWith(mockRequest[Symbol.for('PARSED_CRUD_REQUEST_KEY')]);
      expect(afterGetManyHook).toHaveBeenCalledWith(
        mockRequest[Symbol.for('PARSED_CRUD_REQUEST_KEY')],
        serviceResult
      );
      expect(result).toBe(modifiedResult);
    });

    it('should handle async hooks', async () => {
      const serviceResult = { data: [], count: 0, total: 0, page: 1, pageCount: 0 };

      beforeGetManyHook.mockResolvedValue(undefined);
      afterGetManyHook.mockResolvedValue(serviceResult);
      (mockCrudService.getMany as jest.Mock).mockResolvedValue(serviceResult);

      const result = await controller.getMany(mockRequest);

      expect(beforeGetManyHook).toHaveBeenCalled();
      expect(afterGetManyHook).toHaveBeenCalled();
      expect(result).toBe(serviceResult);
    });
  });

  describe('createOne with hooks', () => {
    it('should call beforeCreateOne and afterCreateOne hooks', async () => {
      const originalDto = { name: 'Original', status: 'Active' };
      const modifiedDto = { name: 'Modified by hook', status: 'Active' };
      const serviceResult = { data: { id: 1, ...modifiedDto } };
      const finalResult = { ...serviceResult, hookProcessed: true };

      beforeCreateOneHook.mockReturnValue(modifiedDto);
      afterCreateOneHook.mockReturnValue(finalResult);
      (mockCrudService.createOne as jest.Mock).mockResolvedValue(serviceResult);

      const result = await controller.createOne(mockRequest, originalDto);

      expect(beforeCreateOneHook).toHaveBeenCalledWith(
        mockRequest[Symbol.for('PARSED_CRUD_REQUEST_KEY')],
        originalDto
      );
      expect(mockCrudService.createOne).toHaveBeenCalledWith(
        mockRequest[Symbol.for('PARSED_CRUD_REQUEST_KEY')],
        modifiedDto
      );
      expect(afterCreateOneHook).toHaveBeenCalledWith(
        mockRequest[Symbol.for('PARSED_CRUD_REQUEST_KEY')],
        serviceResult
      );
      expect(result).toBe(finalResult);
    });
  });

  describe('hook error handling', () => {
    it('should propagate errors from before hooks', async () => {
      const error = new Error('Before hook failed');
      beforeGetManyHook.mockRejectedValue(error);

      await expect(controller.getMany(mockRequest)).rejects.toThrow('Before hook failed');

      expect(beforeGetManyHook).toHaveBeenCalled();
      expect(mockCrudService.getMany).not.toHaveBeenCalled();
    });

    it('should propagate errors from after hooks', async () => {
      const serviceResult = { data: [], count: 0, total: 0, page: 1, pageCount: 0 };
      const error = new Error('After hook failed');

      (mockCrudService.getMany as jest.Mock).mockResolvedValue(serviceResult);
      afterGetManyHook.mockRejectedValue(error);

      await expect(controller.getMany(mockRequest)).rejects.toThrow('After hook failed');

      expect(beforeGetManyHook).toHaveBeenCalled();
      expect(mockCrudService.getMany).toHaveBeenCalled();
      expect(afterGetManyHook).toHaveBeenCalled();
    });
  });
});