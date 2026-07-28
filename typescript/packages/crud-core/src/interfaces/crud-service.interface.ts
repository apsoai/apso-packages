/**
 * Core service interfaces for CRUD operations
 *
 * These interfaces define the contract that all CRUD services must implement,
 * providing a consistent API across different ORM integrations.
 */

import { ParsedRequest } from './crud-request.interface';
import {
  GetManyResponse,
  GetOneResponse,
  CreateOneResponse,
  CreateManyResponse,
  UpdateOneResponse,
  ReplaceOneResponse,
  DeleteOneResponse,
  RecoverOneResponse
} from './crud-response.interface';

export interface CrudService<T = any> {
  /**
   * Get many entities with filtering, sorting, pagination
   */
  getMany(req: ParsedRequest): Promise<GetManyResponse<T>>;

  /**
   * Get one entity by ID or conditions
   */
  getOne(req: ParsedRequest): Promise<GetOneResponse<T>>;

  /**
   * Create a single entity
   */
  createOne(req: ParsedRequest, dto: DeepPartial<T>): Promise<CreateOneResponse<T>>;

  /**
   * Create multiple entities
   */
  createMany(req: ParsedRequest, dto: CreateManyDto<T>): Promise<CreateManyResponse<T>>;

  /**
   * Update one entity (partial update)
   */
  updateOne(req: ParsedRequest, dto: DeepPartial<T>): Promise<UpdateOneResponse<T>>;

  /**
   * Replace one entity (full replacement)
   */
  replaceOne(req: ParsedRequest, dto: T): Promise<ReplaceOneResponse<T>>;

  /**
   * Delete one entity
   */
  deleteOne(req: ParsedRequest): Promise<DeleteOneResponse>;

  /**
   * Recover one soft-deleted entity (if supported)
   */
  recoverOne?(req: ParsedRequest): Promise<RecoverOneResponse<T>>;
}

export interface CreateManyDto<T = any> {
  bulk: DeepPartial<T>[];
}

export interface CrudServiceOptions {
  /**
   * Entity class/constructor
   */
  entity: EntityClassOrSchema;

  /**
   * Repository or data access layer
   */
  repository?: any;

  /**
   * Default query options
   */
  query?: {
    alwaysPaginate?: boolean;
    limit?: number;
    maxLimit?: number;
    cache?: number;
  };

  /**
   * Soft delete configuration
   */
  softDelete?: {
    field?: string;
    recoverField?: string;
  };

  /**
   * Validation options
   */
  validation?: {
    transform?: boolean;
    whitelist?: boolean;
    forbidNonWhitelisted?: boolean;
  };
}

export type EntityClassOrSchema = Function | string;

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T[P] extends ReadonlyArray<infer U>
    ? ReadonlyArray<DeepPartial<U>>
    : DeepPartial<T[P]>;
};

/**
 * Advanced service interface with additional capabilities
 */
export interface AdvancedCrudService<T = any> extends CrudService<T> {
  /**
   * Get entity count with filters
   */
  count(req: ParsedRequest): Promise<number>;

  /**
   * Check if entity exists
   */
  exists(req: ParsedRequest): Promise<boolean>;

  /**
   * Bulk operations
   */
  bulkCreate(entities: DeepPartial<T>[]): Promise<T[]>;
  bulkUpdate(conditions: any, update: DeepPartial<T>): Promise<number>;
  bulkDelete(conditions: any): Promise<number>;

  /**
   * Transaction support
   */
  transaction<R>(work: (service: CrudService<T>) => Promise<R>): Promise<R>;

  /**
   * Custom query execution
   */
  query(sql: string, parameters?: any[]): Promise<any>;
}