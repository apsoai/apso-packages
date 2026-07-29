import { ApsoClient, QueryParams } from "./apsoClient";

export interface EntityQueryBuilder {
  select(fields: string[]): this;
  where(filter: Record<string, any>): this;
  or(orCondition: Record<string, any>): this;
  join(joinTables: string[]): this;
  orderBy(sort: Record<string, 'ASC' | 'DESC'>): this;
  limit(limit: number): this;
  offset(offset: number): this;
  page(page: number): this;
  cache(useCache?: boolean, duration?: number): this;
}

export class QueryBuilder implements EntityQueryBuilder {
  private params: QueryParams = {};
  private useCache: boolean = false;
  private cacheDuration: number = 60;

  public select(fields: string[]): this {
    this.params.fields = fields;
    return this;
  }

  public where(filter: Record<string, any>): this {
    this.params.filter = { ...this.params.filter, ...filter };
    return this;
  }

  public or(orCondition: Record<string, any>): this {
    this.params.or = orCondition;
    return this;
  }

  public join(joinTables: string[]): this {
    this.params.join = joinTables;
    return this;
  }

  public orderBy(sort: Record<string, 'ASC' | 'DESC'>): this {
    this.params.sort = sort;
    return this;
  }

  public limit(limit: number): this {
    this.params.limit = limit;
    return this;
  }

  public offset(offset: number): this {
    this.params.offset = offset;
    return this;
  }

  public page(page: number): this {
    this.params.page = page;
    return this;
  }

  public cache(useCache: boolean = true, duration: number = 60): this {
    this.useCache = useCache;
    this.cacheDuration = duration;
    return this;
  }

  public build(): { params: QueryParams; useCache: boolean; cacheDuration: number } {
    return {
      params: this.params,
      useCache: this.useCache,
      cacheDuration: this.cacheDuration,
    };
  }
}

export class EntityClient implements EntityQueryBuilder {
  private apsoClient: ApsoClient;
  private entityName: string;
  private queryBuilder: QueryBuilder;

  constructor(apsoClient: ApsoClient, entityName: string) {
    this.apsoClient = apsoClient;
    this.entityName = entityName;
    this.queryBuilder = new QueryBuilder();
  }

  public select(fields: string[]): this {
    this.queryBuilder.select(fields);
    return this;
  }

  public where(filter: Record<string, any>): this {
    this.queryBuilder.where(filter);
    return this;
  }

  public or(orCondition: Record<string, any>): this {
    this.queryBuilder.or(orCondition);
    return this;
  }

  public join(joinTables: string[]): this {
    this.queryBuilder.join(joinTables);
    return this;
  }

  public orderBy(sort: Record<string, 'ASC' | 'DESC'>): this {
    this.queryBuilder.orderBy(sort);
    return this;
  }

  public limit(limit: number): this {
    this.queryBuilder.limit(limit);
    return this;
  }

  public offset(offset: number): this {
    this.queryBuilder.offset(offset);
    return this;
  }

  public page(page: number): this {
    this.queryBuilder.page(page);
    return this;
  }

  public cache(useCache: boolean = true, duration: number = 60): this {
    this.queryBuilder.cache(useCache, duration);
    return this;
  }

  // ============================================================================
  // Semantic CRUD Methods (Recommended API)
  // ============================================================================

  /**
   * Find multiple records with optional filtering, sorting, and pagination.
   * @example
   * const users = await client.entity('users').where({ status: 'active' }).findMany()
   */
  public async findMany<T>(): Promise<T> {
    const { params, useCache, cacheDuration } = this.queryBuilder.build();
    return await this.apsoClient.get<T>(`/${this.entityName}`, params, useCache, cacheDuration);
  }

  /**
   * Find a single record by filter (typically by ID).
   * @example
   * const user = await client.entity('users').where({ id: '123' }).findOne()
   * const user = await client.entity('users').where({ email: 'test@example.com' }).findOne()
   */
  public async findOne<T>(): Promise<T> {
    const { params, useCache, cacheDuration } = this.queryBuilder.build();
    const filter = params.filter;

    // If filtering by ID directly, fetch the single record
    if (filter?.id && Object.keys(filter).length === 1) {
      const id = filter.id;
      const paramsWithoutFilter = { ...params };
      delete paramsWithoutFilter.filter;
      return await this.apsoClient.get<T>(`/${this.entityName}/${id}`, paramsWithoutFilter, useCache, cacheDuration);
    }

    // Otherwise, use filter to get one record
    params.limit = 1;
    const result = await this.apsoClient.get<{ data: T[] }>(`/${this.entityName}`, params, useCache, cacheDuration);
    // Handle both array and paginated response formats
    if (Array.isArray(result)) {
      return (result as unknown as T[])[0] as T;
    }
    return (result as { data: T[] }).data?.[0] as T;
  }

  /**
   * Create a new record.
   * @example
   * const user = await client.entity('users').create({ name: 'John', email: 'john@example.com' })
   */
  public async create<T>(data: Record<string, any>): Promise<T> {
    return await this.apsoClient.post<T>(`/${this.entityName}`, data);
  }

  /**
   * Update an existing record. Requires a filter with 'id'.
   * @example
   * const updated = await client.entity('users').where({ id: '123' }).update({ name: 'Jane' })
   */
  public async update<T>(data: Record<string, any>): Promise<T> {
    const { params } = this.queryBuilder.build();
    const filter = params.filter;

    if (!filter?.id) {
      throw new Error('ID is required for update. Use .where({ id: recordId }) before .update()');
    }

    return await this.apsoClient.put<T>(`/${this.entityName}/${filter.id}`, data);
  }

  /**
   * Delete a record. Requires a filter with 'id'.
   * @example
   * await client.entity('users').where({ id: '123' }).remove()
   */
  public async remove<T>(): Promise<T> {
    const { params } = this.queryBuilder.build();
    const filter = params.filter;

    if (!filter?.id) {
      throw new Error('ID is required for delete. Use .where({ id: recordId }) before .remove()');
    }

    return await this.apsoClient.delete<T>(`/${this.entityName}/${filter.id}`);
  }

  // ============================================================================
  // Legacy HTTP Methods (Backward Compatibility)
  // ============================================================================

  /**
   * @deprecated Use .findMany() instead
   */
  public async get<T>(): Promise<T> {
    return this.findMany<T>();
  }

  /**
   * @deprecated Use .create() instead
   */
  public async post<T>(data: any): Promise<T> {
    return this.create<T>(data);
  }

  /**
   * @deprecated Use .id(recordId).update() instead
   */
  public async put<T>(data: any): Promise<T> {
    return await this.apsoClient.put<T>(`/${this.entityName}`, data);
  }

  /**
   * @deprecated Use .id(recordId).remove() instead
   */
  public async delete<T>(): Promise<T> {
    return await this.apsoClient.delete<T>(`/${this.entityName}`);
  }
}
