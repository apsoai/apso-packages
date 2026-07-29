/**
 * TypeORM CRUD Service Implementation
 *
 * This service provides a drop-in replacement for TypeOrmCrudService from nestjsx/crud
 * with enhanced features and bug fixes (including the duplicate field selection issue).
 */

import { BadRequestException, Injectable } from '@nestjs/common';
import { Brackets, Repository, SelectQueryBuilder, EntityTarget, ObjectLiteral, WhereExpressionBuilder } from 'typeorm';
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
    const entity = this.repository.create(this.withAuthPersist(req, dto) as any);
    const saved = await this.repository.save(entity) as unknown as T;
    return { data: saved };
  }

  async createMany(req: ParsedRequest, dto: CreateManyDto<T>): Promise<CreateManyResponse<T>> {
    const bulk = (dto.bulk as any[]).map(item => this.withAuthPersist(req, item));
    const entities = this.repository.create(bulk);
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

    const updated = await this.repository.save(
      { ...entity, ...this.withAuthPersist(req, dto) } as any
    );
    return { data: updated };
  }

  async replaceOne(req: ParsedRequest, dto: T): Promise<ReplaceOneResponse<T>> {
    const queryBuilder = this.repository.createQueryBuilder('entity');
    this.applyWhere(queryBuilder, req);

    const entity = await queryBuilder.getOne();
    if (!entity) {
      throw new Error('Entity not found');
    }

    const replaced = await this.repository.save(this.withAuthPersist(req, dto) as any);
    return { data: replaced };
  }

  /**
   * Merge crud auth.persist fields into a mutation DTO. Persist wins over
   * client-supplied values (nestjsx semantics): the auth layer pins fields
   * like workspaceId regardless of what the request body claims.
   */
  protected withAuthPersist<D>(req: ParsedRequest, dto: D): D {
    const persist = req.parsed.authPersist;
    if (!persist || typeof persist !== 'object') return dto;
    return { ...dto, ...persist };
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
   * Apply WHERE conditions to query builder.
   *
   * The parser merges paramsFilter, options filter, query filter/or/s, and
   * the crud auth filter into ONE search tree (parsed.search), exactly like
   * nestjsx/crud. WHERE is built solely from that tree, so an auth filter
   * ANDed at the top can never be widened by user-supplied conditions.
   *
   * Fallback: a hand-constructed ParsedRequest with an empty search still
   * gets paramsFilter applied, so getOne/update/delete always target by id.
   */
  protected applyWhere(queryBuilder: SelectQueryBuilder<T>, req: ParsedRequest): void {
    const { search, paramsFilter } = req.parsed;
    const counter = { n: 0 };

    if (search && Object.keys(search).length > 0) {
      queryBuilder.andWhere(new Brackets(qb => this.buildSearch(qb, search, '$and', counter)));
      return;
    }

    if (paramsFilter && paramsFilter.length > 0) {
      paramsFilter.forEach(condition => {
        const { clause, params } = this.buildCondition(condition.field, condition.operator, condition.value, counter);
        queryBuilder.andWhere(clause, params);
      });
    }
  }

  /**
   * Recursively build WHERE from a nestjsx-shaped search tree:
   *   { $and: [...] } | { $or: [...] } |
   *   { field: primitive } | { field: { $op: value, ... } }
   * Multiple keys on one node are ANDed (nestjsx semantics).
   */
  protected buildSearch(
    qb: WhereExpressionBuilder,
    node: any,
    mode: '$and' | '$or',
    counter: { n: number }
  ): void {
    const attach = (fragment: (inner: WhereExpressionBuilder) => void) => {
      const bracket = new Brackets(inner => fragment(inner));
      if (mode === '$or') qb.orWhere(bracket);
      else qb.andWhere(bracket);
    };

    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      throw new BadRequestException('Invalid search condition');
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === '$and') {
        if (!Array.isArray(value)) throw new BadRequestException('$and expects an array');
        attach(inner => value.forEach((child: any) => this.buildSearch(inner, child, '$and', counter)));
      } else if (key === '$or') {
        if (!Array.isArray(value)) throw new BadRequestException('$or expects an array');
        attach(inner => value.forEach((child: any) => this.buildSearch(inner, child, '$or', counter)));
      } else {
        // field condition: primitive => $eq, object => one clause per operator
        attach(inner => {
          if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            for (const [op, opValue] of Object.entries(value as Record<string, any>)) {
              const { clause, params } = this.buildCondition(key, op, opValue, counter);
              inner.andWhere(clause, params);
            }
          } else {
            const { clause, params } = this.buildCondition(key, '$eq', value, counter);
            inner.andWhere(clause, params);
          }
        });
      }
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
          const counter = { n: 1000 }; // distinct param space from applyWhere
          join.on.forEach(condition => {
            const { clause, params } = this.buildCondition(
              `${alias}.${condition.field.replace(`${alias}.`, '')}`,
              condition.operator,
              condition.value,
              counter
            );
            queryBuilder.andWhere(clause, params);
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
   * Resolve a search field to a SQL identifier. Plain fields address the
   * root alias; single-dot fields address a join alias when that join was
   * applied (deeper nesting is join-parity work, #18).
   */
  protected resolveField(field: string): string {
    if (!field.includes('.')) {
      return `entity.${field}`;
    }
    return field; // '<joinAlias>.<column>' — aliases are registered by applyJoins
  }

  /**
   * Build one SQL condition with correctly bound parameters.
   * LIKE wildcard wrapping happens here (not in the parser), so `filter=`
   * and `s=` behave identically for the same operator.
   */
  protected buildCondition(
    field: string,
    operator: string,
    value: any,
    counter: { n: number }
  ): { clause: string; params: Record<string, any> } {
    const col = this.resolveField(field);
    const key = `p${counter.n++}`;
    const p = `:${key}`;

    const requireArray = () => {
      if (!Array.isArray(value) || value.length === 0) {
        throw new BadRequestException(`${operator} expects a non-empty array`);
      }
    };

    switch (operator) {
      case '$eq':      return { clause: `${col} = ${p}`,  params: { [key]: value } };
      case '$ne':      return { clause: `${col} != ${p}`, params: { [key]: value } };
      case '$gt':      return { clause: `${col} > ${p}`,  params: { [key]: value } };
      case '$gte':     return { clause: `${col} >= ${p}`, params: { [key]: value } };
      case '$lt':      return { clause: `${col} < ${p}`,  params: { [key]: value } };
      case '$lte':     return { clause: `${col} <= ${p}`, params: { [key]: value } };
      case '$starts':  return { clause: `${col} LIKE ${p}`,     params: { [key]: `${value}%` } };
      case '$ends':    return { clause: `${col} LIKE ${p}`,     params: { [key]: `%${value}` } };
      case '$cont':    return { clause: `${col} LIKE ${p}`,     params: { [key]: `%${value}%` } };
      case '$excl':    return { clause: `${col} NOT LIKE ${p}`, params: { [key]: `%${value}%` } };
      case '$in':
        requireArray();
        return { clause: `${col} IN (:...${key})`, params: { [key]: value } };
      case '$notin':
        requireArray();
        return { clause: `${col} NOT IN (:...${key})`, params: { [key]: value } };
      case '$isnull':  return { clause: `${col} IS NULL`, params: {} };
      case '$notnull': return { clause: `${col} IS NOT NULL`, params: {} };
      case '$between': {
        requireArray();
        if (value.length !== 2) {
          throw new BadRequestException('$between expects exactly two values');
        }
        const key2 = `p${counter.n++}`;
        return {
          clause: `${col} BETWEEN ${p} AND :${key2}`,
          params: { [key]: value[0], [key2]: value[1] }
        };
      }
      case '$eqL':     return { clause: `LOWER(${col}) = ${p}`,  params: { [key]: String(value).toLowerCase() } };
      case '$neL':     return { clause: `LOWER(${col}) != ${p}`, params: { [key]: String(value).toLowerCase() } };
      case '$startsL': return { clause: `LOWER(${col}) LIKE ${p}`,     params: { [key]: `${String(value).toLowerCase()}%` } };
      case '$endsL':   return { clause: `LOWER(${col}) LIKE ${p}`,     params: { [key]: `%${String(value).toLowerCase()}` } };
      case '$contL':   return { clause: `LOWER(${col}) LIKE ${p}`,     params: { [key]: `%${String(value).toLowerCase()}%` } };
      case '$exclL':   return { clause: `LOWER(${col}) NOT LIKE ${p}`, params: { [key]: `%${String(value).toLowerCase()}%` } };
      case '$inL':
        requireArray();
        return {
          clause: `LOWER(${col}) IN (:...${key})`,
          params: { [key]: value.map((v: any) => String(v).toLowerCase()) }
        };
      case '$notinL':
        requireArray();
        return {
          clause: `LOWER(${col}) NOT IN (:...${key})`,
          params: { [key]: value.map((v: any) => String(v).toLowerCase()) }
        };
      default:
        throw new BadRequestException(`Unknown filter operator: ${operator}`);
    }
  }
}