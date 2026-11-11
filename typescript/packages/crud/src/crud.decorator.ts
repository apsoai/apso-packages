/**
 * CRUD Decorator
 *
 * This decorator provides the main @Crud() functionality that replaces
 * the nestjsx/crud decorator with enhanced features and better type safety.
 */

import {
  applyDecorators,
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseInterceptors,
  SetMetadata
} from '@nestjs/common';
import { findOverride, ParsedRequest, BaseRouteName } from './nestjsx-compat';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import {
  CrudControllerOptions,
  CRUD_OPTIONS_METADATA,
  CRUD_CONTROLLER_METADATA,
  CrudValidationGroups
} from '@apso/crud-core';
import { getMetadataArgsStorage } from 'typeorm';
import { CrudRequestInterceptor } from './crud-request.interceptor';
import { isPostgrestOnly, onAcceptedDialectsChange } from './dialect';

/**
 * Main CRUD decorator that configures a controller class for CRUD operations
 */
export function Crud(options: CrudControllerOptions): ClassDecorator {
  return (target: any) => {
    // Store options in metadata
    SetMetadata(CRUD_OPTIONS_METADATA, options)(target);
    SetMetadata(CRUD_CONTROLLER_METADATA, true)(target);

    // NOTE: unlike an earlier draft, @Crud does NOT apply @Controller —
    // nestjsx semantics: the consumer's own @Controller('path') owns the
    // mount path, and applying Controller() here would clobber it.

    // Apply interceptor for request parsing
    UseInterceptors(CrudRequestInterceptor)(target);

    // Apply API documentation
    if (options.model?.type) {
      const entityName = options.model.type.name || 'Entity';
      ApiTags(entityName)(target);
    }

    // Generate CRUD routes
    generateCrudRoutes(target, options);

    return target;
  };
}

/**
 * Generate all CRUD route decorators
 */
