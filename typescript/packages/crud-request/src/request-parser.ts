/**
 * CRUD Request Parser
 *
 * This parser handles all nestjsx/crud query parameter formats and converts them
 * into structured ParsedRequest objects for use by CRUD services.
 */

import {
  ParsedRequest,
  CrudRequestQuery,
  FilterCondition,
  SearchCondition,
  SortCondition,
  JoinCondition,
  FilterOperator,
  CrudRequestOptions,
  DEFAULT_PAGE_SIZE,
  DEFAULT_MAX_LIMIT
} from '@apso/crud-core';

export class CrudRequestParser {
  private options: CrudRequestOptions;

  constructor(options: CrudRequestOptions = {}) {
    this.options = {
      query: {
        limit: DEFAULT_PAGE_SIZE,
        maxLimit: DEFAULT_MAX_LIMIT,
        alwaysPaginate: false,
        ...options.query
      },
      ...options
    };
  }

  /**
   * Parse HTTP query parameters into a structured ParsedRequest
   *
   * `authContext` carries pre-evaluated auth conditions (from the
   * interceptor's CrudAuthOptions handling). Mirroring nestjsx/crud, the
   * final parsed.search is a single tree:
   *   auth.or  ? { $or: [authOr, { $and: [...] }] }
   *            : { $and: [authFilter, paramsSearch..., optionsFilter, querySearch] }
   * so services build WHERE from parsed.search alone and user-supplied
   * params can never widen an auth filter.
   */
  parse(
    query: any,
    params: any = {},
    authContext: { filter?: SearchCondition; or?: SearchCondition; persist?: Record<string, any> } = {}
  ): ParsedRequest {
    const parsedQuery = this.parseQuery(query);
    const parsedParams = this.parseParams(params);

    const search = this.buildSearchTree(parsedQuery, parsedParams, authContext);

    return {
      query: parsedQuery,
      options: this.options,
      parsed: {
        fields: parsedQuery.fields || [],
        paramsFilter: parsedParams,
        authPersist: authContext.persist || undefined,
        search,
        filter: parsedQuery.filter || [],
        or: parsedQuery.or || [],
        join: parsedQuery.join || [],
        sort: parsedQuery.sort || [],
        limit: parsedQuery.limit || this.options.query?.limit || DEFAULT_PAGE_SIZE,
        offset: parsedQuery.offset || 0,
        page: parsedQuery.page || 1,
        cache: parsedQuery.cache || 0
      }
    };
  }

  /**
   * Merge params, options filter, query search/filter/or, and auth
   * conditions into the single nestjsx-shaped search tree.
   */
  private buildSearchTree(
    parsedQuery: CrudRequestQuery,
    paramsFilter: FilterCondition[],
    authContext: { filter?: SearchCondition; or?: SearchCondition }
  ): SearchCondition {
    const and: SearchCondition[] = [];

    // Route params (e.g. :id) always constrain the query
    paramsFilter.forEach(c => and.push(this.conditionToSearch(c)));

    // Server-side default filters from options.query.filter
    const optionsFilter = this.options.query?.filter;
    if (Array.isArray(optionsFilter)) {
      optionsFilter.forEach((c: any) => {
        if (c && c.field && c.operator) and.push(this.conditionToSearch(c));
      });
    } else if (optionsFilter && typeof optionsFilter === 'object') {
      and.push(optionsFilter as SearchCondition);
    }

    // Query-string conditions: `s` wins over filter/or, per nestjsx
    const querySearch = this.querySearch(parsedQuery);
    if (querySearch) and.push(querySearch);

    if (authContext.or) {
      // auth.or is ORed against everything else
      return and.length > 0
        ? { $or: [authContext.or, { $and: and }] }
        : { $or: [authContext.or] };
    }

    if (authContext.filter) and.unshift(authContext.filter);

    if (and.length === 0) return {};
    if (and.length === 1) return and[0];
    return { $and: and };
  }

  /**
   * The filter/or truth table from nestjsx/crud:
   * - s present: s (filter/or ignored)
   * - filter & or: (AND filters) OR (AND ors)
   * - filter only: AND filters
   * - or only: OR ors
   */
  private querySearch(parsedQuery: CrudRequestQuery): SearchCondition | null {
    if (parsedQuery.search && Object.keys(parsedQuery.search).length > 0) {
      return parsedQuery.search;
    }
    const filters = (parsedQuery.filter || []).map(c => this.conditionToSearch(c));
    const ors = (parsedQuery.or || []).map(c => this.conditionToSearch(c));

    if (filters.length > 0 && ors.length > 0) {
      const left = filters.length === 1 ? filters[0] : { $and: filters };
      const right = ors.length === 1 ? ors[0] : { $and: ors };
      return { $or: [left, right] };
    }
    if (filters.length > 0) {
      return filters.length === 1 ? filters[0] : { $and: filters };
    }
    if (ors.length > 0) {
      return ors.length === 1 ? ors[0] : { $or: ors };
    }
    return null;
  }

