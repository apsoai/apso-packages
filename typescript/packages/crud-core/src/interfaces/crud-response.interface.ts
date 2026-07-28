/**
 * Core interfaces for CRUD response structures
 *
 * These interfaces ensure consistent response formats across all CRUD operations,
 * maintaining compatibility with existing nestjsx/crud consumers.
 */

export interface CrudResponse<T = any> {
  data: T | T[];
  count?: number;
  total?: number;
  page?: number;
  pageCount?: number;
}

export interface GetManyResponse<T = any> extends CrudResponse<T[]> {
  data: T[];
  count: number;
  total: number;
  page: number;
  pageCount: number;
}

export interface GetOneResponse<T = any> extends CrudResponse<T> {
  data: T;
}

export interface CreateOneResponse<T = any> extends CrudResponse<T> {
  data: T;
}

export interface CreateManyResponse<T = any> extends CrudResponse<T[]> {
  data: T[];
}

export interface UpdateOneResponse<T = any> extends CrudResponse<T> {
  data: T;
}

export interface ReplaceOneResponse<T = any> extends CrudResponse<T> {
  data: T;
}

export interface DeleteOneResponse {
  data?: any;
  message?: string;
}

export interface RecoverOneResponse<T = any> extends CrudResponse<T> {
  data: T;
}

export interface CrudResponseMetadata {
  timestamp: string;
  path: string;
  method: string;
  statusCode: number;
  duration?: number;
}

export interface ErrorResponse {
  statusCode: number;
  message: string | string[];
  error?: string;
  timestamp: string;
  path: string;
}

export interface ValidationErrorResponse extends ErrorResponse {
  statusCode: 400;
  message: string[];
  error: 'Bad Request';
  details?: ValidationError[];
}

export interface ValidationError {
  field: string;
  value: any;
  constraints: {
    [constraintName: string]: string;
  };
}