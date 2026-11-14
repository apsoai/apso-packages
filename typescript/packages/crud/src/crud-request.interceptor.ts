/**
 * CRUD Request Interceptor (NestJS).
 *
 * Lives in the @apso/crud (NestJS) package, NOT @apso/crud-request, which
 * must stay client-safe (no @nestjs dependency) so the SDK/browser can build
 * queries with the parser. This interceptor parses the request via the
 * client-safe CrudRequestParser and maps its framework-agnostic
 * RequestQueryException to a 400, mirroring @nestjsx/crud.
 */

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import {
  ParsedRequest,
  CrudRequestOptions,
  PARSED_CRUD_REQUEST_KEY,
  CRUD_OPTIONS_METADATA,
  CRUD_AUTH_OPTIONS_METADATA,
  RequestQueryException,
} from '@apso/crud-core';
import { CrudRequestParser } from '@apso/crud-request';
import { PostgrestRequestParser } from '@apso/postgrest-request';
import { resolveDialect } from './dialect';

@Injectable()
export class CrudRequestInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    // Get CRUD options from method or class metadata
    const crudOptions = this.getCrudOptions(context);

    // Evaluate CrudAuthOptions against the request. The resulting filter is
    // ANDed at the top of the search tree (or `or` is ORed against it), so
    // user-supplied query params can never widen an auth restriction.
    // options.auth (set via @Crud options or metadata patching) wins;
    // otherwise fall back to the @CrudAuth class decorator's metadata.
    const auth =
      crudOptions.auth ||
      this.reflector.get(CRUD_AUTH_OPTIONS_METADATA, context.getClass());
    const authContext: { filter?: any; or?: any; persist?: any } = {};
    if (auth) {
      const subject = auth.property ? request[auth.property] : request;
      if (typeof auth.or === 'function') {
        authContext.or = auth.or(subject) || undefined;
      }
      if (!authContext.or && typeof auth.filter === 'function') {
        authContext.filter = auth.filter(subject) || undefined;
      }
      if (typeof auth.persist === 'function') {
        authContext.persist = auth.persist(subject) || undefined;
      }
    }

    // Select the dialect (the route's accepted dialects, then header override
    // or param-shape when it accepts both), build the matching
    // parser, and parse. Both parsers share the same parse(query, params,
    // auth) -> ParsedRequest contract, so the engine downstream is identical.
    // An invalid header or an ambiguous mixed-dialect query throws
    // RequestQueryException -> 400 (see resolveDialect / docs/DIALECTS.md).
    let parsedRequest: ParsedRequest | undefined;
    const res = context.switchToHttp().getResponse();
    try {
      const dialect = resolveDialect(
        request.query,
        request.headers?.['x-crud-dialect'],
        crudOptions.dialects,
      );
      const parser =
        dialect === 'postgrest'
          ? new PostgrestRequestParser(crudOptions)
          : new CrudRequestParser(crudOptions);

      const isRead = request.method === undefined || request.method === 'GET' || request.method === 'HEAD';
      const pgRead = dialect === 'postgrest' && isRead;
      if (pgRead && /application\/vnd\.pgrst\./i.test(String(request.headers?.accept ?? ''))) {
        throw new RequestQueryException(
          "The application/vnd.pgrst.* media types are not supported. A list is always a JSON array; read one row with GET /<resource>/<id>.",
        );
      }
      const query = pgRead ? withRangeHeader(request.query, request.headers?.range) : request.query;
      parsedRequest = parser.parse(query, request.params, authContext);
      if (pgRead) {
        const count = /(?:^|[,;\s])count=(exact|planned|estimated)\b/i.exec(String(request.headers?.prefer ?? ''));
        if (count) parsedRequest.parsed.count = count[1].toLowerCase() as 'exact' | 'planned' | 'estimated';
      }
      request[PARSED_CRUD_REQUEST_KEY] = parsedRequest;

      // Echo the resolved dialect so clients and the conformance battery can
      // confirm which parser ran (harmless if the response is already sent).
      if (res && typeof res.setHeader === 'function' && !res.headersSent) {
        res.setHeader('X-Crud-Dialect', dialect);
      }
    } catch (e) {
      if (e instanceof RequestQueryException) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }

    // After the handler: the engine left what a PostgREST list returned on
    // the parsed request (see TypeOrmCrudService.getMany). Runs before Nest
    // writes the response, so headers and status can still be set.
    const parsed = parsedRequest;
    return next.handle().pipe(tap(() => sendContentRange(res, parsed)));
  }

  /**
   * Get CRUD options from metadata
   */
  private getCrudOptions(context: ExecutionContext): CrudRequestOptions {
    const handler = context.getHandler();
    const controller = context.getClass();

    // First try to get options from method metadata
    let options = this.reflector.get<CrudRequestOptions>(CRUD_OPTIONS_METADATA, handler);

    // If not found, try class metadata
    if (!options) {
      options = this.reflector.get<CrudRequestOptions>(CRUD_OPTIONS_METADATA, controller);
    }

    return options || {};
  }
}