function generateCrudRoutes(target: any, options: CrudControllerOptions) {
  const routes = options.routes;
  const entityName = options.model?.type?.name || 'Entity';

  // GET Many - GET /
  if (!routes?.exclude?.includes('getManyBase')) {
    const getManyDecorators = [
      Get(),
      ApiOperation({
        summary: `Get many ${entityName}`,
        description: `Retrieve multiple ${entityName} entities with filtering, sorting, and pagination`
      }),
      ApiResponse({
        status: 200,
        description: `${entityName} entities retrieved successfully`,
        schema: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: `#/components/schemas/${entityName}` } },
            count: { type: 'number' },
            total: { type: 'number' },
            page: { type: 'number' },
            pageCount: { type: 'number' }
          }
        }
      })
    ];

    const getManyRoute = applyMethodDecorators(target, 'getMany', getManyDecorators);
    // The query parameters depend on the accepted dialects, which the app can
    // set after this decorator has run (setAcceptedDialects), so they are
    // written now and again on every change.
    const document = () => documentRead(target, getManyRoute, options, true);
    document();
    onAcceptedDialectsChange(document);
  }

  // GET One - GET /:id
  if (!routes?.exclude?.includes('getOneBase')) {
    const getOneDecorators = [
      Get(':id'),
      ApiOperation({
        summary: `Get one ${entityName}`,
        description: `Retrieve a single ${entityName} entity by ID`
      }),
      ApiParam({ name: 'id', description: `${entityName} ID` }),
      ApiResponse({
        status: 200,
        description: `${entityName} entity retrieved successfully`,
        schema: {
          type: 'object',
          properties: {
            data: { $ref: `#/components/schemas/${entityName}` }
          }
        }
      }),
      ApiResponse({ status: 404, description: `${entityName} not found` })
    ];

    const getOneRoute = applyMethodDecorators(target, 'getOne', getOneDecorators);
    const document = () => documentRead(target, getOneRoute, options, false);
    document();
    onAcceptedDialectsChange(document);
  }

  // POST Create - POST /
  if (!routes?.exclude?.includes('createOneBase')) {
    const createDto = options.dto?.create || options.model.type;
    const createOneDecorators = [
      Post(),
      ApiOperation({
        summary: `Create ${entityName}`,
        description: `Create a new ${entityName} entity`
      }),
      ApiBody({
        type: createDto,
        description: `${entityName} data for creation`
      }),
      ApiResponse({
        status: 201,
        description: `${entityName} created successfully`,
        schema: {
          type: 'object',
          properties: {
            data: { $ref: `#/components/schemas/${entityName}` }
          }
        }
      }),
      ApiResponse({ status: 400, description: 'Validation failed' })
    ];

    applyMethodDecorators(target, 'createOne', createOneDecorators);
  }

  // POST Create Many - POST /bulk
  if (!routes?.exclude?.includes('createManyBase')) {
    const createDto = options.dto?.create || options.model.type;
    const createManyDecorators = [
      Post('bulk'),
      ApiOperation({
        summary: `Create many ${entityName}`,
        description: `Create multiple ${entityName} entities`
      }),
      ApiBody({
        schema: {
          type: 'object',
          properties: {
            bulk: {
              type: 'array',
              items: { $ref: `#/components/schemas/${createDto.name || entityName}` }
            }
          }
        },
        description: `${entityName} data for bulk creation`
      }),
      ApiResponse({
        status: 201,
        description: `${entityName} entities created successfully`,
        schema: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: { $ref: `#/components/schemas/${entityName}` }
            }
          }
        }
      })
    ];

    applyMethodDecorators(target, 'createMany', createManyDecorators);
  }

  // PATCH Update - PATCH /:id
  if (!routes?.exclude?.includes('updateOneBase')) {
    const updateDto = options.dto?.update || options.model.type;
    const updateOneDecorators = [
      Patch(':id'),
      ApiOperation({
        summary: `Update ${entityName}`,
        description: `Update an existing ${entityName} entity (partial update)`
      }),
      ApiParam({ name: 'id', description: `${entityName} ID` }),
      ApiBody({
        type: updateDto,
        description: `${entityName} data for update`
      }),
      ApiResponse({
        status: 200,
        description: `${entityName} updated successfully`,
        schema: {
          type: 'object',
          properties: {
            data: { $ref: `#/components/schemas/${entityName}` }
          }
        }
      }),
      ApiResponse({ status: 404, description: `${entityName} not found` })
    ];

    applyMethodDecorators(target, 'updateOne', updateOneDecorators);
  }

  // PUT Replace - PUT /:id
  if (!routes?.exclude?.includes('replaceOneBase')) {
    const replaceDto = options.dto?.replace || options.model.type;
    const replaceOneDecorators = [
      Put(':id'),
      ApiOperation({
        summary: `Replace ${entityName}`,
        description: `Replace an existing ${entityName} entity (full replacement)`
      }),
      ApiParam({ name: 'id', description: `${entityName} ID` }),
      ApiBody({
        type: replaceDto,
        description: `${entityName} data for replacement`
      }),
      ApiResponse({
        status: 200,
        description: `${entityName} replaced successfully`,
        schema: {
          type: 'object',
          properties: {
            data: { $ref: `#/components/schemas/${entityName}` }
          }
        }
      }),
      ApiResponse({ status: 404, description: `${entityName} not found` })
    ];

    applyMethodDecorators(target, 'replaceOne', replaceOneDecorators);
  }

  // DELETE - DELETE /:id
  if (!routes?.exclude?.includes('deleteOneBase')) {
    const deleteOneDecorators = [
      Delete(':id'),
      ApiOperation({
        summary: `Delete ${entityName}`,
        description: `Delete an existing ${entityName} entity`
      }),
      ApiParam({ name: 'id', description: `${entityName} ID` }),
      ApiResponse({
        status: 200,
        description: `${entityName} deleted successfully`
      }),
      ApiResponse({ status: 404, description: `${entityName} not found` })
    ];

    applyMethodDecorators(target, 'deleteOne', deleteOneDecorators);
  }

  // PATCH Recover - PATCH /:id/recover (if soft delete is enabled)
  if (!routes?.exclude?.includes('recoverOneBase') &&
      options.query?.softDelete !== false) {
    const recoverOneDecorators = [
      Patch(':id/recover'),
      ApiOperation({
        summary: `Recover ${entityName}`,
        description: `Recover a soft-deleted ${entityName} entity`
      }),
      ApiParam({ name: 'id', description: `${entityName} ID` }),
      ApiResponse({
        status: 200,
        description: `${entityName} recovered successfully`,
        schema: {
          type: 'object',
          properties: {
            data: { $ref: `#/components/schemas/${entityName}` }
          }
        }
      }),
      ApiResponse({ status: 404, description: `${entityName} not found` })
    ];

    applyMethodDecorators(target, 'recoverOne', recoverOneDecorators);
  }
}

