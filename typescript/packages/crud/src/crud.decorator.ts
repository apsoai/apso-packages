/**
 * CRUD Decorator
 *
 * This decorator provides the main @Crud() functionality that replaces
 * the nestjsx/crud decorator with enhanced features and better type safety.
 */

import {
  applyDecorators,
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseInterceptors,
  SetMetadata
} from '@nestjs/common';
import { extractParsedRequest as extractParsed } from './crud-request.interceptor';
import { findOverride, wrapHandlerParams, BaseRouteName } from './nestjsx-compat';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import {
  CrudControllerOptions,
  CRUD_OPTIONS_METADATA,
  CRUD_CONTROLLER_METADATA,
  CrudValidationGroups
} from '@apso/crud-core';
import { CrudRequestInterceptor, extractParsedRequest } from './crud-request.interceptor';

/**
 * Main CRUD decorator that configures a controller class for CRUD operations
 */
export function Crud(options: CrudControllerOptions): ClassDecorator {
  return (target: any) => {
    // Store options in metadata
    SetMetadata(CRUD_OPTIONS_METADATA, options)(target);
    SetMetadata(CRUD_CONTROLLER_METADATA, true)(target);

    // NOTE: unlike an earlier draft, @Crud does NOT apply @Controller —
    // nestjsx semantics: the consumer's own @Controller('path') owns the
    // mount path, and applying Controller() here would clobber it.

    // Apply interceptor for request parsing
    UseInterceptors(CrudRequestInterceptor)(target);

    // Apply API documentation
    if (options.model?.type) {
      const entityName = options.model.type.name || 'Entity';
      ApiTags(entityName)(target);
    }

    // Generate CRUD routes
    generateCrudRoutes(target, options);

    return target;
  };
}

/**
 * Generate all CRUD route decorators
 */
