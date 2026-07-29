/**
 * PostgREST URL query parser.
 *
 * Parses PostgREST-style query params into the SAME ParsedRequest the
 * @apso/crud engine consumes (the TypeORM builder is unchanged, so both
 * dialects behave identically downstream). Built to the PostgREST docs
 * (references/api/tables_views + resource_embedding), verified per operator.
 *
 * Core surface (this file): select, ?column=op.value filters, order,
 * limit/offset. Resource embedding (select=...,rel(...)) is layered on in
 * the @apso/crud join path (see #50). Advanced operators (cs/cd/ov/fts,
 * or=()/and=(), JSON path) are deferred (#54).
 *
 * Client-safe: depends only on @apso/crud-core, no @nestjs / server code.
 */
import {
  ParsedRequest,
  ParsedRequestParams,
  FilterCondition,
  SearchCondition,
  SortCondition,
  FilterOperator,
  CrudRequestOptions,
  RequestQueryException,
  DEFAULT_PAGE_SIZE,
  DEFAULT_MAX_LIMIT,
} from '@apso/crud-core';

/** Reserved query keys that are NOT column filters. */
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'and', 'or']);

/**
 * PostgREST operator -> @apso FilterOperator. Only the CORE set (#49);
 * cs/cd/ov/fts/range and logical grouping are deferred (#54).
 */
const OP_MAP: Record<string, FilterOperator> = {
  eq: '$eq',
  neq: '$ne',
  gt: '$gt',
  gte: '$gte',
  lt: '$lt',
  lte: '$lte',
  like: '$like',
  ilike: '$ilike',
  in: '$in',
};

/** not.<op> -> the negated @apso operator, where a direct negation exists. */
const NOT_MAP: Record<string, FilterOperator> = {
  eq: '$ne',
  neq: '$eq',
  in: '$notin',
  like: '$excl',
  ilike: '$exclL',
};

export class PostgrestRequestParser {
  private options: CrudRequestOptions;

  constructor(options: CrudRequestOptions = {}) {
    this.options = {
      query: {
        limit: DEFAULT_PAGE_SIZE,
        maxLimit: DEFAULT_MAX_LIMIT,
        alwaysPaginate: false,
        ...options.query,
      },
      ...options,
    };
  }

  parse(
    query: any,
    params: any = {},
    authContext: { filter?: SearchCondition; or?: SearchCondition; persist?: Record<string, any> } = {},
  ): ParsedRequest {
    const fields = this.parseSelect(query.select);
    const sort = this.parseOrder(query.order);
    const { limit, offset } = this.parsePagination(query);
    const conditions = this.parseFilters(query, params);

    const search = this.buildSearchTree(conditions, authContext);

    const parsed: ParsedRequestParams = {
      fields,
      paramsFilter: this.parseParams(params),
      authPersist: authContext.persist || undefined,
      search,
      filter: conditions,
      or: [],
      join: [], // embeds handled in @apso/crud (see #50)
      sort,
      limit: limit ?? this.options.query?.limit ?? DEFAULT_PAGE_SIZE,
      offset: offset ?? 0,
      page:
        offset !== undefined && limit
          ? Math.floor(offset / limit) + 1
          : 1,
      cache: 0,
    };

    return { query: {}, options: this.options, parsed };
  }

  /** ?select=col1,col2  (renaming/casting/embeds are #50/#54). */
  private parseSelect(select: unknown): string[] {
    if (typeof select !== 'string' || select.trim() === '') return [];
    return select
      .split(',')
      .map(s => s.trim())
      // strip embeds `rel(...)` for the core field list; plain columns only.
      .filter(s => s.length > 0 && !s.includes('('))
      .map(s => {
        // drop a `::type` cast first, then take the column from an
        // `alias:column` rename (the column is what we select).
        const noCast = s.split('::')[0];
        const parts = noCast.split(':');
        return parts[parts.length - 1].trim();
      });
  }

  /** ?order=col.desc.nullslast,col2.asc */
  private parseOrder(order: unknown): SortCondition[] {
    if (order === undefined || order === null) return [];
    const items = Array.isArray(order) ? order : String(order).split(',');
    const result: SortCondition[] = [];
    for (const raw of items) {
      const parts = String(raw).trim().split('.');
      if (!parts[0]) continue;
      const field = parts[0];
      let dir: 'ASC' | 'DESC' = 'ASC';
      let nulls: 'NULLS FIRST' | 'NULLS LAST' | undefined;
      for (const mod of parts.slice(1)) {
        const m = mod.toLowerCase();
        if (m === 'asc') dir = 'ASC';
        else if (m === 'desc') dir = 'DESC';
        else if (m === 'nullsfirst') nulls = 'NULLS FIRST';
        else if (m === 'nullslast') nulls = 'NULLS LAST';
        else throw new RequestQueryException(`Invalid order modifier: ${mod}`);
      }
      result.push(nulls ? { field, order: dir, nulls } : { field, order: dir });
    }
    return result;
  }

  private parsePagination(query: any): { limit?: number; offset?: number } {
    const out: { limit?: number; offset?: number } = {};
    if (query.limit !== undefined) {
      const n = parseInt(query.limit, 10);
      if (isNaN(n)) throw new RequestQueryException('Invalid limit');
      out.limit = Math.min(n, this.options.query?.maxLimit ?? DEFAULT_MAX_LIMIT);
    }
    if (query.offset !== undefined) {
      const n = parseInt(query.offset, 10);
      if (isNaN(n)) throw new RequestQueryException('Invalid offset');
      out.offset = n;
    }
    return out;
  }

