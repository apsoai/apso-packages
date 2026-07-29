/**
 * Core controller interfaces for CRUD operations
 *
 * These interfaces define the standard REST API contract that all CRUD controllers
 * must implement, ensuring consistent behavior across the application.
 */

// Express types will be available from @nestjs/common
// import { Request, Response } from 'express';
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

export interface CrudController<T = any> {
  /**
   * GET /resource - Get many entities
   */
  getMany(req: ParsedRequest): Promise<GetManyResponse<T>>;

  /**
   * GET /resource/:id - Get one entity
   */
  getOne(req: ParsedRequest): Promise<GetOneResponse<T>>;

  /**
   * POST /resource - Create one entity
   */
  createOne(req: ParsedRequest, dto: any): Promise<CreateOneResponse<T>>;

  /**
   * POST /resource/bulk - Create multiple entities
   */
  createMany(req: ParsedRequest, dto: any): Promise<CreateManyResponse<T>>;

  /**
   * PATCH /resource/:id - Update one entity (partial)
   */
  updateOne(req: ParsedRequest, dto: any): Promise<UpdateOneResponse<T>>;

  /**
   * PUT /resource/:id - Replace one entity (full)
   */
  replaceOne(req: ParsedRequest, dto: any): Promise<ReplaceOneResponse<T>>;

  /**
   * DELETE /resource/:id - Delete one entity
   */
  deleteOne(req: ParsedRequest): Promise<DeleteOneResponse>;

  /**
   * PATCH /resource/:id/recover - Recover soft-deleted entity
   */
  recoverOne?(req: ParsedRequest): Promise<RecoverOneResponse<T>>;
}

export interface CrudControllerOptions {
  /**
   * Entity model/schema
   */
  model: {
    type: any;
  };

  /**
   * DTO configuration for different operations
   */
  dto?: {
    create?: any;
    update?: any;
    replace?: any;
  };

  /**
   * Query configuration
   */
  query?: {
    /**
     * Fields that can be selected
     */
    allow?: string[];

    /**
     * Fields that cannot be selected
     */
    exclude?: string[];

    /**
     * Persistent filters (always applied)
     */
    persist?: string[];

    /**
     * Default filters
     */
    filter?: any;

    /**
     * Join configuration
     */
    join?: {
      [relation: string]: {
        eager?: boolean;
        allow?: string[];
        exclude?: string[];
        alias?: string;
      };
    };

    /**
     * Sort configuration
     */
    sort?: {
      [field: string]: 'ASC' | 'DESC';
    };

    /**
     * Pagination configuration
     */
    limit?: number;
    maxLimit?: number;
    alwaysPaginate?: boolean;

    /**
     * Caching configuration
     */
    cache?: number | boolean;

    /**
     * Soft delete configuration
     */
    softDelete?: boolean;
  };

  /**
   * Route configuration
   */
  routes?: {
    /**
     * Only enable specific routes
     */
    only?: CrudRoutes[];

    /**
     * Exclude specific routes
     */
    exclude?: CrudRoutes[];

    /**
     * Route customizations
     */
    getManyBase?: RouteOptions;
    getOneBase?: RouteOptions;
    createOneBase?: RouteOptions;
    createManyBase?: RouteOptions;
    updateOneBase?: RouteOptions;
    replaceOneBase?: RouteOptions;
    deleteOneBase?: RouteOptions;
    recoverOneBase?: RouteOptions;
  };

  /**
   * Parameters configuration
   */
  params?: {
    [param: string]: {
      field?: string;
      type?: 'number' | 'string' | 'uuid';
      primary?: boolean;
    };
  };

  /**
   * Validation configuration. `false` disables validation entirely, matching
   * nestjsx/crud (autogen controllers commonly set `validation: false`).
   */
  validation?:
    | false
    | {
        transform?: boolean;
        whitelist?: boolean;
        forbidNonWhitelisted?: boolean;
        validationError?: {
          target?: boolean;
          value?: boolean;
        };
      };
}

export type CrudRoutes =
  | 'getManyBase'
  | 'getOneBase'
  | 'createOneBase'
  | 'createManyBase'
  | 'updateOneBase'
  | 'replaceOneBase'
  | 'deleteOneBase'
  | 'recoverOneBase';

export interface RouteOptions {
  /**
   * Custom decorators for the route
   */
  decorators?: PropertyDecorator[];

  /**
   * Override HTTP method
   */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

  /**
   * Override route path
   */
  path?: string;

  /**
   * Override response interceptors
   */
  interceptors?: any[];

  /**
   * Override guards
   */
  guards?: any[];

  /**
   * Override filters
   */
  filters?: any[];
}

/**
 * HTTP Request context interface
 */
export interface CrudRequest {
  parsed?: ParsedRequest;
  query?: any;
  params?: any;
  body?: any;
}

/**
 * Base abstract controller class that provides default implementations
 */
export abstract class BaseCrudController<T> implements CrudController<T> {
  abstract service: any;

  async getMany(req: ParsedRequest): Promise<GetManyResponse<T>> {
    return this.service.getMany(req);
  }

  async getOne(req: ParsedRequest): Promise<GetOneResponse<T>> {
    return this.service.getOne(req);
  }

  async createOne(req: ParsedRequest, dto: any): Promise<CreateOneResponse<T>> {
    return this.service.createOne(req, dto);
  }

  async createMany(req: ParsedRequest, dto: any): Promise<CreateManyResponse<T>> {
    return this.service.createMany(req, dto);
  }

  async updateOne(req: ParsedRequest, dto: any): Promise<UpdateOneResponse<T>> {
    return this.service.updateOne(req, dto);
  }

  async replaceOne(req: ParsedRequest, dto: any): Promise<ReplaceOneResponse<T>> {
    return this.service.replaceOne(req, dto);
  }

  async deleteOne(req: ParsedRequest): Promise<DeleteOneResponse> {
    return this.service.deleteOne(req);
  }

  async recoverOne?(req: ParsedRequest): Promise<RecoverOneResponse<T>> {
    return this.service.recoverOne?.(req);
  }
}