/**
 * @apso/crud
 *
 * Complete CRUD framework for NestJS - drop-in replacement for nestjsx/crud
 * with enhanced features, better performance, and active maintenance.
 */

// Export main decorators and base classes
export { Crud } from './crud.decorator';
export { CrudControllerBase, CrudController } from './crud-controller.base';

// Re-export core types and interfaces (excluding CrudController which conflicts with class)
export {
  // Interfaces (using different name to avoid conflict)
  CrudController as ICrudController,
  CrudControllerOptions,
  CrudRoutes,
  RouteOptions,
  CrudRequest,
  BaseCrudController,
  // Service interfaces
  CrudService,
  CrudServiceOptions,
  // Request/Response types
  ParsedRequest,
  CrudRequestQuery,
  CrudRequestOptions,
  FilterCondition,
  SortCondition,
  JoinCondition,
  FilterOperator,
  SearchCondition,
  GetManyResponse,
  GetOneResponse,
  CreateOneResponse,
  CreateManyResponse,
  UpdateOneResponse,
  ReplaceOneResponse,
  DeleteOneResponse,
  RecoverOneResponse,
  DeepPartial,
  CreateManyDto,
  // Constants
  CrudValidationGroups,
  CRUD_OPTIONS_METADATA,
  CRUD_CONTROLLER_METADATA,
} from '@apso/crud-core';

// Re-export request parsing utilities
export {
  CrudRequestInterceptor,
  extractParsedRequest,
  CrudRequestParser,
  createRequestParser,
  parseRequest,
} from '@apso/crud-request';

// Re-export TypeORM integration
export { TypeOrmCrudService } from '@apso/crud-typeorm';
