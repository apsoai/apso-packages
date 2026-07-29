/**
 * @apso/crud-request
 *
 * Client-safe request parsing for the Apso CRUD framework: converts
 * nestjsx/crud query-parameter formats into structured objects. No
 * @nestjs / server / ORM dependency — safe to bundle in a browser/SDK.
 * The NestJS interceptor lives in @apso/crud.
 */

export * from './request-parser';

// Client-safe query BUILDER (inverse of the parser): builds the nestjsx
// query-string format the parser consumes. First-party replacement for
// @dataui/crud-request's RequestQueryBuilder, consumed by @apso/sdk (#38).
export {
  RequestQueryBuilder,
  createQueryBuilder,
  CondOperator,
} from './query-builder';
export type { QueryFilter, QueryJoin, QuerySort } from './query-builder';

// Type-only re-exports so consumers importing these from
// @nestjsx/crud-request keep working after the import swap (client-safe:
// types only, sourced from the agnostic core).
export type {
  ParsedRequestParams,
  SCondition,
  ParsedRequest,
  SearchCondition,
  FilterCondition,
  CrudRequestOptions,
} from '@apso/crud-core';
