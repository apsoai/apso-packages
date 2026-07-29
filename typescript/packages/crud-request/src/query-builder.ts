/**
 * Client-safe query BUILDER — the inverse of the parser in this package.
 *
 * Produces the nestjsx/crud query-string format (`?fields=…&filter=field||$op||value…`)
 * that CrudRequestParser consumes, so a client (the @apso/sdk) can build a
 * request URL that any Apso backend parses byte-for-byte. This is the
 * first-party replacement for `@dataui/crud-request`'s RequestQueryBuilder,
 * with the same method surface the SDK uses. No @nestjs / server dependency.
 *
 * Round-trip guarantee: for every builder call, the emitted string, once
 * URL-decoded by the HTTP layer, parses back through CrudRequestParser to the
 * equivalent ParsedRequest (see query-builder.spec.ts).
 */

/**
 * Comparison operators, matching `@dataui/crud-request`'s CondOperator API
 * (unprefixed values). The parser accepts both these and the `$`-prefixed
 * forms, so either flows through unchanged.
 */
export enum CondOperator {
  EQUALS = 'eq',
  NOT_EQUALS = 'ne',
  GREATER_THAN = 'gt',
  LOWER_THAN = 'lt',
  GREATER_THAN_EQUALS = 'gte',
  LOWER_THAN_EQUALS = 'lte',
  STARTS = 'starts',
  ENDS = 'ends',
  CONTAINS = 'cont',
  EXCLUDES = 'excl',
  IN = 'in',
  NOT_IN = 'notin',
  IS_NULL = 'isnull',
  NOT_NULL = 'notnull',
  BETWEEN = 'between',
  EQUALS_LOW = 'eqL',
  NOT_EQUALS_LOW = 'neL',
  STARTS_LOW = 'startsL',
  ENDS_LOW = 'endsL',
  CONTAINS_LOW = 'contL',
  EXCLUDES_LOW = 'exclL',
  IN_LOW = 'inL',
  NOT_IN_LOW = 'notinL',
}

/** A single field condition (filter or or). */
export interface QueryFilter {
  field: string;
  operator: CondOperator | string;
  value?: any;
}

/** A join with an optional per-relation column selection. */
export interface QueryJoin {
  field: string;
  select?: string[];
}

/** A sort clause. */
export interface QuerySort {
  field: string;
  order: 'ASC' | 'DESC';
}

/** Operators that take no value (serialized as `field||op`). */
const VALUELESS = new Set(['isnull', 'notnull', '$isnull', '$notnull']);

export class RequestQueryBuilder {
  private fieldsList: string[] = [];
  private filters: QueryFilter[] = [];
  private ors: QueryFilter[] = [];
  private joins: QueryJoin[] = [];
  private sorts: QuerySort[] = [];
  private limitVal?: number;
  private offsetVal?: number;
  private pageVal?: number;
  private cacheVal?: number;

  static create(): RequestQueryBuilder {
    return new RequestQueryBuilder();
  }

  /** ?fields=a,b,c */
  select(fields: string[]): this {
    this.fieldsList = fields;
    return this;
  }

  setFilter(filter: QueryFilter): this {
    this.filters.push(filter);
    return this;
  }

  setOr(or: QueryFilter): this {
    this.ors.push(or);
    return this;
  }

  setJoin(join: QueryJoin): this {
    this.joins.push(join);
    return this;
  }

  sortBy(sort: QuerySort): this {
    this.sorts.push(sort);
    return this;
  }

  setLimit(n: number): this {
    this.limitVal = n;
    return this;
  }

  setOffset(n: number): this {
    this.offsetVal = n;
    return this;
  }

  setPage(n: number): this {
    this.pageVal = n;
    return this;
  }

  /** Disable caching for this request (?cache=0). */
  resetCache(): this {
    this.cacheVal = 0;
    return this;
  }

  /** Serialize to a query string (no leading `?`). */
  query(): string {
    const parts: string[] = [];

    if (this.fieldsList.length > 0) {
      parts.push(`fields=${this.fieldsList.map(enc).join(',')}`);
    }
    for (const f of this.filters) parts.push(`filter=${cond(f)}`);
    for (const o of this.ors) parts.push(`or=${cond(o)}`);
    for (const j of this.joins) parts.push(`join=${join(j)}`);
    for (const s of this.sorts) parts.push(`sort=${enc(s.field)},${s.order}`);
    if (this.limitVal !== undefined) parts.push(`limit=${this.limitVal}`);
    if (this.offsetVal !== undefined) parts.push(`offset=${this.offsetVal}`);
    if (this.pageVal !== undefined) parts.push(`page=${this.pageVal}`);
    if (this.cacheVal !== undefined) parts.push(`cache=${this.cacheVal}`);

    return parts.join('&');
  }
}

/** URL-encode a token but keep dotted paths readable (`.` is unreserved). */
function enc(s: string): string {
  return encodeURIComponent(s);
}

/** Serialize a value: arrays ($in/$between) become comma-joined encoded lists. */
function encVal(value: any): string {
  if (Array.isArray(value)) return value.map(v => enc(String(v))).join(',');
  return enc(String(value));
}

/** field||op[||value] — value omitted for the valueless operators. */
function cond(c: QueryFilter): string {
  const op = String(c.operator);
  if (VALUELESS.has(op)) return `${enc(c.field)}||${op}`;
  return `${enc(c.field)}||${op}||${encVal(c.value)}`;
}

/** field[||sel1,sel2] */
function join(j: QueryJoin): string {
  if (j.select && j.select.length > 0) {
    return `${enc(j.field)}||${j.select.map(enc).join(',')}`;
  }
  return enc(j.field);
}

export function createQueryBuilder(): RequestQueryBuilder {
  return RequestQueryBuilder.create();
}