function generateCrudRoutes(target: any, options: CrudControllerOptions) {
  const routes = options.routes;
  const entityName = options.model?.type?.name || 'Entity';

  // GET Many - GET /
  if (!routes?.exclude?.includes('getManyBase')) {
    const getManyDecorators = [
      Get(),
      ApiOperation({
        summary: `Get many ${entityName}`,
        description: `Retrieve multiple ${entityName} entities with filtering, sorting, and pagination`
      }),
      ApiResponse({
        status: 200,
        description: `${entityName} entities retrieved successfully`,
        schema: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: `#/components/schemas/${entityName}` } },
            count: { type: 'number' },
            total: { type: 'number' },
            page: { type: 'number' },
            pageCount: { type: 'number' }
          }
        }
      }),
      // Add query parameter documentation
      ...generateQueryDocumentation(options)
    ];

    applyMethodDecorators(target, 'getMany', getManyDecorators);
  }

  // GET One - GET /:id
  if (!routes?.exclude?.includes('getOneBase')) {
    const getOneDecorators = [
      Get(':id'),
      ApiOperation({
        summary: `Get one ${entityName}`,
        description: `Retrieve a single ${entityName} entity by ID`
      }),
      ApiParam({ name: 'id', description: `${entityName} ID` }),
      ApiResponse({
        status: 200,
        description: `${entityName} entity retrieved successfully`,
        schema: {
          type: 'object',
          properties: {
            data: { $ref: `#/components/schemas/${entityName}` }
          }
        }
      }),
      ApiResponse({ status: 404, description: `${entityName} not found` })
    ];

    applyMethodDecorators(target, 'getOne', getOneDecorators);
  }

  // POST Create - POST /
  if (!routes?.exclude?.includes('createOneBase')) {
    const createDto = options.dto?.create || options.model.type;
    const createOneDecorators = [
      Post(),
      ApiOperation({
        summary: `Create ${entityName}`,
        description: `Create a new ${entityName} entity`
      }),
      ApiBody({
        type: createDto,
        description: `${entityName} data for creation`
      }),
      ApiResponse({
        status: 201,
        description: `${entityName} created successfully`,
        schema: {
          type: 'object',
          properties: {
            data: { $ref: `#/components/schemas/${entityName}` }
          }
        }
      }),
      ApiResponse({ status: 400, description: 'Validation failed' })
    ];

    applyMethodDecorators(target, 'createOne', createOneDecorators);
  }

  // POST Create Many - POST /bulk
  if (!routes?.exclude?.includes('createManyBase')) {
    const createDto = options.dto?.create || options.model.type;
    const createManyDecorators = [
      Post('bulk'),
      ApiOperation({
        summary: `Create many ${entityName}`,
        description: `Create multiple ${entityName} entities`
      }),
      ApiBody({
        schema: {
          type: 'object',
          properties: {
            bulk: {
              type: 'array',
              items: { $ref: `#/components/schemas/${createDto.name || entityName}` }
            }
          }
        },
        description: `${entityName} data for bulk creation`
      }),
      ApiResponse({
        status: 201,
        description: `${entityName} entities created successfully`,
        schema: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: { $ref: `#/components/schemas/${entityName}` }
            }
          }
        }
      })
    ];

    applyMethodDecorators(target, 'createMany', createManyDecorators);
  }

  // PATCH Update - PATCH /:id
  if (!routes?.exclude?.includes('updateOneBase')) {
    const updateDto = options.dto?.update || options.model.type;
    const updateOneDecorators = [
      Patch(':id'),
      ApiOperation({
        summary: `Update ${entityName}`,
        description: `Update an existing ${entityName} entity (partial update)`
      }),
      ApiParam({ name: 'id', description: `${entityName} ID` }),
      ApiBody({
        type: updateDto,
        description: `${entityName} data for update`
      }),
      ApiResponse({
        status: 200,
        description: `${entityName} updated successfully`,
        schema: {
          type: 'object',
          properties: {
            data: { $ref: `#/components/schemas/${entityName}` }
          }
        }
      }),
      ApiResponse({ status: 404, description: `${entityName} not found` })
    ];

    applyMethodDecorators(target, 'updateOne', updateOneDecorators);
  }

  // PUT Replace - PUT /:id
  if (!routes?.exclude?.includes('replaceOneBase')) {
    const replaceDto = options.dto?.replace || options.model.type;
    const replaceOneDecorators = [
      Put(':id'),
      ApiOperation({
        summary: `Replace ${entityName}`,
        description: `Replace an existing ${entityName} entity (full replacement)`
      }),
      ApiParam({ name: 'id', description: `${entityName} ID` }),
      ApiBody({
        type: replaceDto,
        description: `${entityName} data for replacement`
      }),
      ApiResponse({
        status: 200,
        description: `${entityName} replaced successfully`,
        schema: {
          type: 'object',
          properties: {
            data: { $ref: `#/components/schemas/${entityName}` }
          }
        }
      }),
      ApiResponse({ status: 404, description: `${entityName} not found` })
    ];

    applyMethodDecorators(target, 'replaceOne', replaceOneDecorators);
  }

  // DELETE - DELETE /:id
  if (!routes?.exclude?.includes('deleteOneBase')) {
    const deleteOneDecorators = [
      Delete(':id'),
      ApiOperation({
        summary: `Delete ${entityName}`,
        description: `Delete an existing ${entityName} entity`
      }),
      ApiParam({ name: 'id', description: `${entityName} ID` }),
      ApiResponse({
        status: 200,
        description: `${entityName} deleted successfully`
      }),
      ApiResponse({ status: 404, description: `${entityName} not found` })
    ];

    applyMethodDecorators(target, 'deleteOne', deleteOneDecorators);
  }

  // PATCH Recover - PATCH /:id/recover (if soft delete is enabled)
  if (!routes?.exclude?.includes('recoverOneBase') &&
      options.query?.softDelete !== false) {
    const recoverOneDecorators = [
      Patch(':id/recover'),
      ApiOperation({
        summary: `Recover ${entityName}`,
        description: `Recover a soft-deleted ${entityName} entity`
      }),
      ApiParam({ name: 'id', description: `${entityName} ID` }),
      ApiResponse({
        status: 200,
        description: `${entityName} recovered successfully`,
        schema: {
          type: 'object',
          properties: {
            data: { $ref: `#/components/schemas/${entityName}` }
          }
        }
      }),
      ApiResponse({ status: 404, description: `${entityName} not found` })
    ];

    applyMethodDecorators(target, 'recoverOne', recoverOneDecorators);
  }
}

