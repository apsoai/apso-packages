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
   */
  parse(query: any, params: any = {}): ParsedRequest {
    const parsedQuery = this.parseQuery(query);
    const parsedParams = this.parseParams(params);

    return {
      query: parsedQuery,
      options: this.options,
      parsed: {
        fields: parsedQuery.fields || [],
        paramsFilter: parsedParams,
        search: parsedQuery.search || {},
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
   * Format: field||operator||value
   */
  private parseFilterCondition(filterStr: string): FilterCondition | null {
    const parts = filterStr.split('||');
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
   * Parse route parameters (e.g., :id from /users/:id)
   */
  private parseParams(params: any): FilterCondition[] {
    const result: FilterCondition[] = [];

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        // Default to id field, but can be configured via options
        const fieldMapping = this.options.params?.[key];
        const field = fieldMapping?.field || key;

        result.push({
          field,
          operator: '$eq',
          value: this.parseValue(String(value), '$eq')
        });
      }
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
      return value.split(',').map(v => v.trim());
    }

    // Handle LIKE operations
    if (operator.includes('starts')) {
      return `${value}%`;
    }
    if (operator.includes('ends')) {
      return `%${value}`;
    }
    if (operator.includes('cont')) {
      return `%${value}%`;
    }

    // Handle BETWEEN operations
    if (operator === '$between') {
      return value.split(',').map(v => v.trim());
    }

    // Try to parse as number
    const numValue = Number(value);
    if (!isNaN(numValue) && value !== '') {
      return numValue;
    }

    // Try to parse as boolean
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;

    // Return as string
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