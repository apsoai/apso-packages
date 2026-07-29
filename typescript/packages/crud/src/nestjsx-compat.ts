/**
 * nestjsx/crud-compatible surface.
 *
 * platform/server (and every consumer migrating off @nestjsx/crud@4.5.0)
 * imports these exact names. The goal is an import swap:
 *   '@nestjsx/crud'         -> '@apso/crud'
 *   '@nestjsx/crud-typeorm' -> '@apso/crud-typeorm'
 */
import { Body, createParamDecorator, ExecutionContext } from '@nestjs/common';
import {
  ParsedRequest as ParsedRequestType,
  CrudAuthOptions,
  CRUD_AUTH_OPTIONS_METADATA,
  PARSED_CRUD_REQUEST_KEY,
} from '@apso/crud-core';

/** nestjsx name for the parsed request type. */
export type CrudRequest = ParsedRequestType;

/** nestjsx bulk-create DTO shape. */
export interface CreateManyDto<T = any> {
  bulk: T[];
}

/**
 * nestjsx CrudController contract: a controller class with a `service`
 * property. The @Crud decorator injects any missing base route handlers.
 */
export interface CrudController<T> {
  service: {
    getMany: (req: CrudRequest) => any;
    getOne: (req: CrudRequest) => any;
    createOne: (req: CrudRequest, dto: any) => any;
    createMany: (req: CrudRequest, dto: CreateManyDto<T>) => any;
    updateOne: (req: CrudRequest, dto: any) => any;
    replaceOne: (req: CrudRequest, dto: any) => any;
    deleteOne: (req: CrudRequest) => any;
    recoverOne?: (req: CrudRequest) => any;
  };
  getManyBase?(req: CrudRequest): any;
  getOneBase?(req: CrudRequest): any;
  createOneBase?(req: CrudRequest, dto: any): any;
  createManyBase?(req: CrudRequest, dto: CreateManyDto<T>): any;
  updateOneBase?(req: CrudRequest, dto: any): any;
  replaceOneBase?(req: CrudRequest, dto: any): any;
  deleteOneBase?(req: CrudRequest): any;
  recoverOneBase?(req: CrudRequest): any;
}

export const OVERRIDE_METHOD_METADATA = 'APSO_CRUD_OVERRIDE_METHOD';

export type BaseRouteName =
  | 'getManyBase'
  | 'getOneBase'
  | 'createOneBase'
  | 'createManyBase'
  | 'updateOneBase'
  | 'replaceOneBase'
  | 'deleteOneBase'
  | 'recoverOneBase';

/**
 * nestjsx @Override: marks a controller method as the replacement for a
 * base route. With no argument, the method's own name must match a base
 * route name (or its un-suffixed form, e.g. getMany for getManyBase).
 */
export function Override(name?: BaseRouteName): MethodDecorator {
  return (target, key) => {
    Reflect.defineMetadata(OVERRIDE_METHOD_METADATA, name || String(key), target[key as keyof typeof target] as any);
  };
}

/**
 * nestjsx @ParsedRequest(): a NestJS custom param decorator that extracts
 * the parsed CrudRequest (attached by CrudRequestInterceptor) at request
 * time. Because it resolves through Nest's param pipeline, a direct unit
 * call — controller.getOne(someParsedRequest) — receives its argument
 * unchanged, exactly like nestjsx (no eager wrapping).
 */
export const ParsedRequest = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    return req[PARSED_CRUD_REQUEST_KEY];
  },
);

/**
 * nestjsx @ParsedBody(): the request body (bulk-aware typing is the
 * caller's DTO concern, matching nestjsx behavior).
 */
export function ParsedBody(): ParameterDecorator {
  return (target, key, index) => {
    Body()(target, key, index);
  };
}

/** Resolve the @Override target method name for a base route, if any. */
export function findOverride(proto: any, baseName: BaseRouteName): string | undefined {
  const shortName = baseName.replace(/Base$/, '');
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === 'constructor') continue;
    const fn = proto[key];
    if (typeof fn !== 'function') continue;
    const mark = Reflect.getMetadata(OVERRIDE_METHOD_METADATA, fn);
    if (!mark) continue;
    if (mark === baseName || mark === shortName || (mark === key && (key === baseName || key === shortName))) {
      return key;
    }
  }
  return undefined;
}

/**
 * nestjsx @CrudAuth: class decorator carrying the access-control options.
 * Stored under its own metadata key (order-independent with @Crud); the
 * request interceptor merges it with any options.auth, options.auth
 * winning when both are present.
 */
export function CrudAuth(options: CrudAuthOptions): ClassDecorator {
  return (target: any) => {
    Reflect.defineMetadata(CRUD_AUTH_OPTIONS_METADATA, options, target);
    return target;
  };
}
