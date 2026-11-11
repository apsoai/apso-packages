/**
 * PostgREST-js–compatible query builder (sdk#26).
 *
 * A drop-in-shaped client for developers migrating off Supabase: same method
 * names and chaining as `@supabase/supabase-js`'s postgrest-js, serialized to
 * the Apso PostgREST dialect (apso-packages #36) and sent with the
 * `X-Crud-Dialect: postgrest` header. Returns the `{ data, error }` shape and
 * never throws — errors surface on `.error`.
 *
 * Scope: the DATA/query layer only. Auth/storage/realtime are out of scope
 * (Apso auth is BetterAuth, not GoTrue). Operators map to what the Apso
 * dialect supports today; array/range/full-text operators (cs/cd/ov/fts) are
 * not yet in the dialect (apso-packages #54) and throw a clear error.
 */

export interface PostgrestError {
  message: string;
  details: string | null;
  hint: string | null;
  code: string | null;
  /** The response's `x-request-id`, set on HTTP errors. */
  requestId?: string;
}

export interface PostgrestResponse<T> {
  data: T | null;
  error: PostgrestError | null;
  count: number | null;
  status: number;
  statusText: string;
}

export type PostgrestMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** Raw transport the builder calls on await. Provided by the SDK client. */
export type PostgrestExecutor = (req: {
  path: string;
  method: PostgrestMethod;
  searchParams: URLSearchParams;
  body?: unknown;
  headers: Record<string, string>;
}) => Promise<{
  data: unknown;
  error: PostgrestError | null;
  count: number | null;
  status: number;
  statusText: string;
}>;

const NOT_IN_DIALECT = (op: string) =>
  new Error(
    `.${op}() is not supported by the Apso PostgREST dialect yet (array/range/full-text ` +
      `operators — apso-packages #54). Use eq/neq/gt/gte/lt/lte/like/ilike/in/is/or/not for now.`,
  );

/**
 * Filters + transforms + await. Mirrors postgrest-js's
 * PostgrestFilterBuilder/PostgrestTransformBuilder on the read/return path.
 */
export class PostgrestFilterBuilder<T> implements PromiseLike<PostgrestResponse<T>> {
  private singleMode: false | 'single' | 'maybe' = false;

  constructor(
    private table: string,
    private method: PostgrestMethod,
    private search: URLSearchParams,
    private exec: PostgrestExecutor,
    private body: unknown | undefined,
    private wantCount: boolean,
    private hasSelect: boolean,
  ) {}

