/**
 * CRUD Request Interceptor
 *
 * This interceptor automatically parses incoming HTTP requests and converts
 * query parameters into structured ParsedRequest objects that are attached
 * to the request context.
 */

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Reflector } from '@nestjs/core';
import {
  ParsedRequest,
  CrudRequestOptions,
  PARSED_CRUD_REQUEST_KEY,
  CRUD_OPTIONS_METADATA
} from '@apso/crud-core';
import { CrudRequestParser } from './request-parser';

@Injectable()
export class CrudRequestInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    // Get CRUD options from method or class metadata
    const crudOptions = this.getCrudOptions(context);

    // Create parser with options
    const parser = new CrudRequestParser(crudOptions);

    // Evaluate CrudAuthOptions against the request. The resulting filter is
    // ANDed at the top of the search tree (or `or` is ORed against it), so
    // user-supplied query params can never widen an auth restriction.
    const auth = crudOptions.auth;
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

    // Parse the request
    const parsedRequest = parser.parse(request.query, request.params, authContext);

    // Attach parsed request to the request object
    request[PARSED_CRUD_REQUEST_KEY] = parsedRequest;

    return next.handle();
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