/** @nestjs/swagger's metadata key for a handler's documented parameters. */
const API_PARAMETERS = 'swagger/apiParameters';
const DOCUMENTED_QUERY = 'apso:crud:documented-query';

/**
 * Write the query documentation of a read route (list or read by id) for the
 * dialects the controller accepts now. Replaces what an earlier call wrote and
 * leaves parameters documented by anyone else alone.
 */
function documentRead(target: any, routeName: string | undefined, options: CrudControllerOptions, list: boolean) {
  const proto = target.prototype;
  if (!routeName) return;
  const handler = proto[routeName];
  if (typeof handler !== 'function') return;
  const descriptor = Object.getOwnPropertyDescriptor(proto, routeName) || { value: handler };

  const postgrest = isPostgrestOnly(options.dialects as any);
  const docs: Array<{ name: string } & Record<string, any>> = postgrest
    ? postgrestQueryParameters(options, list)
    : list
      ? NESTJSX_QUERY_PARAMETERS.filter(p => p.name !== 'join' || options.query?.join)
      : [];

  const mine: string[] = Reflect.getMetadata(DOCUMENTED_QUERY, handler) || [];
  const kept = (Reflect.getMetadata(API_PARAMETERS, handler) || []).filter(
    (p: any) => !(p.in === 'query' && mine.includes(p.name)),
  );
  Reflect.defineMetadata(API_PARAMETERS, kept, handler);
  Reflect.defineMetadata(DOCUMENTED_QUERY, docs.map(d => d.name), handler);
  docs.forEach(d => ApiQuery({ required: false, ...d } as any)(proto, routeName, descriptor));

  if (!list) return;
  const entityName = options.model?.type?.name || 'Entity';
  if (postgrest) {
    const rows = { type: 'array', items: { $ref: `#/components/schemas/${entityName}` } };
    const contentRange = {
      'Content-Range': {
        description: "Rows returned and the total: 0-9/42. The total is * unless 'Prefer: count=exact' was sent or no limit was sent and more rows exist.",
        schema: { type: 'string' },
      },
    };
    ApiOperation({ summary: `Get many ${entityName}`, description: postgrestListDescription(options) })(proto, routeName, descriptor);
    ApiResponse({ status: 200, description: 'The rows, as a JSON array', schema: rows, headers: contentRange })(proto, routeName, descriptor);
    ApiResponse({ status: 206, description: 'Part of the matching rows; Content-Range has the total', schema: rows, headers: contentRange })(proto, routeName, descriptor);
  }
}

const NESTJSX_QUERY_PARAMETERS = [
  { name: 'fields', description: 'Comma-separated list of fields to select', example: 'name,status,id' },
  { name: 'filter', description: 'Filter conditions (field||operator||value)', example: 'status||$eq||Active' },
  { name: 's', description: 'Complex search conditions (JSON)', example: '{"name": {"$contL": "John"}}' },
  { name: 'sort', description: 'Sort conditions (field,order)', example: 'name,ASC' },
  { name: 'join', description: 'Join relations', example: 'facilities||id,status' },
  { name: 'limit', type: 'number', description: 'Number of items per page' },
  { name: 'page', type: 'number', description: 'Page number' },
  { name: 'offset', type: 'number', description: 'Number of items to skip' },
];

/** Names a column filter parameter cannot take: they are PostgREST's own. */
const POSTGREST_RESERVED = new Set(['select', 'order', 'limit', 'offset', 'or', 'and', 'embedded']);

type ColumnKind = 'number' | 'boolean' | 'date' | 'string';