/**
 * Generate query parameter documentation for GET routes
 */
function generateQueryDocumentation(options: CrudControllerOptions) {
  const docs = [];

  // Fields selection
  docs.push(
    ApiQuery({
      name: 'fields',
      required: false,
      description: 'Comma-separated list of fields to select',
      example: 'name,status,id'
    })
  );

  // Filtering
  docs.push(
    ApiQuery({
      name: 'filter',
      required: false,
      description: 'Filter conditions (field||operator||value)',
      example: 'status||$eq||Active'
    })
  );

  // Search
  docs.push(
    ApiQuery({
      name: 's',
      required: false,
      description: 'Complex search conditions (JSON)',
      example: '{"name": {"$contL": "John"}}'
    })
  );

  // Sorting
  docs.push(
    ApiQuery({
      name: 'sort',
      required: false,
      description: 'Sort conditions (field,order)',
      example: 'name,ASC'
    })
  );

  // Joins
  if (options.query?.join) {
    docs.push(
      ApiQuery({
        name: 'join',
        required: false,
        description: 'Join relations',
        example: 'facilities||id,status'
      })
    );
  }

  // Pagination
  docs.push(
    ApiQuery({
      name: 'limit',
      required: false,
      type: 'number',
      description: 'Number of items per page'
    }),
    ApiQuery({
      name: 'page',
      required: false,
      type: 'number',
      description: 'Page number'
    }),
    ApiQuery({
      name: 'offset',
      required: false,
      type: 'number',
      description: 'Number of items to skip'
    })
  );

  return docs;
}

/**
 * Service method + handler shape per base route (nestjsx naming).
 */
const SERVICE_METHOD: Record<string, { op: string; hasBody: boolean }> = {
  getManyBase: { op: 'getMany', hasBody: false },
  getOneBase: { op: 'getOne', hasBody: false },
  createOneBase: { op: 'createOne', hasBody: true },
  createManyBase: { op: 'createMany', hasBody: true },
  updateOneBase: { op: 'updateOne', hasBody: true },
  replaceOneBase: { op: 'replaceOne', hasBody: true },
  deleteOneBase: { op: 'deleteOne', hasBody: false },
  recoverOneBase: { op: 'recoverOne', hasBody: false }
};

/**
 * Resolve the handler that should carry a base route's HTTP decorators and
 * inject a delegating handler when the controller has none — this is what
 * makes plain `class X implements CrudController<T>` work like nestjsx:
 *
 * order: @Override-marked method > <op>Base > legacy <op> > injected <op>Base
 */
function applyMethodDecorators(target: any, legacyName: string, decorators: any[]) {
  const proto = target.prototype;
  const baseName = `${legacyName}Base` as BaseRouteName;
  const spec = SERVICE_METHOD[baseName];

  let methodName =
    findOverride(proto, baseName) ||
    (typeof proto[baseName] === 'function' ? baseName : undefined) ||
    (typeof proto[legacyName] === 'function' ? legacyName : undefined);

  if (!methodName && spec) {
    // Inject the nestjsx-named base handler delegating to the service
    if (spec.hasBody) {
      proto[baseName] = function (this: any, req: any, dto: any) {
        return this.service[spec.op](extractParsed(req), dto);
      };
      Req()(proto, baseName, 0);
      Body()(proto, baseName, 1);
    } else {
      proto[baseName] = function (this: any, req: any) {
        return this.service[spec.op](extractParsed(req));
      };
      Req()(proto, baseName, 0);
    }
    methodName = baseName;
  }

  if (!methodName) return;

  // @ParsedRequest-marked params on overrides receive the parsed request
  wrapHandlerParams(proto, methodName);

  decorators.forEach(decorator => {
    decorator(proto, methodName, Object.getOwnPropertyDescriptor(proto, methodName));
  });
}