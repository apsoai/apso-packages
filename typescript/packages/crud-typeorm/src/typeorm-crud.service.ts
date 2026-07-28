/**
 * TypeORM CRUD Service Implementation
 *
 * This service provides a drop-in replacement for TypeOrmCrudService from nestjsx/crud
 * with enhanced features and bug fixes (including the duplicate field selection issue).
 */

import { Injectable } from '@nestjs/common';
import { Repository, SelectQueryBuilder, EntityTarget, ObjectLiteral } from 'typeorm';
import {
  CrudService,
  ParsedRequest,
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
  CrudServiceOptions,
  FilterCondition,
  SortCondition,
  JoinCondition
} from '@apso/crud-core';

@Injectable()
export class TypeOrmCrudService<T extends ObjectLiteral> implements CrudService<T> {
  protected repository: Repository<T>;
  protected entity: EntityTarget<T>;
  protected options: CrudServiceOptions;

  constructor(repository: Repository<T>, options?: Partial<CrudServiceOptions>) {
    this.repository = repository;
    this.entity = repository.target as EntityTarget<T>;
    this.options = {
      entity: this.entity as any,
      query: {
        alwaysPaginate: false,
        limit: 20,
        maxLimit: 100,
        cache: 0,
      },
      validation: {
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      },
      ...options,
    };
  }

  async getMany(req: ParsedRequest): Promise<GetManyResponse<T>> {
    const queryBuilder = this.repository.createQueryBuilder('entity');

    // Apply all query modifications
    this.applySelect(queryBuilder, req);
    this.applyWhere(queryBuilder, req);
    this.applyJoins(queryBuilder, req);
    this.applySort(queryBuilder, req);
    this.applyPagination(queryBuilder, req);

    // Execute queries
    const [data, total] = await queryBuilder.getManyAndCount();

    const limit = req.parsed.limit || this.options.query?.limit || 20;
    const page = req.parsed.page || 1;
    const pageCount = Math.ceil(total / limit);

    return {
      data,
      count: data.length,
      total,
      page,
      pageCount,
    };
  }

  async getOne(req: ParsedRequest): Promise<GetOneResponse<T>> {
    const queryBuilder = this.repository.createQueryBuilder('entity');

    this.applySelect(queryBuilder, req);
    this.applyWhere(queryBuilder, req);
    this.applyJoins(queryBuilder, req);

    const entity = await queryBuilder.getOne();

    if (!entity) {
      throw new Error('Entity not found');
    }

    return { data: entity };
  }

  async createOne(req: ParsedRequest, dto: DeepPartial<T>): Promise<CreateOneResponse<T>> {
    const entity = this.repository.create(dto as any);
    const saved = await this.repository.save(entity) as unknown as T;
    return { data: saved };
  }

  async createMany(req: ParsedRequest, dto: CreateManyDto<T>): Promise<CreateManyResponse<T>> {
    const entities = this.repository.create(dto.bulk as any[]);
    const saved = await this.repository.save(entities) as T[];
    return { data: saved };
  }

  async updateOne(req: ParsedRequest, dto: DeepPartial<T>): Promise<UpdateOneResponse<T>> {
    const queryBuilder = this.repository.createQueryBuilder('entity');
    this.applyWhere(queryBuilder, req);

    const entity = await queryBuilder.getOne();
    if (!entity) {
      throw new Error('Entity not found');
    }

    const updated = await this.repository.save({ ...entity, ...dto } as any);
    return { data: updated };
  }

  async replaceOne(req: ParsedRequest, dto: T): Promise<ReplaceOneResponse<T>> {
    const queryBuilder = this.repository.createQueryBuilder('entity');
    this.applyWhere(queryBuilder, req);

    const entity = await queryBuilder.getOne();
    if (!entity) {
      throw new Error('Entity not found');
    }

    const replaced = await this.repository.save(dto as any);
    return { data: replaced };
  }

  async deleteOne(req: ParsedRequest): Promise<DeleteOneResponse> {
    const queryBuilder = this.repository.createQueryBuilder('entity');
    this.applyWhere(queryBuilder, req);

    const entity = await queryBuilder.getOne();
    if (!entity) {
      throw new Error('Entity not found');
    }

    await this.repository.remove(entity);
    return {};
  }

  async recoverOne(req: ParsedRequest): Promise<RecoverOneResponse<T>> {
    // Implementation for soft delete recovery
    throw new Error('Recover operation not implemented');
  }

  /**
   * Apply field selection to query builder
   * Fixes the duplicate field selection bug from nestjsx/crud issue #777
   */
  protected applySelect(queryBuilder: SelectQueryBuilder<T>, req: ParsedRequest): void {
    const fields = req.parsed.fields;

    if (fields && fields.length > 0) {
      // Remove duplicates to fix issue #777
      const uniqueFields = [...new Set(fields)];
      const selectFields = uniqueFields.map(field => `entity.${field}`);
      queryBuilder.select(selectFields);
    }
  }

