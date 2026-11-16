import axios, { AxiosInstance } from 'axios';
import { EntityClient, QueryBuilder } from './EntityClient';
import { RequestQueryBuilder, CondOperator } from '@apso/crud-request';
import { PostgrestQueryBuilder, PostgrestExecutor, PostgrestError } from './postgrest';

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
  /** Server-side secret, sent as `x-api-key`. Never ship it to a browser. */
  apiKey?: string;
  /** The signed-in user's token, sent as `Authorization: Bearer`. A function is
   *  called on every request, so a refreshed token is picked up. */
  accessToken?: string | (() => string | Promise<string>);
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

/** Thrown when the service answers 401 or 403. */
export class ApsoAuthError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403,
    /** Matches the `x-request-id` in the service's log. */
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApsoAuthError';
  }
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

function newRequestId(): string {
  // randomUUID is missing on pages served over plain http, hence the fallback.
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// ============================================================================
// ApsoClient
// ============================================================================

class ApsoClient {
  private baseURL: string;
  private apiKey?: string;
  private accessToken?: ApsoClientConfig['accessToken'];
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
    this.accessToken = config.accessToken;
    if (config.apiKey && typeof window !== 'undefined') {
      console.warn('[ApsoClient] apiKey is a server-side secret and must not be used in a browser. Use accessToken with the signed-in user\'s token.');
    }
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
      });
    }
    return this.axiosInstance;
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const token = typeof this.accessToken === 'function' ? await this.accessToken() : this.accessToken;
    const hasRequestId = Object.keys(this.customHeaders).some(k => k.toLowerCase() === 'x-request-id');
    return {
      ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      ...(hasRequestId ? {} : { 'x-request-id': newRequestId() }),
      ...this.customHeaders,
    };
  }

  private toAuthError(status: number, body: any, responseId: unknown, headers: Record<string, string>): ApsoAuthError {
    const raw = body?.message ?? body?.error ?? (typeof body === 'string' && body ? body : `HTTP ${status}`);
    const sentKey = Object.keys(headers).find(k => k.toLowerCase() === 'x-request-id');
    return new ApsoAuthError(
      Array.isArray(raw) ? raw.join('; ') : String(raw),
      status as 401 | 403,
      (responseId as string) || (sentKey && headers[sentKey]) || undefined,
    );
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

          const headers = await this.getHeaders();
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), this.timeout);

          try {
            const response = await fetch(`${this.baseURL}${url}${queryString}`, {
              method,
              headers,
              body: data ? JSON.stringify(data) : undefined,
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
              if (this.shouldRetry(response.status) && attempt < maxAttempts) {
                await this.sleep(delay * attempt); // Exponential backoff
                continue;
              }
              if (response.status === 401 || response.status === 403) {
                const text = await response.text().catch(() => '');
                let body: unknown = text;
                try { body = JSON.parse(text); } catch { /* not JSON, keep the text */ }
                throw this.toAuthError(response.status, body, response.headers.get('x-request-id'), headers);
              }
              throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
          } finally {
            clearTimeout(timeoutId);
          }
        } else if (this.httpClient === 'axios') {
          const axiosClient = await this.getAxiosInstance();
          const config = { params, headers: await this.getHeaders() };

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
      } catch (caught) {
        let error = caught;
        const res = (caught as any)?.response; // axios puts the response on the error
        if (res && (res.status === 401 || res.status === 403)) {
          error = this.toAuthError(res.status, res.data, res.headers?.['x-request-id'], res.config?.headers ?? {});
        }
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
   * Supabase-compatible query builder (postgrest-js shape). Serializes to the
   * Apso PostgREST dialect and returns `{ data, error }` (never throws).
   * @example
   * const { data, error } = await client.from('users').select('*').eq('status', 'active')
   */
  public from(table: string): PostgrestQueryBuilder {
    return new PostgrestQueryBuilder(table, this.postgrestExec);
  }

  /** Raw fetch transport for the PostgREST builder — resolves to a response
   *  object and never throws (errors surface on `.error`). */
  private postgrestExec: PostgrestExecutor = async ({ path, method, searchParams, body, headers }) => {
    const qs = searchParams.toString();
    const url = `${this.baseURL}${path}${qs ? `?${qs}` : ''}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    try {
      if (this.debug) console.log(`[ApsoClient][DEBUG][pg] ${method} ${url}`);
      const response = await fetch(url, {
        method,
        headers: { ...(await this.getHeaders()), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const count = this.parseContentRangeCount(response.headers.get('content-range'));
      const text = await response.text();
      let parsed: unknown = null;
      if (text) {
        try { parsed = JSON.parse(text); } catch { parsed = text; }
      }
      if (!response.ok) {
        return {
          data: null,
          error: {
            ...this.toPostgrestError(parsed, response.status),
            requestId: response.headers.get('x-request-id') ?? undefined,
          },
          count, status: response.status, statusText: response.statusText,
        };
      }
      return { data: parsed, error: null, count, status: response.status, statusText: response.statusText };
    } catch (e: any) {
      const isAbort = e?.name === 'AbortError';
      return {
        data: null,
        error: {
          message: isAbort ? `Request timed out after ${this.timeout}ms` : (e?.message ?? 'Network request failed'),
          details: null, hint: null, code: isAbort ? 'TIMEOUT' : 'NETWORK',
        },
        count: null, status: 0, statusText: isAbort ? 'Timeout' : 'Network Error',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  private parseContentRangeCount(header: string | null): number | null {
    if (!header) return null;
    const total = header.split('/')[1];
    if (!total || total === '*') return null;
    const n = parseInt(total, 10);
    return isNaN(n) ? null : n;
  }

  private toPostgrestError(body: unknown, status: number): PostgrestError {
    if (body && typeof body === 'object') {
      const b = body as any;
      return {
        message: b.message ?? b.error ?? `HTTP ${status}`,
        details: b.details ?? (Array.isArray(b.message) ? b.message.join('; ') : null),
        hint: b.hint ?? null,
        code: b.code ?? String(status),
      };
    }
    return {
      message: typeof body === 'string' && body ? body : `HTTP ${status}`,
      details: null, hint: null, code: String(status),
    };
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
    // ponytail: no response cache when the token is a function, because one client
    // can then serve several users. Key the cache by a token digest if this is needed.
    if (typeof this.accessToken === 'function') useCache = false;

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
    // A client that carries a user's token or custom headers is never cached,
    // so one user's client cannot be handed to another.
    if (config.accessToken || config.headers) return new ApsoClient(config);
    const clientKey = `${config.baseURL}-${config.apiKey ?? ''}`;
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
export { PostgrestQueryBuilder, PostgrestFilterBuilder } from './postgrest';
export type { PostgrestResponse, PostgrestError, PostgrestExecutor } from './postgrest';

/**
 * Supabase-familiar entry point. Returns a client whose `.from(table)` mirrors
 * `@supabase/supabase-js`'s query builder, so a Supabase app can swap the
 * import and keep most data calls unchanged.
 * @example
 * const apso = createClient({ baseURL: 'https://api.example.com', apiKey: 'key' })
 * const { data, error } = await apso.from('posts').select('*').eq('published', true)
 */
export function createClient(config: ApsoClientConfig): ApsoClient {
  return ApsoClientFactory.getClient(config);
}
