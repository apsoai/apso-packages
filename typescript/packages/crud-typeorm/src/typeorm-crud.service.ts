/**
 * TypeORM CRUD Service Implementation
 *
 * This service provides a drop-in replacement for TypeOrmCrudService from nestjsx/crud
 * with enhanced features and bug fixes (including the duplicate field selection issue).
 */

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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

    // Joins first: WHERE and ORDER BY may reference join aliases
    const aliases = this.applyJoins(queryBuilder, req);
    this.applySelect(queryBuilder, req);
    this.applyWhere(queryBuilder, req, aliases);
    this.applySort(queryBuilder, req, aliases);

    const paginated = this.decidePagination(req);

    if (!paginated) {
      // Not paginated: bare array, no COUNT round-trip (nestjsx behavior).
      // A requested limit still applies to the bare array.
      if (req.query?.limit !== undefined || this.options.query?.limit) {
        const maxLimit = this.options.query?.maxLimit || 100;
        const actualLimit = Math.min(
          req.parsed.limit || this.options.query?.limit || 20,
          maxLimit
        );
        if (aliases.size > 0) queryBuilder.take(actualLimit);
        else queryBuilder.limit(actualLimit);
      }
      return queryBuilder.getMany();
    }

    this.applyPagination(queryBuilder, req, aliases.size > 0);
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

  /**
   * nestjsx pagination decision: envelope + LIMIT only when the request
   * asked for a page/offset/limit or the service forces pagination.
   */
  protected decidePagination(req: ParsedRequest): boolean {
    const optQuery: any = req.options?.query ?? this.options.query;
    if (optQuery?.alwaysPaginate) return true;
    // nestjsx: only page/offset trigger the envelope; a bare ?limit= does
    // not (it just caps the bare array).
    const q = req.query || {};
    return q.page !== undefined || q.offset !== undefined;
  }

  async getOne(req: ParsedRequest): Promise<GetOneResponse<T>> {
    const queryBuilder = this.repository.createQueryBuilder('entity');

    const aliases = this.applyJoins(queryBuilder, req);
    this.applySelect(queryBuilder, req);
    this.applyWhere(queryBuilder, req, aliases);

    const entity = await queryBuilder.getOne();

    if (!entity) {
      throw new NotFoundException(`${this.entityName()} not found`);
    }

    return entity;
  }

  async createOne(req: ParsedRequest, dto: DeepPartial<T>): Promise<CreateOneResponse<T>> {
    const entity = this.repository.create(this.withAuthPersist(req, dto) as any);
    return await this.repository.save(entity) as unknown as T;
  }

  async createMany(req: ParsedRequest, dto: CreateManyDto<T>): Promise<CreateManyResponse<T>> {
    const bulk = (dto.bulk as any[]).map(item => this.withAuthPersist(req, item));
    const entities = this.repository.create(bulk);
    return await this.repository.save(entities) as T[];
  }

  async updateOne(req: ParsedRequest, dto: DeepPartial<T>): Promise<UpdateOneResponse<T>> {
    const queryBuilder = this.repository.createQueryBuilder('entity');
    this.applyWhere(queryBuilder, req);

    const entity = await queryBuilder.getOne();
    if (!entity) {
      throw new NotFoundException(`${this.entityName()} not found`);
    }

    // nestjsx strips primary keys from the update body: a client echoing a
    // fetched entity back through PATCH (or sending {id: 999}) must never
    // rewrite the row's identity. The target row is always the fetched one.
    const body = this.stripPrimaryKeys(this.withAuthPersist(req, dto));
    return await this.repository.save({ ...entity, ...body } as any);
  }

  async replaceOne(req: ParsedRequest, dto: T): Promise<ReplaceOneResponse<T>> {
    const queryBuilder = this.repository.createQueryBuilder('entity');
    this.applyWhere(queryBuilder, req);

    const entity = await queryBuilder.getOne();
    if (!entity) {
      throw new NotFoundException(`${this.entityName()} not found`);
    }

    // PUT keeps the target row's identity (from the route), never the body's.
    const body = this.stripPrimaryKeys(this.withAuthPersist(req, dto));
    return await this.repository.save(
      { ...body, ...this.primaryKeyValues(entity) } as any
    );
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

  /** Remove primary-key fields from a mutation body (nestjsx behavior). */
  protected stripPrimaryKeys<D>(dto: D): D {
    if (!dto || typeof dto !== 'object') return dto;
    const out: any = { ...(dto as any) };
    for (const pk of this.rootPrimaryKeys()) {
      delete out[pk];
    }
    return out;
  }

  /** The fetched entity's primary-key field/value map. */
  protected primaryKeyValues(entity: T): Record<string, any> {
    const out: Record<string, any> = {};
    for (const pk of this.rootPrimaryKeys()) {
      out[pk] = (entity as any)[pk];
    }
    return out;
  }

  async deleteOne(req: ParsedRequest): Promise<DeleteOneResponse<T>> {
    const queryBuilder = this.repository.createQueryBuilder('entity');
    this.applyWhere(queryBuilder, req);

    const entity = await queryBuilder.getOne();
    if (!entity) {
      throw new NotFoundException(`${this.entityName()} not found`);
    }

    await this.repository.remove(entity);
    // nestjsx returns void by default (returnDeleted is options work, #21)
    return undefined;
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
      const selectFields = this.getSelect(req.parsed, this.options.query);
      queryBuilder.select(selectFields);
    }
  }

  /** Entity display name for error messages (nestjsx uses the class name). */
  protected entityName(): string {
    try {
      return this.repository.metadata.name;
    } catch {
      const t = this.entity as any;
      return (t && t.name) || 'Entity';
    }
  }

  /** Primary key property names of the root entity ('id' fallback). */
  protected rootPrimaryKeys(): string[] {
    try {
      return this.repository.metadata.primaryColumns.map(c => c.propertyName);
    } catch {
      return ['id'];
    }
  }

  /**
   * nestjsx-compatible protected override point: subclasses override
   * getSelect to adjust column selection (platform/server's autogen
   * services override it for the issue-#777 dedup, which the base now
   * does anyway).
   */
  protected getSelect(
    parsed: ParsedRequest['parsed'],
    _options: CrudServiceOptions['query']
  ): string[] {
    // nestjsx always includes the primary key(s), PK first; dedup fixes
    // nestjsx issue #777.
    const uniqueFields = [...new Set([...this.rootPrimaryKeys(), ...(parsed.fields || [])])];
    return uniqueFields.map(field => `entity.${field}`);
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
  protected applyWhere(
    queryBuilder: SelectQueryBuilder<T>,
    req: ParsedRequest,
    aliases?: Map<string, string>
  ): void {
    const { search, paramsFilter } = req.parsed;
    const counter = { n: 0 };

    if (search && Object.keys(search).length > 0) {
      queryBuilder.andWhere(new Brackets(qb => this.buildSearch(qb, search, '$and', counter, aliases)));
      return;
    }

    if (paramsFilter && paramsFilter.length > 0) {
      paramsFilter.forEach(condition => {
        const { clause, params } = this.buildCondition(condition.field, condition.operator, condition.value, counter, aliases);
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
    counter: { n: number },
    aliases?: Map<string, string>
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
        attach(inner => value.forEach((child: any) => this.buildSearch(inner, child, '$and', counter, aliases)));
      } else if (key === '$or') {
        if (!Array.isArray(value)) throw new BadRequestException('$or expects an array');
        attach(inner => value.forEach((child: any) => this.buildSearch(inner, child, '$or', counter, aliases)));
      } else {
        // field condition: primitive => $eq, object => one clause per operator
        attach(inner => {
          if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            for (const [op, opValue] of Object.entries(value as Record<string, any>)) {
              const { clause, params } = this.buildCondition(key, op, opValue, counter, aliases);
              inner.andWhere(clause, params);
            }
          } else {
            const { clause, params } = this.buildCondition(key, '$eq', value, counter, aliases);
            inner.andWhere(clause, params);
          }
        });
      }
    }
  }

  /**
   * Apply JOIN operations, nestjsx-compatible:
   * - A requested join is honored only when options.query.join is undefined
   *   (no restriction configured) or contains the join path. Unlisted joins
   *   are silently skipped, like nestjsx — the allowlist is the access
   *   boundary the tenant-scope layer depends on.
   * - options.query.join entries with eager:true are always applied, even
   *   when not requested.
   * - Nested paths (a.b.c) chain through parent aliases; a nested join whose
   *   parent is not joined is skipped (nestjsx behavior).
   * - join.select always includes the joined entity's primary key.
   * - options.query.join[path].required => INNER JOIN.
   *
   * Returns the alias registry (join path -> SQL alias) used by WHERE and
   * ORDER BY to resolve dotted fields.
   */
  protected applyJoins(queryBuilder: SelectQueryBuilder<T>, req: ParsedRequest): Map<string, string> {
    const aliases = new Map<string, string>();
    // Controller-level @Crud options travel on the request (nestjsx flow);
    // service construction options are the fallback.
    const allowed: Record<string, any> | undefined =
      (req.options?.query as any)?.join ?? this.options.query?.join;

    // Requested joins, plus eager joins from options
    const requested = new Map<string, JoinCondition>();
    (req.parsed.join || []).forEach(j => requested.set(j.field, j));
    if (allowed) {
      for (const [path, cfg] of Object.entries(allowed)) {
        if (cfg && (cfg as any).eager && !requested.has(path)) {
          requested.set(path, { field: path });
        }
      }
    }

    // Shallow paths before deep so parents exist for children
    const ordered = [...requested.values()].sort(
      (a, b) => a.field.split('.').length - b.field.split('.').length
    );

    const usedAliases = new Set<string>(['entity']);

    for (const join of ordered) {
      const path = join.field;
      const cfg = allowed ? allowed[path] : undefined;
      // nestjsx only applies joins configured in options.query.join; with no
      // allowlist at all, NO join is honored. Unknown paths are skipped.
      if (!cfg) continue;

      const segments = path.split('.');
      const relationName = segments[segments.length - 1];
      const parentPath = segments.slice(0, -1).join('.');
      const parentAlias = parentPath ? aliases.get(parentPath) : 'entity';
      if (!parentAlias) continue; // parent not joined: skip, like nestjsx

      // Alias: options alias, else last segment, de-collided with full path
      let alias = (cfg && (cfg as any).alias) || join.alias || relationName;
      if (usedAliases.has(alias)) {
        alias = segments.join('_');
      }
      usedAliases.add(alias);
      aliases.set(path, alias);

      const relation = `${parentAlias}.${relationName}`;
      const required = Boolean(cfg && (cfg as any).required);

      // Effective select: requested ∩ allowed (when configured), + PK
      const allowedSelect: string[] | undefined = cfg && (cfg as any).allow;
      let select = join.select && join.select.length > 0 ? join.select : undefined;
      if (select && allowedSelect && allowedSelect.length > 0) {
        select = select.filter(f => allowedSelect.includes(f));
      } else if (!select && allowedSelect && allowedSelect.length > 0) {
        select = [...allowedSelect];
      }

      if (select && select.length > 0) {
        // Explicit column selection: plain join + selected columns (+ PK)
        if (required) queryBuilder.innerJoin(relation, alias);
        else queryBuilder.leftJoin(relation, alias);

        const pks = this.primaryKeysOf(path);
        const cols = [...new Set([...pks, ...select])].map(f => `${alias}.${f}`);
        queryBuilder.addSelect(cols);
      } else {
        if (required) queryBuilder.innerJoinAndSelect(relation, alias);
        else queryBuilder.leftJoinAndSelect(relation, alias);
      }

      // Join ON extra conditions (ANDed into WHERE, matching prior behavior)
      if (join.on && join.on.length > 0) {
        const counter = { n: 1000 + aliases.size * 100 };
        join.on.forEach(condition => {
          const col = condition.field.includes('.')
            ? condition.field
            : `${alias}.${condition.field}`;
          const { clause, params } = this.buildCondition(col, condition.operator, condition.value, counter);
          queryBuilder.andWhere(clause, params);
        });
      }
    }

    return aliases;
  }

  /**
   * Primary key property names of the entity at the end of a join path.
   * Falls back to ['id'] when metadata is unavailable (e.g. unit tests
   * with mock repositories).
   */
  protected primaryKeysOf(joinPath: string): string[] {
    try {
      let meta = this.repository.metadata;
      for (const segment of joinPath.split('.')) {
        const rel = meta.relations.find(r => r.propertyName === segment);
        if (!rel) return ['id'];
        meta = rel.inverseEntityMetadata;
      }
      return meta.primaryColumns.map(c => c.propertyName);
    } catch {
      return ['id'];
    }
  }

  /**
   * Apply sorting to query builder
   */
  protected applySort(
    queryBuilder: SelectQueryBuilder<T>,
    req: ParsedRequest,
    aliases?: Map<string, string>
  ): void {
    const sort = req.parsed.sort;

    if (sort && sort.length > 0) {
      sort.forEach((sortCondition, index) => {
        const field = this.resolveField(sortCondition.field, aliases);
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
   * Apply pagination to query builder.
   *
   * With joins present, limit/offset paginate JOINED ROWS (a one-to-many
   * join multiplies rows), so pages come back short or misaligned. TypeORM's
   * take/skip paginate distinct root entities in that case — nestjsx does
   * the same. Without joins, limit/offset is the cheaper equivalent.
   */
  protected applyPagination(
    queryBuilder: SelectQueryBuilder<T>,
    req: ParsedRequest,
    hasJoins = false
  ): void {
    const { limit, offset, page } = req.parsed;
    const maxLimit = this.options.query?.maxLimit || 100;

    // Calculate actual limit and offset
    const actualLimit = Math.min(limit || this.options.query?.limit || 20, maxLimit);
    const actualOffset = offset || ((page || 1) - 1) * actualLimit;

    if (hasJoins) {
      queryBuilder.take(actualLimit);
      queryBuilder.skip(actualOffset);
    } else {
      queryBuilder.limit(actualLimit);
      queryBuilder.offset(actualOffset);
    }
  }

  /**
   * Resolve a search/sort field to a SQL identifier.
   * - plain 'col' -> entity.col
   * - 'a.b.col' where 'a.b' is a joined path -> '<aliasOf(a.b)>.col'
   * - '<alias>.col' where alias was already resolved -> unchanged
   */
  protected resolveField(field: string, aliases?: Map<string, string>): string {
    if (!field.includes('.')) {
      return `entity.${field}`;
    }
    const idx = field.lastIndexOf('.');
    const prefix = field.slice(0, idx);
    const col = field.slice(idx + 1);
    if (aliases?.has(prefix)) {
      return `${aliases.get(prefix)}.${col}`;
    }
    // Already alias-qualified (entity.x, or a registered alias value)
    return field;
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
    counter: { n: number },
    aliases?: Map<string, string>
  ): { clause: string; params: Record<string, any> } {
    const col = this.resolveField(field, aliases);
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
        // nestjsx runtime behavior: unknown operators inside a search tree
        // fall through to equality on the value (query-string operators are
        // validated with a 400 at PARSE time; s= trees are not).
        return { clause: `${col} = ${p}`, params: { [key]: value } };
    }
  }
}