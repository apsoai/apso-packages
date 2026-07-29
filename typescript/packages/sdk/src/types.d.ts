export interface RetryConfig {
  attempts?: number;
  delay?: number;
  statusCodes?: number[];
}

export interface ApsoClientConfig {
  baseURL: string;
  apiKey: string;
  client?: 'axios' | 'fetch';
  timeout?: number;
  retry?: RetryConfig | boolean;
  headers?: Record<string, string>;
  otherOptions?: Record<string, any>;
  debug?: boolean;
}

export interface QueryParams {
  fields?: string[];
  filter?: Record<string, any>;
  or?: Record<string, any>;
  join?: string[];
  sort?: Record<string, 'ASC' | 'DESC'>;
  limit?: number;
  offset?: number;
  page?: number;
  cache?: boolean;
}

export interface CacheEntry<T> {
  data: T;
  expiry: number;
}

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