  /** Convert a FilterCondition into its search-object form */
  private conditionToSearch(c: FilterCondition): SearchCondition {
    return { [c.field]: { [c.operator]: c.value } };
  }

  /**
   * Parse query parameters
   */
  private parseQuery(query: any): CrudRequestQuery {
    const result: CrudRequestQuery = {};

    // Parse fields
    if (query.fields) {
      result.fields = this.parseFields(query.fields);
    }

    // Parse filters
    if (query.filter) {
      result.filter = this.parseFilters(query.filter);
    }

    // Parse OR filters
    if (query.or) {
      result.or = this.parseFilters(query.or);
    }

    // Parse search
    if (query.s) {
      result.search = this.parseSearch(query.s);
    }

    // Parse sort
    if (query.sort) {
      result.sort = this.parseSort(query.sort);
    }

    // Parse joins
    if (query.join) {
      result.join = this.parseJoins(query.join);
    }

    // Parse pagination
    if (query.limit) {
      result.limit = Math.min(parseInt(query.limit, 10), this.options.query?.maxLimit || DEFAULT_MAX_LIMIT);
    }

    if (query.offset) {
      result.offset = parseInt(query.offset, 10);
    }

    if (query.page) {
      result.page = parseInt(query.page, 10);
      // Calculate offset from page if not explicitly provided
      if (!result.offset) {
        const limit = result.limit || this.options.query?.limit || DEFAULT_PAGE_SIZE;
        result.offset = (result.page - 1) * limit;
      }
    }

    if (query.cache) {
      result.cache = parseInt(query.cache, 10);
    }

    return result;
  }

  /**
   * Parse field selection
   * Supports: ?fields=name,status,id
   */
  private parseFields(fields: string | string[]): string[] {
    if (Array.isArray(fields)) {
      return fields.flatMap(field => field.split(','));
    }
    return fields.split(',').map(field => field.trim());
  }

  /**
   * Parse filter conditions
   * Supports multiple formats:
   * - ?filter=status||$eq||Active
   * - ?filter[0]=id||$eq||1&filter[1]=status||$ne||Inactive
   */
  private parseFilters(filters: string | string[] | any): FilterCondition[] {
    const result: FilterCondition[] = [];

    if (typeof filters === 'string') {
      const condition = this.parseFilterCondition(filters);
      if (condition) result.push(condition);
    } else if (Array.isArray(filters)) {
      filters.forEach(filter => {
        const condition = this.parseFilterCondition(filter);
        if (condition) result.push(condition);
      });
    } else if (typeof filters === 'object') {
      // Handle object format: { 0: "id||$eq||1", 1: "status||$ne||Inactive" }
      Object.values(filters).forEach(filter => {
        if (typeof filter === 'string') {
          const condition = this.parseFilterCondition(filter);
          if (condition) result.push(condition);
        }
      });
    }

    return result;
  }

  /**
   * Parse a single filter condition string
   * Format: field||operator||value, or field||operator for valueless
   * operators ($isnull / $notnull), matching nestjsx/crud.
   */
  private parseFilterCondition(filterStr: string): FilterCondition | null {
    const parts = filterStr.split('||');

    if (parts.length === 2) {
      const [field, operator] = parts;
      const op = operator.trim() as FilterOperator;
      if (op !== '$isnull' && op !== '$notnull') {
        return null;
      }
      return { field: field.trim(), operator: op, value: undefined };
    }

    if (parts.length !== 3) {
      return null;
    }

    const [field, operator, value] = parts;

    return {
      field: field.trim(),
      operator: operator.trim() as FilterOperator,
      value: this.parseValue(value, operator.trim() as FilterOperator)
    };
  }

  /**
   * Parse search conditions
   * Supports complex JSON search: ?s={"name": {"$contL": "David"}}
   */
  private parseSearch(search: string): SearchCondition {
    try {
      return JSON.parse(search);
    } catch (error) {
      console.warn('Invalid search JSON:', search);
      return {};
    }
  }