/**
 * The entity's filterable columns, from TypeORM's decorator metadata (the
 * entity class has been decorated by the time @Crud runs). Leaves out what
 * the controller hides: `query.exclude`, anything outside `query.allow`, and
 * columns declared `select: false`.
 */
export function filterableColumns(options: CrudControllerOptions): Array<{ name: string; kind: ColumnKind; nullable: boolean }> {
  const entity: any = options.model?.type;
  if (typeof entity !== 'function') return [];
  const chain: Function[] = [];
  for (let c = entity; typeof c === 'function' && c !== Function.prototype; c = Object.getPrototypeOf(c)) chain.push(c);
  let columns: any[];
  try {
    columns = getMetadataArgsStorage().filterColumns(chain);
  } catch {
    return [];
  }
  const exclude = new Set<string>(options.query?.exclude || []);
  const allow: string[] | undefined = options.query?.allow?.length ? options.query.allow : undefined;
  const out = new Map<string, { name: string; kind: ColumnKind; nullable: boolean }>();
  for (const column of columns) {
    const name = column.propertyName as string;
    if (exclude.has(name) || (allow && !allow.includes(name)) || column.options?.select === false) continue;
    if (POSTGREST_RESERVED.has(name)) continue;
    const declared = column.options?.type ?? Reflect.getMetadata('design:type', column.target.prototype, name);
    const type = (typeof declared === 'function' ? declared.name : String(declared ?? '')).toLowerCase();
    const kind: ColumnKind =
      /date|time/.test(type) || /date/i.test(column.mode) ? 'date'
      : /bool/.test(type) ? 'boolean'
      : /int|num|dec|float|double|real|money|serial/.test(type) ? 'number'
      : 'string';
    out.set(name, { name, kind, nullable: Boolean(column.options?.nullable) });
  }
  return [...out.values()];
}

const FILTER_EXAMPLE: Record<ColumnKind, string> = {
  number: 'gte.5',
  boolean: 'is.true',
  date: 'gte.2026-01-01',
  string: 'ilike.*abc*',
};

/**
 * PostgREST query parameters for a read route, written for a caller that
 * builds requests from this document (an agent through @apso/mcp, a generated
 * client). One optional parameter per column, because that is the wire
 * format: `views=gte.100`.
 */
function postgrestQueryParameters(options: CrudControllerOptions, list: boolean) {
  const relations = Object.keys(options.query?.join || {});
  const select = {
    name: 'select',
    description:
      'Columns to return, comma-separated. Default: all.' +
      (relations.length
        ? ` Embed related rows with rel(col,...) or rel(*): ${relations.join(', ')}.` +
          (list ? ' rel!inner(...) keeps only rows that have a related row.' : '')
        : ''),
    schema: { type: 'string' },
  };
  if (!list) return [select];

  const text = (name: string, description: string) => ({ name, description, schema: { type: 'string' } });
  const limit = options.query?.limit ?? 20;
  const docs: any[] = [
    select,
    text('order', 'Sort: col.asc or col.desc, comma-separated. Optional .nullsfirst or .nullslast.'),
    { name: 'limit', description: `Maximum rows. Default ${limit}, at most ${options.query?.maxLimit ?? 100}.`, schema: { type: 'integer' } },
    { name: 'offset', description: 'Rows to skip.', schema: { type: 'integer' } },
    text('or', 'Any condition matches: (col.op.value,col.op.value). Nest and(...) inside.'),
    text('and', 'Every condition matches: (col.op.value,col.op.value). Nest or(...) inside.'),
  ];
  for (const column of filterableColumns(options)) {
    docs.push(text(column.name, `Filter, op.value: ${FILTER_EXAMPLE[column.kind]}${column.nullable ? ', is.null' : ''}`));
  }
  if (relations.length) {
    docs.push({
      name: 'embedded',
      description:
        `Filters on embedded rows, keyed rel.column: {"${relations[0]}.<column>":"eq.x"}. ` +
        'Sent as rel.column=op.value. The relation must be in select.',
      style: 'form',
      explode: true,
      schema: { type: 'object', additionalProperties: { type: 'string' } },
    });
  }
  return docs;
}