  /** Every non-reserved query key is a column filter: ?column=op.value */
  private parseFilters(query: any, params: any): FilterCondition[] {
    const result: FilterCondition[] = [];
    for (const [key, rawVal] of Object.entries(query)) {
      if (RESERVED.has(key)) continue;
      const values = Array.isArray(rawVal) ? rawVal : [rawVal];
      for (const v of values) {
        result.push(this.parseCondition(key, String(v)));
      }
    }
    return result;
  }

  /** Parse `op.value` (or `not.op.value`) for a column. */
  private parseCondition(field: string, spec: string): FilterCondition {
    const dot = spec.indexOf('.');
    if (dot === -1) {
      throw new RequestQueryException(`Invalid filter for '${field}': expected op.value`);
    }
    let op = spec.slice(0, dot);
    let rest = spec.slice(dot + 1);
    let negated = false;

    if (op === 'not') {
      negated = true;
      const dot2 = rest.indexOf('.');
      if (dot2 === -1) {
        throw new RequestQueryException(`Invalid 'not' filter for '${field}'`);
      }
      op = rest.slice(0, dot2);
      rest = rest.slice(dot2 + 1);
    }

    // `is` — is.null / is.true / is.false (is.unknown => null)
    if (op === 'is') {
      const lit = rest.toLowerCase();
      if (lit === 'null' || lit === 'unknown') {
        return { field, operator: negated ? '$notnull' : '$isnull', value: undefined };
      }
      if (lit === 'true' || lit === 'false') {
        return { field, operator: negated ? '$ne' : '$eq', value: lit === 'true' };
      }
      throw new RequestQueryException(`Invalid 'is' value for '${field}': ${rest}`);
    }

    if (op === 'in') {
      const arr = this.parseInList(rest);
      return { field, operator: negated ? '$notin' : '$in', value: arr };
    }

    if (op === 'like' || op === 'ilike') {
      // PostgREST uses * as the % wildcard.
      const pattern = rest.replace(/\*/g, '%');
      const operator = negated ? NOT_MAP[op] : OP_MAP[op];
      return { field, operator, value: pattern };
    }

    const mapped = negated ? NOT_MAP[op] : OP_MAP[op];
    if (!mapped) {
      throw new RequestQueryException(`Unsupported PostgREST operator '${op}' for '${field}'`);
    }
    return { field, operator: mapped, value: this.coerce(rest) };
  }

  /** in.(1,2,3) or in.("a,b",c) */
  private parseInList(rest: string): any[] {
    let inner = rest.trim();
    if (inner.startsWith('(') && inner.endsWith(')')) {
      inner = inner.slice(1, -1);
    }
    if (inner === '') return [];
    // split on commas not inside quotes
    const out: any[] = [];
    let cur = '';
    let quoted = false;
    for (const ch of inner) {
      if (ch === '"') { quoted = !quoted; continue; }
      if (ch === ',' && !quoted) { out.push(this.coerce(cur)); cur = ''; continue; }
      cur += ch;
    }
    out.push(this.coerce(cur));
    return out;
  }

  private coerce(v: string): any {
    const t = v.trim();
    if (t === 'null') return null;
    const n = Number(t);
    if (t !== '' && !isNaN(n)) return n;
    if (t.toLowerCase() === 'true') return true;
    if (t.toLowerCase() === 'false') return false;
    return t;
  }

  /** Route params (e.g. /:id) — configured params only, like the nestjsx parser. */
  private parseParams(params: any): FilterCondition[] {
    const result: FilterCondition[] = [];
    const configured = this.options.params;
    for (const [key, value] of Object.entries(params || {})) {
      if (value === undefined || value === null) continue;
      const cfg = configured?.[key];
      if (configured && !cfg) continue;
      if (!configured && key !== 'id') continue;
      const field = cfg?.field || key;
      const raw = String(value);
      const parsed = cfg?.type === 'string' || cfg?.type === 'uuid' ? raw : this.coerce(raw);
      result.push({ field, operator: '$eq', value: parsed });
    }
    return result;
  }

  /**
   * Merge conditions + auth into the shared search tree. Multiple filters
   * are ANDed (PostgREST default); auth.filter is ANDed at the top so it
   * can never be widened (same guarantee as the nestjsx path).
   */
  private buildSearchTree(
    conditions: FilterCondition[],
    authContext: { filter?: SearchCondition; or?: SearchCondition },
  ): SearchCondition {
    const and: SearchCondition[] = conditions.map(c => ({ [c.field]: { [c.operator]: c.value } }));
    const paramsAnd: SearchCondition[] = [];
    if (authContext.or) {
      return and.length > 0 ? { $or: [authContext.or, { $and: and }] } : { $or: [authContext.or] };
    }
    if (authContext.filter) and.unshift(authContext.filter);
    void paramsAnd;
    if (and.length === 0) return {};
    if (and.length === 1) return and[0];
    return { $and: and };
  }
}


export function createPostgrestParser(options?: CrudRequestOptions): PostgrestRequestParser {
  return new PostgrestRequestParser(options);
}

export function parsePostgrest(
  query: any,
  params: any = {},
  options?: CrudRequestOptions,
): ParsedRequest {
  return new PostgrestRequestParser(options).parse(query, params);
}
