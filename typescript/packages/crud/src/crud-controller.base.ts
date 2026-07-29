/**
 * Base CRUD Controller
 *
 * This abstract base class provides default implementations for all CRUD operations
 * and integrates with the request parsing system.
 */

import { Injectable, Req } from '@nestjs/common';
import {
  CrudController as ICrudController,
  ParsedRequest,
  GetManyResponse,
  GetOneResponse,
  CreateOneResponse,
  CreateManyResponse,
  UpdateOneResponse,
  ReplaceOneResponse,
  DeleteOneResponse,
  RecoverOneResponse,
  CrudService
} from '@apso/crud-core';
import { extractParsedRequest } from '@apso/crud-request';

@Injectable()
export abstract class CrudControllerBase<T> implements ICrudController<T> {
  /**
   * The CRUD service that handles data operations
   * Must be implemented by subclasses
   */
  abstract service: CrudService<T>;

  /**
   * GET / - Get many entities
   */
  async getMany(@Req() req: any): Promise<GetManyResponse<T>> {
    const parsedRequest = extractParsedRequest(req);
    return this.service.getMany(parsedRequest);
  }

  /**
   * GET /:id - Get one entity
   */
  async getOne(@Req() req: any): Promise<GetOneResponse<T>> {
    const parsedRequest = extractParsedRequest(req);
    return this.service.getOne(parsedRequest);
  }

  /**
   * POST / - Create one entity
   */
  async createOne(@Req() req: any, dto: any): Promise<CreateOneResponse<T>> {
    const parsedRequest = extractParsedRequest(req);
    return this.service.createOne(parsedRequest, dto);
  }

  /**
   * POST /bulk - Create multiple entities
   */
  async createMany(@Req() req: any, dto: any): Promise<CreateManyResponse<T>> {
    const parsedRequest = extractParsedRequest(req);
    return this.service.createMany(parsedRequest, dto);
  }

  /**
   * PATCH /:id - Update one entity (partial)
   */
  async updateOne(@Req() req: any, dto: any): Promise<UpdateOneResponse<T>> {
    const parsedRequest = extractParsedRequest(req);
    return this.service.updateOne(parsedRequest, dto);
  }

  /**
   * PUT /:id - Replace one entity (full)
   */
  async replaceOne(@Req() req: any, dto: any): Promise<ReplaceOneResponse<T>> {
    const parsedRequest = extractParsedRequest(req);
    return this.service.replaceOne(parsedRequest, dto);
  }

  /**
   * DELETE /:id - Delete one entity
   */
  async deleteOne(@Req() req: any): Promise<DeleteOneResponse> {
    const parsedRequest = extractParsedRequest(req);
    return this.service.deleteOne(parsedRequest);
  }

  /**
   * PATCH /:id/recover - Recover soft-deleted entity
   */
  async recoverOne(@Req() req: any): Promise<RecoverOneResponse<T>> {
    const parsedRequest = extractParsedRequest(req);
    if (!this.service.recoverOne) {
      throw new Error('Recover operation not supported by this service');
    }
    return this.service.recoverOne(parsedRequest);
  }
}

/**
 * Enhanced CRUD Controller with method overrides
 *
 * This class allows for easy method overriding while maintaining the base functionality.
 * Methods can be overridden in subclasses to add custom logic before/after CRUD operations.
 */
export abstract class CrudController<T> extends CrudControllerBase<T> {
  /**
   * Override this method to add custom logic before getting many entities
   */
  protected beforeGetMany?(req: ParsedRequest): Promise<void> | void;

  /**
   * Override this method to add custom logic after getting many entities
   */
  protected afterGetMany?(req: ParsedRequest, result: GetManyResponse<T>): Promise<GetManyResponse<T>> | GetManyResponse<T>;

  /**
   * Enhanced getMany with hooks
   */
  async getMany(@Req() req: any): Promise<GetManyResponse<T>> {
    const parsedRequest = extractParsedRequest(req);

    if (this.beforeGetMany) {
      await this.beforeGetMany(parsedRequest);
    }

    let result = await this.service.getMany(parsedRequest);

    if (this.afterGetMany) {
      result = await this.afterGetMany(parsedRequest, result);
    }

    return result;
  }

  /**
   * Override this method to add custom logic before getting one entity
   */
  protected beforeGetOne?(req: ParsedRequest): Promise<void> | void;

  /**
   * Override this method to add custom logic after getting one entity
   */
  protected afterGetOne?(req: ParsedRequest, result: GetOneResponse<T>): Promise<GetOneResponse<T>> | GetOneResponse<T>;

  /**
   * Enhanced getOne with hooks
   */
  async getOne(@Req() req: any): Promise<GetOneResponse<T>> {
    const parsedRequest = extractParsedRequest(req);

    if (this.beforeGetOne) {
      await this.beforeGetOne(parsedRequest);
    }

    let result = await this.service.getOne(parsedRequest);

    if (this.afterGetOne) {
      result = await this.afterGetOne(parsedRequest, result);
    }

    return result;
  }

  /**
   * Override this method to add custom logic before creating an entity
   */
  protected beforeCreateOne?(req: ParsedRequest, dto: any): Promise<any> | any;

  /**
   * Override this method to add custom logic after creating an entity
   */
  protected afterCreateOne?(req: ParsedRequest, result: CreateOneResponse<T>): Promise<CreateOneResponse<T>> | CreateOneResponse<T>;

  /**
   * Enhanced createOne with hooks
   */
  async createOne(@Req() req: any, dto: any): Promise<CreateOneResponse<T>> {
    const parsedRequest = extractParsedRequest(req);

    if (this.beforeCreateOne) {
      dto = await this.beforeCreateOne(parsedRequest, dto);
    }

    let result = await this.service.createOne(parsedRequest, dto);

    if (this.afterCreateOne) {
      result = await this.afterCreateOne(parsedRequest, result);
    }

    return result;
  }

  /**
   * Override this method to add custom logic before updating an entity
   */
  protected beforeUpdateOne?(req: ParsedRequest, dto: any): Promise<any> | any;

  /**
   * Override this method to add custom logic after updating an entity
   */
  protected afterUpdateOne?(req: ParsedRequest, result: UpdateOneResponse<T>): Promise<UpdateOneResponse<T>> | UpdateOneResponse<T>;

  /**
   * Enhanced updateOne with hooks
   */
  async updateOne(@Req() req: any, dto: any): Promise<UpdateOneResponse<T>> {
    const parsedRequest = extractParsedRequest(req);

    if (this.beforeUpdateOne) {
      dto = await this.beforeUpdateOne(parsedRequest, dto);
    }

    let result = await this.service.updateOne(parsedRequest, dto);

    if (this.afterUpdateOne) {
      result = await this.afterUpdateOne(parsedRequest, result);
    }

    return result;
  }

  /**
   * Override this method to add custom logic before deleting an entity
   */
  protected beforeDeleteOne?(req: ParsedRequest): Promise<void> | void;

  /**
   * Override this method to add custom logic after deleting an entity
   */
  protected afterDeleteOne?(req: ParsedRequest, result: DeleteOneResponse): Promise<DeleteOneResponse> | DeleteOneResponse;

  /**
   * Enhanced deleteOne with hooks
   */
  async deleteOne(@Req() req: any): Promise<DeleteOneResponse> {
    const parsedRequest = extractParsedRequest(req);

    if (this.beforeDeleteOne) {
      await this.beforeDeleteOne(parsedRequest);
    }

    let result = await this.service.deleteOne(parsedRequest);

    if (this.afterDeleteOne) {
      result = await this.afterDeleteOne(parsedRequest, result);
    }

    return result;
  }
}