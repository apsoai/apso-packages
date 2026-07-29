import axios, { AxiosInstance } from 'axios';
import { EntityClient, QueryBuilder } from './EntityClient';
import { RequestQueryBuilder, CondOperator } from '@apso/crud-request';

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  attempts: 3,
  delay: 1000,
  statusCodes: [408, 429, 500, 502, 503, 504],
};

// ============================================================================
// ApsoClient
// ============================================================================

class ApsoClient {
  private baseURL: string;
  private apiKey: string;
  private httpClient: 'axios' | 'fetch';
  private timeout: number;
  private retryConfig: RetryConfig | null;
  private customHeaders: Record<string, string>;
  private axiosInstance?: AxiosInstance;
  private cache: Map<string, CacheEntry<any>> = new Map();
  private debug: boolean;

  constructor(config: ApsoClientConfig) {
    this.baseURL = config.baseURL;
    this.apiKey = config.apiKey;
    this.httpClient = config.client || 'fetch';
    this.timeout = config.timeout || DEFAULT_TIMEOUT;
    this.customHeaders = config.headers || {};
    this.debug = !!config.debug;

    // Configure retry
    if (config.retry === true) {
      this.retryConfig = DEFAULT_RETRY_CONFIG;
    } else if (config.retry === false || config.retry === undefined) {
      this.retryConfig = null;
    } else {
      this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config.retry };
    }
  }

  private async getAxiosInstance(): Promise<AxiosInstance> {
    if (!this.axiosInstance) {
      this.axiosInstance = axios.create({
        baseURL: this.baseURL,
        timeout: this.timeout,
        headers: {
          'x-api-key': this.apiKey,
          ...this.customHeaders,
        },
      });
    }
    return this.axiosInstance;
  }

  private getHeaders(): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      'Content-Type': 'application/json',
      ...this.customHeaders,
    };
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private shouldRetry(status: number): boolean {
    if (!this.retryConfig) return false;
    return this.retryConfig.statusCodes?.includes(status) ?? false;
  }

  private async request<T>(
    method: string,
    url: string,
    data?: any,
    params?: Record<string, any>
  ): Promise<T> {
    const maxAttempts = this.retryConfig?.attempts ?? 1;
    const delay = this.retryConfig?.delay ?? 1000;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (this.httpClient === 'fetch') {
          const queryString = params ? '?' + new URLSearchParams(params as any).toString() : '';

          if (this.debug) {
            console.log(`[ApsoClient][DEBUG] ${method.toUpperCase()} ${this.baseURL}${url}${queryString}`);
          }

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), this.timeout);

          try {
            const response = await fetch(`${this.baseURL}${url}${queryString}`, {
              method,
              headers: this.getHeaders(),
              body: data ? JSON.stringify(data) : undefined,
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
              if (this.shouldRetry(response.status) && attempt < maxAttempts) {
                await this.sleep(delay * attempt); // Exponential backoff
                continue;
              }
              throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
          } finally {
            clearTimeout(timeoutId);
          }
        } else if (this.httpClient === 'axios') {
          const axiosClient = await this.getAxiosInstance();
          const config = { params, headers: this.getHeaders() };

          if (this.debug) {
            const paramString = params ? '?' + new URLSearchParams(params as any).toString() : '';
            console.log(`[ApsoClient][DEBUG] ${method.toUpperCase()} ${this.baseURL}${url}${paramString}`);
          }

          let response;
          if (method === 'get') {
            response = await axiosClient.get<T>(url, config);
          } else if (method === 'post') {
            response = await axiosClient.post<T>(url, data, config);
          } else if (method === 'put') {
            response = await axiosClient.put<T>(url, data, config);
          } else if (method === 'delete') {
            response = await axiosClient.delete<T>(url, config);
          } else {
            throw new Error(`Unsupported HTTP method: ${method}`);
          }

          return response.data;
        }

        throw new Error("Unsupported HTTP client");
      } catch (error) {
        lastError = error as Error;

        // Check if we should retry
        if (attempt < maxAttempts) {
          const isNetworkError = (error as any)?.name === 'AbortError' ||
                                 (error as any)?.code === 'ECONNABORTED';
          if (isNetworkError) {
            await this.sleep(delay * attempt);
            continue;
          }
        }
        throw error;
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  /**
   * Create an entity query builder for fluent API operations.
   * @example
   * const users = await client.entity('users').where({ status: 'active' }).findMany()
   */
  public entity(entityName: string): EntityClient {
    return new EntityClient(this, entityName);
  }

  /**
   * Perform a GET request with optional caching.
   */
  public async get<T>(
    resource: string,
    params?: QueryParams,
    useCache: boolean = false,
    cacheDuration: number = 60
  ): Promise<T> {
    const queryString = this.buildQueryParams(params);
    const cacheKey = `${resource}${queryString}`;

    if (useCache) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiry > Date.now()) {
        return cached.data;
      }
    }

    const data = await this.request<T>('get', `${resource}${queryString}`);

    if (useCache) {
      this.cache.set(cacheKey, { data, expiry: Date.now() + cacheDuration * 1000 });
    }

    return data;
  }

  /**
   * Perform a POST request.
   */
  public async post<T>(resource: string, data: any): Promise<T> {
    return await this.request<T>('post', resource, data);
  }

  /**
   * Perform a PUT request.
   */
  public async put<T>(resource: string, data: any): Promise<T> {
    return await this.request<T>('put', resource, data);
  }

  /**
   * Perform a DELETE request.
   */
  public async delete<T>(resource: string): Promise<T> {
    return await this.request<T>('delete', resource);
  }

  /**
   * Clear the request cache.
   */
  public clearCache(): void {
    this.cache.clear();
  }

  private buildQueryParams(params?: QueryParams): string {
    if (!params) return '';

    const qb = RequestQueryBuilder.create();

    // Select/fields
    if (params.fields) {
      qb.select(params.fields);
    }

    // Filter
    if (params.filter) {
      Object.entries(params.filter).forEach(([field, value]) => {
        if (typeof value === 'object' && value !== null) {
          // Support operators: { field: { $eq: value } }
          Object.entries(value).forEach(([op, v]) => {
            qb.setFilter({ field, operator: op as CondOperator, value: v });
          });
        } else {
          qb.setFilter({ field, operator: '$eq', value });
        }
      });
    }

    // OR
    if (params.or) {
      Object.entries(params.or).forEach(([field, value]) => {
        if (typeof value === 'object' && value !== null) {
          Object.entries(value).forEach(([op, v]) => {
            qb.setOr({ field, operator: op as CondOperator, value: v });
          });
        } else {
          qb.setOr({ field, operator: '$eq', value });
        }
      });
    }

    // Join
    if (params.join) {
      params.join.forEach((joinField) => {
        qb.setJoin({ field: joinField });
      });
    }

    // Sort
    if (params.sort) {
      Object.entries(params.sort).forEach(([field, order]) => {
        qb.sortBy({ field, order: order as 'ASC' | 'DESC' });
      });
    }

    // Limit, Offset, Page
    if (params.limit !== undefined) qb.setLimit(params.limit);
    if (params.offset !== undefined) qb.setOffset(params.offset);
    if (params.page !== undefined) qb.setPage(params.page);

    // Cache (resetCache)
    if (params.cache !== undefined) {
      if (params.cache) qb.resetCache();
    }

    const query = qb.query();
    return query ? `?${query}` : '';
  }
}

// ============================================================================
// Factory for Singleton Pattern
// ============================================================================

class ApsoClientFactory {
  private static clients: Map<string, ApsoClient> = new Map();

  public static getClient(config: ApsoClientConfig): ApsoClient {
    const clientKey = `${config.baseURL}-${config.apiKey}`;
    if (!ApsoClientFactory.clients.has(clientKey)) {
      ApsoClientFactory.clients.set(clientKey, new ApsoClient(config));
    }
    return ApsoClientFactory.clients.get(clientKey)!;
  }

  public static clearClients(): void {
    ApsoClientFactory.clients.clear();
  }
}

// ============================================================================
// Exports
// ============================================================================

export { ApsoClient, ApsoClientFactory, QueryBuilder };
export { EntityClient, EntityQueryBuilder } from './EntityClient';