  /**
   * Apply WHERE conditions to query builder
   */
  protected applyWhere(queryBuilder: SelectQueryBuilder<T>, req: ParsedRequest): void {
    const { filter, search, or } = req.parsed;

    // Apply regular filters
    if (filter && filter.length > 0) {
      filter.forEach((condition, index) => {
        this.addWhereCondition(queryBuilder, condition, `filter_${index}`);
      });
    }

    // Apply OR filters
    if (or && or.length > 0) {
      const orConditions = or.map((condition, index) => {
        return this.buildWhereCondition(condition, `or_${index}`);
      });

      if (orConditions.length > 0) {
        queryBuilder.andWhere(`(${orConditions.join(' OR ')})`,
          or.reduce((params, condition, index) => ({
            ...params,
            [`or_${index}`]: condition.value
          }), {})
        );
      }
    }

    // Apply search conditions
    if (search && Object.keys(search).length > 0) {
      this.applySearchConditions(queryBuilder, search);
    }
  }

  /**
   * Apply JOIN operations to query builder
   */
  protected applyJoins(queryBuilder: SelectQueryBuilder<T>, req: ParsedRequest): void {
    const joins = req.parsed.join;

    if (joins && joins.length > 0) {
      joins.forEach((join) => {
        const relation = `entity.${join.field}`;
        const alias = join.alias || join.field;

        if (join.select && join.select.length > 0) {
          const selectFields = join.select.map(field => `${alias}.${field}`);
          queryBuilder.leftJoinAndSelect(relation, alias);
          queryBuilder.addSelect(selectFields);
        } else {
          queryBuilder.leftJoinAndSelect(relation, alias);
        }

        // Apply join conditions
        if (join.on && join.on.length > 0) {
          join.on.forEach((condition, index) => {
            this.addWhereCondition(queryBuilder, condition, `join_${join.field}_${index}`);
          });
        }
      });
    }
  }

  /**
   * Apply sorting to query builder
   */
  protected applySort(queryBuilder: SelectQueryBuilder<T>, req: ParsedRequest): void {
    const sort = req.parsed.sort;

    if (sort && sort.length > 0) {
      sort.forEach((sortCondition, index) => {
        const field = `entity.${sortCondition.field}`;
        const order = sortCondition.order;

        if (index === 0) {
          queryBuilder.orderBy(field, order);
        } else {
          queryBuilder.addOrderBy(field, order);
        }
      });
    }
  }

  /**
   * Apply pagination to query builder
   */
  protected applyPagination(queryBuilder: SelectQueryBuilder<T>, req: ParsedRequest): void {
    const { limit, offset, page } = req.parsed;
    const maxLimit = this.options.query?.maxLimit || 100;

    // Calculate actual limit and offset
    const actualLimit = Math.min(limit || this.options.query?.limit || 20, maxLimit);
    const actualOffset = offset || ((page || 1) - 1) * actualLimit;

    queryBuilder.limit(actualLimit);
    queryBuilder.offset(actualOffset);
  }

  /**
   * Add a WHERE condition to the query builder
   */
  protected addWhereCondition(
    queryBuilder: SelectQueryBuilder<T>,
    condition: FilterCondition,
    paramKey: string
  ): void {
    const whereClause = this.buildWhereCondition(condition, paramKey);
    const parameters = { [paramKey]: condition.value };

    queryBuilder.andWhere(whereClause, parameters);
  }

  /**
   * Build a WHERE condition string based on the filter operator
   */
  protected buildWhereCondition(condition: FilterCondition, paramKey: string): string {
    const field = `entity.${condition.field}`;
    const param = `:${paramKey}`;

    switch (condition.operator) {
      case '$eq':
        return `${field} = ${param}`;
      case '$ne':
        return `${field} != ${param}`;
      case '$gt':
        return `${field} > ${param}`;
      case '$gte':
        return `${field} >= ${param}`;
      case '$lt':
        return `${field} < ${param}`;
      case '$lte':
        return `${field} <= ${param}`;
      case '$starts':
        return `${field} LIKE ${param}`;
      case '$ends':
        return `${field} LIKE ${param}`;
      case '$cont':
        return `${field} LIKE ${param}`;
      case '$excl':
        return `${field} NOT LIKE ${param}`;
      case '$in':
        return `${field} IN (${param})`;
      case '$notin':
        return `${field} NOT IN (${param})`;
      case '$isnull':
        return `${field} IS NULL`;
      case '$notnull':
        return `${field} IS NOT NULL`;
      case '$between':
        return `${field} BETWEEN ${param}[0] AND ${param}[1]`;
      case '$eqL':
        return `LOWER(${field}) = LOWER(${param})`;
      case '$neL':
        return `LOWER(${field}) != LOWER(${param})`;
      case '$startsL':
        return `LOWER(${field}) LIKE LOWER(${param})`;
      case '$endsL':
        return `LOWER(${field}) LIKE LOWER(${param})`;
      case '$contL':
        return `LOWER(${field}) LIKE LOWER(${param})`;
      case '$exclL':
        return `LOWER(${field}) NOT LIKE LOWER(${param})`;
      case '$inL':
        return `LOWER(${field}) IN (${param})`;
      case '$notinL':
        return `LOWER(${field}) NOT IN (${param})`;
      default:
        return `${field} = ${param}`;
    }
  }

  /**
   * Apply search conditions (complex nested conditions)
   */
  protected applySearchConditions(queryBuilder: SelectQueryBuilder<T>, search: any): void {
    // Implementation for complex search conditions would go here
    // This is a simplified version
    console.warn('Complex search conditions not yet implemented');
  }
}