/**
 * @apso/postgrest-request
 *
 * Client-safe PostgREST URL query parser. Emits the same ParsedRequest as
 * @apso/crud-request so the @apso/crud engine treats both dialects
 * identically. No @nestjs / server dependency — safe in a browser/SDK.
 */
export * from './postgrest-parser';