/**
 * PostgREST `Range: 0-19` (with or without `Range-Unit: items`) is the same
 * window as offset=0&limit=20, and `Range: 10-` is offset=10. A header in any
 * other unit (`bytes=...`) is ignored, as RFC 7233 allows. Sending it together
 * with limit/offset is a 400 and an inverted range is a 416.
 */
export function withRangeHeader(query: Record<string, any> = {}, header?: string | string[]): Record<string, any> {
  const m = /^\s*(?:items=)?(\d+)-(\d*)\s*$/.exec(String((Array.isArray(header) ? header[0] : header) ?? ''));
  if (!m) return query;
  if (query.limit !== undefined || query.offset !== undefined) {
    throw new RequestQueryException('Send either the Range header or the limit and offset parameters, not both.');
  }
  const from = Number(m[1]);
  if (m[2] === '') return { ...query, offset: String(from) };
  const to = Number(m[2]);
  if (to < from) throw new HttpException(`Invalid Range '${m[0].trim()}': the end is before the start.`, 416);
  return { ...query, offset: String(from), limit: String(to - from + 1) };
}

/**
 * PostgREST response headers for a list: `Content-Range: <from>-<to>/<total>`
 * (`*` for an empty page, `*` for a total that was not counted),
 * `Preference-Applied` when a count was asked for, and 206 when the total is
 * known and the page holds only part of it.
 */
function sendContentRange(res: any, req?: ParsedRequest): void {
  const range = req?.range;
  if (!range || !res || res.headersSent) return;
  const set = (name: string, value: string) =>
    typeof res.setHeader === 'function' ? res.setHeader(name, value) : res.header?.(name, value);
  const span = range.rows > 0 ? `${range.offset}-${range.offset + range.rows - 1}` : '*';
  set('Range-Unit', 'items');
  set('Content-Range', `${span}/${range.total ?? '*'}`);
  // planned and estimated are answered with an exact count, and say so.
  if (req.parsed.count) set('Preference-Applied', 'count=exact');
  // A browser on another origin can only read headers the server exposes.
  const exposed = String(res.getHeader?.('Access-Control-Expose-Headers') ?? '');
  if (!/content-range/i.test(exposed)) {
    set('Access-Control-Expose-Headers', [exposed, 'Content-Range, Preference-Applied'].filter(Boolean).join(', '));
  }
  if (range.total !== undefined && range.rows > 0 && range.rows < range.total && typeof res.status === 'function') {
    // Nest sets the route's default status before the handler runs and does
    // not set it again, so this one stands.
    res.status(206);
  }
}

/**
 * Parameter decorator to inject parsed request
 */
export const CrudRequest = () => {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    return Inject(PARSED_CRUD_REQUEST_KEY)(target, propertyKey, parameterIndex);
  };
};

/**
 * Custom parameter decorator that extracts ParsedRequest from request object
 */
export const ParsedCrudRequest = () => {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    const existingMetadata = Reflect.getMetadata('custom:parsed_crud_request', target, propertyKey!) || [];
    existingMetadata.push(parameterIndex);
    Reflect.defineMetadata('custom:parsed_crud_request', existingMetadata, target, propertyKey!);
  };
};

/**
 * Transform function to extract ParsedRequest from request
 */
export function extractParsedRequest(req: any): ParsedRequest {
  const parsedRequest = req[PARSED_CRUD_REQUEST_KEY];
  if (!parsedRequest) {
    throw new Error('ParsedRequest not found. Make sure CrudRequestInterceptor is applied.');
  }
  return parsedRequest;
}
