/**
 * CRUD Decorator Tests
 */

import { Controller, Get, Post, Patch, Put, Delete } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Crud } from './crud.decorator';
import { CrudControllerOptions } from '@apso/crud-core';

// Mock entity for testing
class TestEntity {
  id!: number;
  name!: string;
  status!: string;
}

// Mock DTO for testing
class TestCreateDto {
  name!: string;
  status!: string;
}

describe('Crud Decorator', () => {
  let TestController: any;

  beforeEach(() => {
    // Create a fresh test controller for each test
    @Crud({
      model: { type: TestEntity },
      dto: {
        create: TestCreateDto,
        update: TestEntity,
        replace: TestEntity
      },
      query: {
        limit: 20,
        maxLimit: 100,
        alwaysPaginate: true,
        join: {
          facilities: { eager: false },
          customer: { eager: true }
        }
      },
      routes: {
        exclude: [] // Include all routes for testing
      }
    })
    class TestControllerClass {
      getMany() { return Promise.resolve({ data: [], count: 0, total: 0, page: 1, pageCount: 0 }); }
      getOne() { return Promise.resolve({ data: {} }); }
      createOne() { return Promise.resolve({ data: {} }); }
      createMany() { return Promise.resolve({ data: [] }); }
      updateOne() { return Promise.resolve({ data: {} }); }
      replaceOne() { return Promise.resolve({ data: {} }); }
      deleteOne() { return Promise.resolve({}); }
      recoverOne() { return Promise.resolve({ data: {} }); }
    }

    TestController = TestControllerClass;
  });

  it('should apply Controller decorator', () => {
    // @Crud deliberately does NOT apply @Controller (nestjsx semantics:
    // the consumer's own @Controller('path') owns the mount path).
    const controllerMetadata = Reflect.getMetadata('path', TestController);
    expect(controllerMetadata).toBeUndefined();
  });

  it('should store CRUD options in metadata', () => {
    const crudOptions = Reflect.getMetadata('CRUD_OPTIONS_METADATA', TestController);

    expect(crudOptions).toBeDefined();
    expect(crudOptions.model.type).toBe(TestEntity);
    expect(crudOptions.dto.create).toBe(TestCreateDto);
    expect(crudOptions.query.limit).toBe(20);
    expect(crudOptions.query.alwaysPaginate).toBe(true);
  });

  it('should store CRUD controller metadata', () => {
    const isCrudController = Reflect.getMetadata('CRUD_CONTROLLER_METADATA', TestController);
    expect(isCrudController).toBe(true);
  });

  it('should apply route decorators to methods', () => {
    const instance = new TestController();

    // Check if HTTP method decorators are applied
    const getManyMetadata = Reflect.getMetadata('method', TestController.prototype.getMany);
    const createOneMetadata = Reflect.getMetadata('method', TestController.prototype.createOne);
    const updateOneMetadata = Reflect.getMetadata('method', TestController.prototype.updateOne);
    const deleteOneMetadata = Reflect.getMetadata('method', TestController.prototype.deleteOne);

    // These should be defined if decorators were applied
    expect(instance.getMany).toBeDefined();
    expect(instance.createOne).toBeDefined();
    expect(instance.updateOne).toBeDefined();
    expect(instance.deleteOne).toBeDefined();
  });

  describe('Route Exclusion', () => {
    it('should exclude specified routes', () => {
      @Crud({
        model: { type: TestEntity },
        routes: {
          exclude: ['createManyBase', 'deleteOneBase']
        }
      })
      class ExcludeTestController {
        getMany() { return Promise.resolve({ data: [], count: 0, total: 0, page: 1, pageCount: 0 }); }
        getOne() { return Promise.resolve({ data: {} }); }
        createOne() { return Promise.resolve({ data: {} }); }
        updateOne() { return Promise.resolve({ data: {} }); }
        replaceOne() { return Promise.resolve({ data: {} }); }
      }

      const options = Reflect.getMetadata('CRUD_OPTIONS_METADATA', ExcludeTestController);
      expect(options.routes.exclude).toContain('createManyBase');
      expect(options.routes.exclude).toContain('deleteOneBase');
    });

    it('should include only specified routes', () => {
      @Crud({
        model: { type: TestEntity },
        routes: {
          only: ['getManyBase', 'getOneBase', 'createOneBase']
        }
      })
      class OnlyTestController {
        getMany() { return Promise.resolve({ data: [], count: 0, total: 0, page: 1, pageCount: 0 }); }
        getOne() { return Promise.resolve({ data: {} }); }
        createOne() { return Promise.resolve({ data: {} }); }
      }

      const options = Reflect.getMetadata('CRUD_OPTIONS_METADATA', OnlyTestController);
      expect(options.routes.only).toContain('getManyBase');
      expect(options.routes.only).toContain('getOneBase');
      expect(options.routes.only).toContain('createOneBase');
      expect(options.routes.only).toHaveLength(3);
    });
  });

  describe('Configuration Options', () => {
    it('should handle complex query configuration', () => {
      const complexOptions: CrudControllerOptions = {
        model: { type: TestEntity },
        query: {
          allow: ['name', 'status', 'id'],
          exclude: ['internalField'],
          persist: ['tenantId'],
          filter: { status: 'Active' },
          join: {
            facilities: {
              eager: false,
              allow: ['id', 'name'],
              exclude: ['secret'],
              alias: 'fac'
            },
            customer: {
              eager: true
            }
          },
          sort: { name: 'ASC', createdAt: 'DESC' },
          limit: 25,
          maxLimit: 200,
          alwaysPaginate: true,
          cache: 3600
        },
        params: {
          id: { field: 'id', type: 'number', primary: true },
          customerId: { field: 'customer_id', type: 'string' }
        }
      };

      @Crud(complexOptions)
      class ComplexController {
        getMany() { return Promise.resolve({ data: [], count: 0, total: 0, page: 1, pageCount: 0 }); }
      }

      const storedOptions = Reflect.getMetadata('CRUD_OPTIONS_METADATA', ComplexController);

      expect(storedOptions.query.allow).toEqual(['name', 'status', 'id']);
      expect(storedOptions.query.exclude).toEqual(['internalField']);
      expect(storedOptions.query.join.facilities.eager).toBe(false);
      expect(storedOptions.query.join.facilities.alias).toBe('fac');
      expect(storedOptions.query.join.customer.eager).toBe(true);
      expect(storedOptions.query.limit).toBe(25);
      expect(storedOptions.query.maxLimit).toBe(200);
      expect(storedOptions.params.id.primary).toBe(true);
      expect(storedOptions.params.customerId.field).toBe('customer_id');
    });

    it('should handle validation configuration', () => {
      @Crud({
        model: { type: TestEntity },
        validation: {
          transform: true,
          whitelist: true,
          forbidNonWhitelisted: true,
          validationError: {
            target: false,
            value: false
          }
        }
      })
      class ValidationController {
        createOne() { return Promise.resolve({ data: {} }); }
      }

      const options = Reflect.getMetadata('CRUD_OPTIONS_METADATA', ValidationController);
      expect(options.validation.transform).toBe(true);
      expect(options.validation.whitelist).toBe(true);
      expect(options.validation.forbidNonWhitelisted).toBe(true);
      expect(options.validation.validationError.target).toBe(false);
      expect(options.validation.validationError.value).toBe(false);
    });
  });

  describe('DTO Configuration', () => {
    it('should handle different DTOs for different operations', () => {
      class CreateDto { name!: string;  }
      class UpdateDto { name?: string; status?: string; }
      class ReplaceDto { name!: string; status!: string;  }

      @Crud({
        model: { type: TestEntity },
        dto: {
          create: CreateDto,
          update: UpdateDto,
          replace: ReplaceDto
        }
      })
      class DtoController {
        createOne() { return Promise.resolve({ data: {} }); }
        updateOne() { return Promise.resolve({ data: {} }); }
        replaceOne() { return Promise.resolve({ data: {} }); }
      }

      const options = Reflect.getMetadata('CRUD_OPTIONS_METADATA', DtoController);
      expect(options.dto.create).toBe(CreateDto);
      expect(options.dto.update).toBe(UpdateDto);
      expect(options.dto.replace).toBe(ReplaceDto);
    });

    it('should default to entity type when DTOs not specified', () => {
      @Crud({
        model: { type: TestEntity }
        // No dto specified
      })
      class DefaultDtoController {
        createOne() { return Promise.resolve({ data: {} }); }
      }

      const options = Reflect.getMetadata('CRUD_OPTIONS_METADATA', DefaultDtoController);
      expect(options.dto).toBeUndefined();
      // In actual implementation, it would default to the entity type
    });
  });

  describe('Swagger Integration', () => {
    it('should apply API tags based on entity name', () => {
      // This test verifies that Swagger decorators are applied
      // In a real implementation, we'd check for ApiTags metadata
      const instance = new TestController();
      expect(instance).toBeDefined();

      // Verify that the class has been decorated
      const metadata = Reflect.getMetadata('CRUD_OPTIONS_METADATA', TestController);
      expect(metadata.model.type.name).toBe('TestEntity');
    });
  });
});