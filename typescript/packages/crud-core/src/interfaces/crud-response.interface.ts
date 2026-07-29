/**
 * Core interfaces for CRUD response structures.
 *
 * These mirror nestjsx/crud's actual wire shapes:
 * - getMany returns the pagination envelope ONLY when paginated
 *   (options.query.alwaysPaginate, or page/offset present on the request);
 *   otherwise it returns a bare T[].
 * - getOne / createOne / updateOne / replaceOne / recoverOne return the
 *   bare entity, createMany a bare T[], deleteOne void (or the deleted
 *   entity when configured with returnDeleted).
 */

/** nestjsx-compatible pagination envelope (same name as nestjsx). */
export interface GetManyDefaultResponse<T = any> {
  data: T[];
  count: number;
  total: number;
  page: number;
  pageCount: number;
}

export type GetManyResponse<T = any> = GetManyDefaultResponse<T> | T[];

export type GetOneResponse<T = any> = T;
export type CreateOneResponse<T = any> = T;
export type CreateManyResponse<T = any> = T[];
export type UpdateOneResponse<T = any> = T;
export type ReplaceOneResponse<T = any> = T;
export type DeleteOneResponse<T = any> = void | T;
export type RecoverOneResponse<T = any> = T;

/** Type guard for the paginated getMany envelope. */
export function isGetManyDefaultResponse<T>(
  result: GetManyResponse<T>
): result is GetManyDefaultResponse<T> {
  return !Array.isArray(result);
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