  /**
   * Parse sort conditions
   * Supports: ?sort=name,ASC&sort=id,DESC
   */
  private parseSort(sort: string | string[]): SortCondition[] {
    const result: SortCondition[] = [];
    const sortArray = Array.isArray(sort) ? sort : [sort];

    sortArray.forEach(sortStr => {
      const parts = sortStr.split(',');
      if (parts.length >= 1) {
        const field = parts[0].trim();
        const order = (parts[1]?.trim().toUpperCase() === 'DESC') ? 'DESC' : 'ASC';

        result.push({ field, order });
      }
    });

    return result;
  }

  /**
   * Parse join conditions
   * Supports multiple formats:
   * - ?join=facilities
   * - ?join[]=facilities||status
   * - ?join[]=facilities||status||on[0]=facilities.status||$eq||Archived
   */
  private parseJoins(joins: string | string[] | any): JoinCondition[] {
    const result: JoinCondition[] = [];
    const joinsArray = Array.isArray(joins) ? joins : [joins];

    joinsArray.forEach(joinStr => {
      if (typeof joinStr === 'string') {
        const joinCondition = this.parseJoinCondition(joinStr);
        if (joinCondition) result.push(joinCondition);
      }
    });

    return result;
  }

  /**
   * Parse a single join condition
   */
  private parseJoinCondition(joinStr: string): JoinCondition | null {
    // Split by || to get join parts
    const parts = joinStr.split('||');

    if (parts.length === 0) return null;

    const field = parts[0].trim();
    const joinCondition: JoinCondition = { field };

    // Parse select fields if provided
    if (parts.length > 1 && parts[1].trim()) {
      const selectPart = parts[1].trim();
      if (selectPart !== 'on') { // Skip if this is an 'on' condition
        joinCondition.select = selectPart.split(',').map(f => f.trim());
      }
    }

    // Parse ON conditions (more complex parsing would be needed for full support)
    if (joinStr.includes('||on[')) {
      // This is a simplified version - full implementation would parse the on conditions
      console.warn('Complex join ON conditions not fully implemented yet');
    }

    return joinCondition;
  }

  /**
   * Parse route parameters (e.g., :id from /users/:id).
   *
   * Matching nestjsx/crud: ONLY params configured in options.params become
   * filters. Turning arbitrary route params into WHERE conditions would
   * poison queries with non-entity params (e.g. a workspaceId path
   * segment). When no params are configured, `id` is the sole default.
   */
  private parseParams(params: any): FilterCondition[] {
    const result: FilterCondition[] = [];
    const configured = this.options.params;

    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null) return;

      const fieldMapping = configured?.[key];
      if (configured && !fieldMapping) return; // unconfigured param: ignore
      if (!configured && key !== 'id') return; // default: only :id

      const field = fieldMapping?.field || key;
      const raw = String(value);
      const parsed =
        fieldMapping?.type === 'string' || fieldMapping?.type === 'uuid'
          ? raw
          : this.parseValue(raw, '$eq');

      result.push({ field, operator: '$eq', value: parsed });
    });

    return result;
  }

  /**
   * Parse and convert values based on operator
   */
  private parseValue(value: string, operator: FilterOperator): any {
    // Handle null values
    if (value === 'null' || value === '') {
      return null;
    }

    // Handle arrays for IN operations
    if (operator === '$in' || operator === '$notin' || operator === '$inL' || operator === '$notinL') {
      return value.split(',').map(v => this.coerceScalar(v.trim()));
    }

    // NOTE: LIKE wildcard wrapping ($starts/$ends/$cont/$excl) happens in
    // the SQL builder (crud-typeorm), NOT here — matching nestjsx/crud.
    // Values arriving via the `s` JSON param never pass through this
    // method, so wrapping here would make filter= and s= behave
    // differently for the same operator.

    // Handle BETWEEN operations
    if (operator === '$between') {
      return value.split(',').map(v => this.coerceScalar(v.trim()));
    }

    return this.coerceScalar(value);
  }

  /** Coerce a raw query-string scalar: number, boolean, else string */
  private coerceScalar(value: string): any {
    const numValue = Number(value);
    if (!isNaN(numValue) && value !== '') {
      return numValue;
    }
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
    return value;
  }
}

/**
 * Factory function to create a parser with default options
 */
export function createRequestParser(options?: CrudRequestOptions): CrudRequestParser {
  return new CrudRequestParser(options);
}

/**
 * Parse query parameters using default parser
 */
export function parseRequest(query: any, params: any = {}, options?: CrudRequestOptions): ParsedRequest {
  const parser = createRequestParser(options);
  return parser.parse(query, params);
}