/** The list operation's description: the filter grammar once, and one worked example. */
function postgrestListDescription(options: CrudControllerOptions): string {
  const entityName = options.model?.type?.name || 'Entity';
  const columns = filterableColumns(options);
  const relation = Object.keys(options.query?.join || {}).find(r => !r.includes('.'));
  const first = columns[0]?.name ?? 'id';
  const filtered = columns.find(c => c.name !== first) ?? columns[0];
  const example =
    `?select=${[...new Set([first, filtered?.name].filter(Boolean))].join(',')}${relation ? `,${relation}(*)` : ''}` +
    (filtered ? `&${filtered.name}=${FILTER_EXAMPLE[filtered.kind]}` : '') +
    `&order=${first}.desc&limit=10`;
  return (
    `Returns ${entityName} rows as a JSON array. Filter with one parameter per column, value op.value. ` +
    'Operators: eq, neq, gt, gte, lt, lte, like and ilike (* is the wildcard), in.(a,b), is.null, is.true, is.false. ' +
    'Put not. in front to negate (not.eq.5). Filters on different columns must all match. ' +
    `Without limit at most ${options.query?.limit ?? 20} rows come back. ` +
    "The Content-Range response header gives the rows returned and, with the request header 'Prefer: count=exact', the total (0-9/42). " +
    `Example: ${example}`
  );
}

/**
 * Service method + handler shape per base route (nestjsx naming).
 */
const SERVICE_METHOD: Record<string, { op: string; hasBody: boolean }> = {
  getManyBase: { op: 'getMany', hasBody: false },
  getOneBase: { op: 'getOne', hasBody: false },
  createOneBase: { op: 'createOne', hasBody: true },
  createManyBase: { op: 'createMany', hasBody: true },
  updateOneBase: { op: 'updateOne', hasBody: true },
  replaceOneBase: { op: 'replaceOne', hasBody: true },
  deleteOneBase: { op: 'deleteOne', hasBody: false },
  recoverOneBase: { op: 'recoverOne', hasBody: false }
};

/**
 * Wire up one base route, nestjsx-compatibly:
 *
 * 1. Ensure the *Base delegator method exists on the prototype — a plain
 *    method that forwards an ALREADY-parsed request to the service. Autogen
 *    controllers call `this.base.getOneBase(req)` from their @Override
 *    methods, so it must exist regardless of overrides. It does NOT
 *    re-extract: the request it receives is already the ParsedRequest
 *    (from the caller's @ParsedRequest resolution, or a direct unit call).
 * 2. Pick the route handler: the @Override method if present, else the
 *    *Base method itself.
 * 3. Apply the HTTP/Swagger decorators to the route handler.
 * 4. If the route handler is the injected *Base method (no override in
 *    source), attach @ParsedRequest to param 0 (+ @Body to param 1 for
 *    body routes) so Nest resolves them at runtime. Override methods
 *    already carry @ParsedRequest/@Body in the source.
 */
function applyMethodDecorators(target: any, legacyName: string, decorators: any[]): string | undefined {
  const proto = target.prototype;
  const baseName = `${legacyName}Base` as BaseRouteName;
  const spec = SERVICE_METHOD[baseName];
  if (!spec) return undefined;

  // (1) ensure the delegator exists
  if (typeof proto[baseName] !== 'function') {
    if (spec.hasBody) {
      proto[baseName] = function (this: any, req: any, dto: any) {
        return this.service[spec.op](req, dto);
      };
    } else {
      proto[baseName] = function (this: any, req: any) {
        return this.service[spec.op](req);
      };
    }
  }

  // (2) route handler: override method, else the base method
  const override = findOverride(proto, baseName);
  const routeName =
    override || (typeof proto[legacyName] === 'function' ? legacyName : baseName);

  // (4) if the base method is the route handler, it needs param decorators
  if (routeName === baseName) {
    ParsedRequest()(proto, baseName, 0);
    if (spec.hasBody) Body()(proto, baseName, 1);
  }

  // (3) apply HTTP + Swagger decorators to the route handler
  decorators.forEach(decorator => {
    decorator(proto, routeName, Object.getOwnPropertyDescriptor(proto, routeName));
  });
  return routeName;
}