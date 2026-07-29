/**
 * @apso/crud
 *
 * Complete CRUD framework for NestJS - drop-in replacement for nestjsx/crud
 * with enhanced features, better performance, and active maintenance.
 */

// Export main decorators and base classes
export { Crud } from './crud.decorator';
export { CrudControllerBase } from './crud-controller.base';

// nestjsx/crud-compatible surface: these names match @nestjsx/crud exactly
// so consumers migrate with an import swap. NOTE: like nestjsx,
// `ParsedRequest` is the parameter DECORATOR; the request type is
// `CrudRequest`.
export {
  CrudAuth,
  Override,
  ParsedRequest,
  ParsedBody,
  CrudController,
  CrudRequest,
  CreateManyDto,
  BaseRouteName,
  OVERRIDE_METHOD_METADATA,
} from './nestjsx-compat';

// Re-export core types and interfaces
export {
  CrudControllerOptions,
  CrudRoutes,
  RouteOptions,
  BaseCrudController,
  // Service interfaces
  CrudService,
  CrudServiceOptions,
  // Request/Response types (ParsedRequest the TYPE is CrudRequest above;
  // also available as ParsedRequestType)
  ParsedRequest as ParsedRequestType,
  CrudRequestQuery,
  CrudRequestOptions,
  CrudAuthOptions,
  FilterCondition,
  SortCondition,
  JoinCondition,
  FilterOperator,
  SearchCondition,
  GetManyResponse,
  GetManyDefaultResponse,
  isGetManyDefaultResponse,
  GetOneResponse,
  CreateOneResponse,
  CreateManyResponse,
  UpdateOneResponse,
  ReplaceOneResponse,
  DeleteOneResponse,
  RecoverOneResponse,
  DeepPartial,
  // Constants
  CrudValidationGroups,
  CRUD_OPTIONS_METADATA,
  CRUD_CONTROLLER_METADATA,
  PARSED_CRUD_REQUEST_KEY,
} from '@apso/crud-core';

// NestJS interceptor + parsed-request decorators (moved here from
// crud-request, which is now client-safe — #37).
export {
  CrudRequestInterceptor,
  extractParsedRequest,
  CrudRequest as CrudRequestDecorator,
  ParsedCrudRequest,
} from './crud-request.interceptor';

// Re-export the client-safe parser from crud-request.
export {
  CrudRequestParser,
  createRequestParser,
  parseRequest,
} from '@apso/crud-request';

// Re-export TypeORM integration
export { TypeOrmCrudService } from '@apso/crud-typeorm';