  // --- filters (append `col=op.value`) --------------------------------------
  private add(column: string, spec: string): this {
    this.search.append(column, spec);
    return this;
  }
  eq(column: string, value: unknown): this { return this.add(column, `eq.${value}`); }
  neq(column: string, value: unknown): this { return this.add(column, `neq.${value}`); }
  gt(column: string, value: unknown): this { return this.add(column, `gt.${value}`); }
  gte(column: string, value: unknown): this { return this.add(column, `gte.${value}`); }
  lt(column: string, value: unknown): this { return this.add(column, `lt.${value}`); }
  lte(column: string, value: unknown): this { return this.add(column, `lte.${value}`); }
  like(column: string, pattern: string): this { return this.add(column, `like.${pattern}`); }
  ilike(column: string, pattern: string): this { return this.add(column, `ilike.${pattern}`); }
  is(column: string, value: null | boolean): this { return this.add(column, `is.${value}`); }
  in(column: string, values: readonly unknown[]): this {
    const list = values.map(v => (typeof v === 'string' && /[,"()]/.test(v) ? `"${v}"` : String(v))).join(',');
    return this.add(column, `in.(${list})`);
  }
  /** Negated operator: `.not('status','eq','active')` → `status=not.eq.active`. */
  not(column: string, operator: string, value: unknown): this {
    return this.add(column, `not.${operator}.${value}`);
  }
  /** Generic escape hatch: `.filter('age','gte',18)` → `age=gte.18`. */
  filter(column: string, operator: string, value: unknown): this {
    return this.add(column, `${operator}.${value}`);
  }
  /** All key/values ANDed as eq — `.match({a:1,b:2})`. */
  match(query: Record<string, unknown>): this {
    for (const [k, v] of Object.entries(query)) this.eq(k, v);
    return this;
  }
  /** OR group — `.or('views.eq.100,views.eq.999')` → `or=(...)` (apso #56). */
  or(filters: string): this {
    this.search.set('or', `(${filters})`);
    return this;
  }
  /* eslint-disable @typescript-eslint/no-unused-vars */
  contains(_column: string, _value: unknown): never { throw NOT_IN_DIALECT('contains'); }
  containedBy(_column: string, _value: unknown): never { throw NOT_IN_DIALECT('containedBy'); }
  overlaps(_column: string, _value: unknown): never { throw NOT_IN_DIALECT('overlaps'); }
  textSearch(_column: string, _query: string, _opts?: { type?: 'plain' | 'phrase' | 'websearch'; config?: string }): never { throw NOT_IN_DIALECT('textSearch'); }
  /* eslint-enable @typescript-eslint/no-unused-vars */

  // --- transforms -----------------------------------------------------------
  order(column: string, opts: { ascending?: boolean; nullsFirst?: boolean } = {}): this {
    const dir = opts.ascending === false ? 'desc' : 'asc';
    const nulls = opts.nullsFirst === undefined ? '' : opts.nullsFirst ? '.nullsfirst' : '.nullslast';
    const prev = this.search.get('order');
    const next = `${column}.${dir}${nulls}`;
    this.search.set('order', prev ? `${prev},${next}` : next);
    return this;
  }
  limit(count: number): this { this.search.set('limit', String(count)); return this; }
  /** Inclusive range → offset=from, limit=to-from+1 (postgrest-js semantics). */
  range(from: number, to: number): this {
    this.search.set('offset', String(from));
    this.search.set('limit', String(to - from + 1));
    return this;
  }
  single(): this { this.singleMode = 'single'; return this; }
  maybeSingle(): this { this.singleMode = 'maybe'; return this; }
  /** Select the columns returned after a write (insert/update/…). */
  select(columns = '*'): this {
    this.search.set('select', columns);
    this.hasSelect = true;
    return this;
  }

  /** The query built so far, as it goes on the wire. */
  toSearchParams(): URLSearchParams {
    return this.search;
  }

  // --- await ----------------------------------------------------------------
  then<R1 = PostgrestResponse<T>, R2 = never>(
    onfulfilled?: ((v: PostgrestResponse<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<PostgrestResponse<T>> {
    const headers: Record<string, string> = { 'X-Crud-Dialect': 'postgrest' };
    const prefer: string[] = [];
    if (this.wantCount) prefer.push('count=exact');
    // A write that also selects wants the affected rows back.
    if (this.method !== 'GET' && this.hasSelect) prefer.push('return=representation');
    if (prefer.length) headers['Prefer'] = prefer.join(',');

    const res = await this.exec({
      path: `/${this.table}`,
      method: this.method,
      searchParams: this.search,
      body: this.body,
      headers,
    });

    if (res.error) return { data: null, error: res.error, count: res.count, status: res.status, statusText: res.statusText };

    let data = res.data as unknown;
    if (this.singleMode) {
      const rows = Array.isArray(data) ? data : data == null ? [] : [data];
      if (rows.length === 1) {
        data = rows[0];
      } else if (rows.length === 0) {
        if (this.singleMode === 'single') {
          return {
            data: null,
            error: { message: 'Row not found', details: 'Results contain 0 rows, single() expects exactly 1', hint: null, code: 'PGRST116' },
            count: res.count, status: 406, statusText: 'Not Acceptable',
          };
        }
        data = null; // maybeSingle → null on zero rows
      } else {
        return {
          data: null,
          error: { message: 'Multiple rows returned', details: `Results contain ${rows.length} rows, ${this.singleMode === 'single' ? 'single()' : 'maybeSingle()'} expects at most 1`, hint: null, code: 'PGRST116' },
          count: res.count, status: 406, statusText: 'Not Acceptable',
        };
      }
    }
    return { data: data as T, error: null, count: res.count, status: res.status, statusText: res.statusText };
  }
}

/**
 * Entry builder returned by `client.from(table)`. Picks the verb; each returns
 * a PostgrestFilterBuilder so filters/transforms/await chain uniformly.
 */
export class PostgrestQueryBuilder {
  constructor(private table: string, private exec: PostgrestExecutor) {}

  select<T = any>(columns = '*', opts: { count?: 'exact' } = {}): PostgrestFilterBuilder<T[]> {
    const search = new URLSearchParams();
    if (columns && columns !== '*') search.set('select', columns);
    return new PostgrestFilterBuilder<T[]>(this.table, 'GET', search, this.exec, undefined, opts.count === 'exact', true);
  }

  insert<T = any>(values: unknown | unknown[]): PostgrestFilterBuilder<T[]> {
    return new PostgrestFilterBuilder<T[]>(this.table, 'POST', new URLSearchParams(), this.exec, values, false, false);
  }

  update<T = any>(values: Record<string, unknown>): PostgrestFilterBuilder<T[]> {
    return new PostgrestFilterBuilder<T[]>(this.table, 'PATCH', new URLSearchParams(), this.exec, values, false, false);
  }

  delete<T = any>(): PostgrestFilterBuilder<T[]> {
    return new PostgrestFilterBuilder<T[]>(this.table, 'DELETE', new URLSearchParams(), this.exec, undefined, false, false);
  }

  /**
   * upsert is not yet supported by the Apso PostgREST dialect (needs
   * Prefer: resolution=merge-duplicates server-side). Tracked separately.
   */
  upsert(): never {
    throw new Error('upsert() is not supported by the Apso PostgREST dialect yet. Use insert() or update().');
  }
}

// ---------------------------------------------------------------------------
// entity() / get() query params -> PostgREST
// ---------------------------------------------------------------------------

/** The `entity()` / `get()` query shape (kept from the nestjsx days). */
export interface EntityQueryParams {
  fields?: string[];
  filter?: Record<string, any>;
  or?: Record<string, any>;
  join?: string[];
  sort?: Record<string, 'ASC' | 'DESC'>;
  limit?: number;
  offset?: number;
  page?: number;
  cache?: boolean;
}

const never: PostgrestExecutor = async () => {
  throw new Error('not executed');
};
const scratch = () => new PostgrestQueryBuilder('', never).select<any>();

/** One `{ field: { $op: value } }` entry, applied through the from() builder. */
function applyOperator(b: PostgrestFilterBuilder<any>, field: string, op: string, v: any): void {
  switch (op) {
    case '$eq': v === null ? b.is(field, null) : b.eq(field, v); break;
    case '$ne': v === null ? b.not(field, 'is', null) : b.neq(field, v); break;
    case '$gt': b.gt(field, v); break;
    case '$gte': b.gte(field, v); break;
    case '$lt': b.lt(field, v); break;
    case '$lte': b.lte(field, v); break;
    case '$starts': b.like(field, `${v}*`); break;
    case '$ends': b.like(field, `*${v}`); break;
    case '$cont': b.like(field, `*${v}*`); break;
    case '$excl': b.not(field, 'like', `*${v}*`); break;
    case '$startsL': b.ilike(field, `${v}*`); break;
    case '$endsL': b.ilike(field, `*${v}`); break;
    case '$contL': b.ilike(field, `*${v}*`); break;
    case '$exclL': b.not(field, 'ilike', `*${v}*`); break;
    case '$eqL': b.ilike(field, String(v)); break;
    case '$neL': b.not(field, 'ilike', v); break;
    case '$in': b.in(field, v); break;
    case '$notin': {
      // Reuse in()'s list quoting, then negate it.
      const list = scratch().in(field, v).toSearchParams().get(field) as string;
      b.filter(field, 'not', list);
      break;
    }
    case '$notinL': for (const item of v) b.not(field, 'ilike', item); break;
    case '$isnull': b.is(field, null); break;
    case '$notnull': b.not(field, 'is', null); break;
    case '$between': b.gte(field, v[0]).lte(field, v[1]); break;
    default:
      throw new Error(
        `Operator '${op}' on '${field}' has no PostgREST form in entity()/get(). ` +
          (op === '$inL' ? "Use from(table).or('col.ilike.a,col.ilike.b')." : 'Use the from() builder.'),
      );
  }
}

/** `{ field: value | { $op: value } }` as [column, 'op.value'] pairs. */
function conditions(where: Record<string, any> | undefined): Array<[string, string]> {
  const b = scratch();
  for (const [field, value] of Object.entries(where ?? {})) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const [op, v] of Object.entries(value)) applyOperator(b, field, op, v);
    } else {
      applyOperator(b, field, '$eq', value);
    }
  }
  return [...b.toSearchParams().entries()];
}

/** `col`, `op.value` as one condition inside or=(...): a value with a reserved character is quoted. */
function grouped([column, spec]: [string, string]): string {
  const m = /^((?:not\.)?[a-z]+)\.([\s\S]*)$/.exec(spec);
  if (!m || /(^|\.)(in|is)$/.test(m[1]) || !/[,()"]/.test(m[2])) return `${column}.${spec}`;
  return `${column}.${m[1]}."${m[2]}"`;
}

/**
 * Serialize entity()/get() query params as a PostgREST query, through the
 * from() builder. nestjsx semantics are kept where PostgREST has a form:
 * a filter on a joined column drops parents (the embed becomes !inner), and
 * `or` next to `filter` means (all filters) OR (all ors).
 */
export function entityParamsToPostgrest(params: EntityQueryParams): URLSearchParams {
  const filters = conditions(params.filter);
  const ors = conditions(params.or);

  // join: ['posts', 'posts.comments', 'author||name'] -> posts(*,comments(*)),author(name)
  type Embed = { columns: string[]; children: Map<string, Embed>; inner: boolean };
  const root: Embed = { columns: [], children: new Map(), inner: false };
  const embedAt = (path: string): Embed => {
    let node = root;
    for (const segment of path.split('.')) {
      if (!node.children.has(segment)) node.children.set(segment, { columns: [], children: new Map(), inner: false });
      node = node.children.get(segment) as Embed;
    }
    return node;
  };
  for (const join of params.join ?? []) {
    const [path, columns] = join.split('||');
    const node = embedAt(path);
    if (columns) node.columns = columns.split(',');
  }
  const joined = (path: string) => path.split('.').reduce<Embed | undefined>((n, s) => n?.children.get(s), root);
  // A filter on a joined column was a WHERE in nestjsx: parents without a match are dropped.
  for (const [column] of [...filters, ...ors]) {
    const dot = column.lastIndexOf('.');
    if (dot === -1 || !joined(column.slice(0, dot))) continue;
    const segments = column.slice(0, dot).split('.');
    segments.forEach((_, i) => { (joined(segments.slice(0, i + 1).join('.')) as Embed).inner = true; });
  }
  const render = (node: Embed): string[] =>
    [...node.children].map(([name, child]) =>
      `${name}${child.inner ? '!inner' : ''}(${[child.columns.length ? child.columns.join(',') : '*', ...render(child)].join(',')})`,
    );
  const embeds = render(root);
  const columns = params.fields?.length ? params.fields.join(',') : embeds.length ? '*' : '';
  const select = [columns, ...embeds].filter(Boolean).join(',');

  const b = new PostgrestQueryBuilder('', never).select<any>(select || '*');
  if (ors.length === 0) {
    for (const [column, spec] of filters) b.toSearchParams().append(column, spec);
  } else if (filters.length === 0) {
    b.or(ors.map(grouped).join(','));
  } else {
    b.or(`and(${filters.map(grouped).join(',')}),and(${ors.map(grouped).join(',')})`);
  }

  for (const [field, direction] of Object.entries(params.sort ?? {})) {
    const dot = field.lastIndexOf('.');
    b.order(dot === -1 ? field : `${field.slice(0, dot)}(${field.slice(dot + 1)})`, { ascending: direction !== 'DESC' });
  }

  if (params.limit !== undefined) b.limit(params.limit);
  if (params.offset !== undefined) {
    b.toSearchParams().set('offset', String(params.offset));
  } else if (params.page !== undefined) {
    if (params.limit === undefined) {
      throw new Error('page() needs limit(): PostgREST pages by offset, and offset = (page - 1) * limit.');
    }
    b.toSearchParams().set('offset', String((params.page - 1) * params.limit));
  }
  return b.toSearchParams();
}
