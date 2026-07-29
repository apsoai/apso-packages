/**
 * Core interfaces for CRUD request parsing and handling
 *
 * These interfaces define the structure of parsed CRUD requests,
 * compatible with nestjsx/crud but with enhanced type safety.
 */

export interface CrudRequestQuery {
  fields?: string[];
  filter?: FilterCondition[];
  or?: FilterCondition[];
  search?: SearchCondition;
  sort?: SortCondition[];
  join?: JoinCondition[];
  limit?: number;
  offset?: number;
  page?: number;
  cache?: number;
}

export interface FilterCondition {
  field: string;
  operator: FilterOperator;
  value: any;
}

export interface SearchCondition {
  [key: string]: any;
}

export interface SortCondition {
  field: string;
  order: 'ASC' | 'DESC';
}

export interface JoinCondition {
  field: string;
  select?: string[];
  alias?: string;
  on?: FilterCondition[];
}

export type FilterOperator =
  | '$eq'        // equals
  | '$ne'        // not equals
  | '$gt'        // greater than
  | '$lt'        // less than
  | '$gte'       // greater than or equal
  | '$lte'       // less than or equal
  | '$starts'    // starts with
  | '$ends'      // ends with
  | '$cont'      // contains
  | '$excl'      // excludes
  | '$in'        // in array
  | '$notin'     // not in array
  | '$isnull'    // is null
  | '$notnull'   // is not null
  | '$between'   // between two values
  | '$eqL'       // equals (case insensitive)
  | '$neL'       // not equals (case insensitive)
  | '$startsL'   // starts with (case insensitive)
  | '$endsL'     // ends with (case insensitive)
  | '$contL'     // contains (case insensitive)
  | '$exclL'     // excludes (case insensitive)
  | '$inL'       // in array (case insensitive)
  | '$notinL';   // not in array (case insensitive)

/**
 * The `parsed` shape of a request. nestjsx/crud-request names this
 * `ParsedRequestParams`; consumers (e.g. an overridden getSelect) import
 * that name, so it is exported as an alias below.
 */
export interface ParsedRequestParams {
  fields: string[];
  paramsFilter: FilterCondition[];
  authPersist?: any;
  classTransformOptions?: any;
  search: SearchCondition;
  filter: FilterCondition[];
  or: FilterCondition[];
  join: JoinCondition[];
  sort: SortCondition[];
  limit: number;
  offset: number;
  page: number;
  cache: number;
}

export interface ParsedRequest {
  // Optional: nestjsx's CrudRequest is { parsed, options } only. The
  // interceptor still populates query, but consumers may construct a
  // request with just parsed + options.
  query?: CrudRequestQuery;
  options: CrudRequestOptions;
  parsed: ParsedRequestParams;
}

/**
 * nestjsx/crud-request search-condition type. Alias of SearchCondition so
 * consumers importing `SCondition` from @nestjsx/crud-request keep working
 * after the import swap.
 */
export type SCondition = SearchCondition;

/**
 * Access-control options, nestjsx/crud-compatible.
 *
 * `filter` returns a SearchCondition that is ANDed at the TOP level of the
 * final search tree, so user-supplied filter/or/s params can never widen it.
 * `or` (when present) is ORed against the rest of the search tree instead.
 * `persist` returns fields force-set on create/update/replace DTOs.
 * `property` selects what is passed to the callbacks (e.g. 'user' passes
 * req.user); when omitted the whole request object is passed.
 */
export interface CrudAuthOptions {
  property?: string;
  filter?: (userOrRequest: any) => SearchCondition | void;
  or?: (userOrRequest: any) => SearchCondition | void;
  persist?: (userOrRequest: any) => Record<string, any> | void;
}

export interface CrudRequestOptions {
  query?: {
    allow?: string[];
    exclude?: string[];
    persist?: string[];
    filter?: any;
    join?: any;
    sort?: any;
    limit?: number;
    maxLimit?: number;
    alwaysPaginate?: boolean;
  };
  routes?: {
    only?: string[];
    exclude?: string[];
    // nestjsx allows per-route config keys alongside only/exclude.
    getManyBase?: any;
    getOneBase?: any;
    createOneBase?: any;
    createManyBase?: any;
    updateOneBase?: any;
    replaceOneBase?: any;
    deleteOneBase?: any;
    recoverOneBase?: any;
  };
  params?: {
    [key: string]: {
      field?: string;
      type?: 'number' | 'string' | 'uuid';
      primary?: boolean;
    };
  };
  auth?: CrudAuthOptions;
}

/**
 * nestjsx/crud `QueryOptions`: the per-controller query options object.
 * Exported so consumers that reference it (e.g. an overridden getSelect
 * signature) keep compiling after the import swap.
 */
export interface QueryOptions {
  allow?: string[];
  exclude?: string[];
  persist?: string[];
  filter?: any;
  join?: any;
  sort?: any;
  limit?: number;
  maxLimit?: number;
  alwaysPaginate?: boolean;
  cache?: number;
}