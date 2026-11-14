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
  JoinCondition,
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
  // NOT (a > b) and a <= b agree on every row, NULLs included (both drop them).
  gt: '$lte',
  gte: '$lt',
  lt: '$gte',
  lte: '$gt',
};

const unsupported = (feature: string, token: string, instead: string) =>
  new RequestQueryException(`${feature} not supported: '${token}' in select. ${instead}`);

const jsonPath = (where: string) =>
  new RequestQueryException(`JSON paths (-> and ->>) are not supported: '${where}'. Filter and order by whole columns.`);

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
    const { fields, join, fieldAliases } = this.parseSelect(query.select);
    const sort = this.parseOrder(query.order);
    const { limit, offset } = this.parsePagination(query);
    const allConditions = this.parseFilters(query, params);

    // PostgREST embedded filters (`rel.col=op.value`) shape ONLY the embedded
    // rows: every parent still returns, non-matching ones with an empty array.
    // That is a LEFT JOIN with the predicate in the JOIN ON clause, not a WHERE
    // (which would drop parents like !inner). partitionEmbeddedFilters mutates
    // `join` in place, attaching each embedded filter to its relation's `on`
    // list, and returns the root-level filters. `!inner` is handled separately (#59).
    const conditions = this.partitionEmbeddedFilters(allConditions, join);
    for (const s of sort) {
      const dot = s.field.lastIndexOf('.');
      if (dot !== -1) this.requireEmbed(s.field.slice(0, dot), join, `order=${s.field.slice(0, dot)}(${s.field.slice(dot + 1)})`);
    }

    // ?or=(c1,c2)/?and=(c1,c2) logical groups (PostgREST combinators, #56). Each
    // is ANDed with the top-level column filters, matching PostgREST semantics.
    const groups = [
      this.parseLogical(query.or, '$or'),
      this.parseLogical(query.and, '$and'),
    ].filter((g): g is SearchCondition => g !== null);

    const search = this.buildSearchTree(conditions, authContext, groups, params);

    const parsed: ParsedRequestParams = {
      fields,
      paramsFilter: this.parseParams(params),
      authPersist: authContext.persist || undefined,
      dialect: 'postgrest',
      fieldAliases: Object.keys(fieldAliases).length > 0 ? fieldAliases : undefined,
      search,
      filter: conditions,
      or: [],
      // Embedded resources map to the SAME JoinCondition[] the nestjsx join
      // path produces; @apso/crud's applyJoins enforces the identical
      // options.query.join allowlist + #17 auth, so a PostgREST embed can
      // never reach a relation the nestjsx join would deny (#50).
      join,
      sort,
      limit: limit ?? this.options.query?.limit ?? DEFAULT_PAGE_SIZE,
      offset: offset ?? 0,
      page:
        offset !== undefined && limit
          ? Math.floor(offset / limit) + 1
          : 1,
      cache: 0,
    };

    // Pass through the pagination-relevant RAW keys. The engine reads
    // req.query (not req.parsed) to decide the response shape: an offset
    // present => paginated envelope + row skip; absent => bare array (the
    // nestjsx contract, decidePagination / #32). Without this, the same
    // `?limit=&offset=` query would paginate under nestjsx but not PostgREST.
    // PostgREST has no `page` param, so page is always derived from offset.
    const rawQuery: Record<string, any> = {};
    if (query.limit !== undefined) rawQuery.limit = query.limit;
    if (query.offset !== undefined) rawQuery.offset = query.offset;

    return { query: rawQuery, options: this.options, parsed };
  }

  /**
   * ?select=col1,col2,rel(col,sub(col))
   *
   * Plain columns become the root field list; embedded resources become
   * JoinCondition[] with dotted paths (`rel`, `rel.sub`) — the exact shape
   * the nestjsx join path emits — so the shared engine applies the same
   * allowlist + auth. Handles `alias:col` rename, `col::type` cast, and
   * embed aliasing (`alias:rel(...)`). The `!inner`/`!left` request-level
   * join-type hint is stripped (deferred to #54); the allowlist governs
   * access either way.
   */
  private parseSelect(select: unknown): { fields: string[]; join: JoinCondition[]; fieldAliases: Record<string, string> } {
    if (typeof select !== 'string' || select.trim() === '') return { fields: [], join: [], fieldAliases: {} };
    return this.parseSelectTree(select, '');
  }

  private parseSelectTree(select: string, prefix: string): { fields: string[]; join: JoinCondition[]; fieldAliases: Record<string, string> } {
    const fields: string[] = [];
    const join: JoinCondition[] = [];
    const fieldAliases: Record<string, string> = {};
    for (const raw of this.splitTopLevel(select)) {
      const tok = raw.trim();
      if (tok === '') continue;
      // PostgREST select features this engine does not have. Each is refused
      // by name: answering 200 with different rows or keys would be worse.
      if (tok.startsWith('...')) throw unsupported('Spreading an embed (...rel(cols)) is', tok, 'Embed it as rel(cols) and read the nested object.');
      if (/(^|[.:])(count|sum|avg|min|max)\(\)/.test(tok)) throw unsupported('Aggregate functions are', tok, "For a row count send 'Prefer: count=exact' and read Content-Range.");
      if (tok.includes('->')) throw unsupported('JSON paths (-> and ->>) are', tok, 'Select the whole JSON column.');
      if (tok.includes('::')) throw unsupported('Casts (column::type) are', tok, 'Select the column and convert it in the client.');
      const open = tok.indexOf('(');
      if (open === -1) {
        // plain column, or an `alias:column` rename (the column is what we select).
        const parts = tok.split(':');
        const col = parts[parts.length - 1].trim();
        if (col === '*') continue; // `*` = all columns → no explicit field
        if (parts.length > 2 || !/^\w+$/.test(col)) throw new RequestQueryException(`Invalid column in select: '${tok}'`);
        fields.push(col);
        // `alias:column` renames the OUTPUT key: PostgREST returns the row
        // keyed by `alias`, not `column`. Record it (root-level only — the
        // engine renames root keys) so the engine emits `column AS alias` (#57).
        if (parts.length > 1) {
          const alias = parts[0].trim();
          if (prefix !== '') throw unsupported('Renaming a column inside an embed is', tok, 'Renames work on top-level columns only.');
          if (alias && alias !== col) fieldAliases[col] = alias;
        }
      } else {
        // embed: `relation[!hint](innerSelect)`
        const head = tok.slice(0, open);
        const inner = tok.slice(open + 1, tok.lastIndexOf(')'));
        if (head.includes(':')) throw unsupported('Embed aliases (alias:rel(...)) are', tok, 'Embed the relation under its own name.');
        if (inner.trim() === '') throw unsupported('Empty embeds (rel()) are', tok, 'List columns or use rel(*).');
        const relPart = head;
        // `!inner` makes an embedded filter a PARENT-level filter (drops
        // non-matching parents); `!left` (or no hint) is the default and keeps
        // all parents. Capture it so partitionEmbeddedFilters routes the filter
        // to WHERE (inner) vs the JOIN ON (default). See #59.
        const hint = relPart.includes('!') ? relPart.split('!')[1]?.trim().toLowerCase() : undefined;
        const rel = relPart.split('!')[0].trim();
        if (!rel) throw new RequestQueryException(`Invalid embed in select: ${tok}`);
        const path = prefix ? `${prefix}.${rel}` : rel;
        const sub = this.parseSelectTree(inner, path);
        // `rel(*)` / `rel()` → no explicit select → full leftJoinAndSelect,
        // matching a nestjsx join with no column list.
        const cond: JoinCondition =
          sub.fields.length > 0 ? { field: path, select: sub.fields } : { field: path };
        if (hint === 'inner') cond.embedInner = true;
        join.push(cond);
        join.push(...sub.join);
      }
    }
    return { fields, join, fieldAliases };
  }

  /**
   * PostgREST embedded filters (#59). A filter `rel.col=op.value` (or a deeper
   * `rel.sub.col`) whose prefix matches a joined embed shapes ONLY that embed's
   * rows: all parents still return, non-matching ones with empty arrays. That
   * is a LEFT JOIN with the predicate in the JOIN ON clause. This moves such a
   * filter onto the join's `on` list (which the engine emits into the ON) and
   * returns the remaining root-level filters for the WHERE clause.
   *
   * Exception: an embed marked `!inner` is a PARENT-level filter — its
   * predicate belongs in the WHERE (drops non-matching parents), so it stays in
   * the root conditions. That keeps `pg-embed-inner` behavior intact.
   */
  private partitionEmbeddedFilters(
    conditions: FilterCondition[],
    join: JoinCondition[],
  ): FilterCondition[] {
    const byPath = new Map<string, JoinCondition>();
    for (const j of join) byPath.set(j.field, j);

    const root: FilterCondition[] = [];
    for (const c of conditions) {
      const dot = c.field.lastIndexOf('.');
      const prefix = dot === -1 ? '' : c.field.slice(0, dot);
      const target = prefix ? byPath.get(prefix) : undefined;
      if (prefix) this.requireEmbed(prefix, join, `${c.field}=`);
      if (target && !target.embedInner) {
        // Embedded (default/`!left`) filter: predicate goes in the JOIN ON so
        // parents are preserved. Store just the column name; the engine
        // qualifies it with the join alias.
        const col = c.field.slice(dot + 1);
        (target.on ??= []).push({ field: col, operator: c.operator, value: c.value });
      } else {
        // Root filter, or `!inner` embed filter (parent-level → WHERE).
        root.push(c);
      }
    }
    return root;
  }

  /**
   * A filter or order on `rel.col` only means something when `rel` is embedded
   * in select (or always joined by the controller). Otherwise it is a 400 that
   * says so, never a SQL error.
   */
  private requireEmbed(path: string, join: JoinCondition[], what: string): void {
    if (join.some(j => j.field === path)) return;
    if ((this.options.query?.join as any)?.[path]?.eager) return;
    throw new RequestQueryException(
      `'${what}' refers to '${path}', which is not embedded. Add it to select, for example select=*,${path.split('.')[0]}(*).`,
    );
  }

  /** Split on commas that are NOT inside parentheses or double quotes. */
  private splitTopLevel(s: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = '';
    let quoted = false;
    for (const ch of s) {
      // A double-quoted value may hold commas and parentheses (PostgREST
      // reserved characters): or=(name.eq."Doe, Jane",age.gt.3).
      if (ch === '"') { quoted = !quoted; cur += ch; }
      else if (quoted) cur += ch;
      else if (ch === '(') { depth++; cur += ch; }
      else if (ch === ')') { depth--; cur += ch; }
      else if (ch === ',' && depth === 0) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    if (cur.trim() !== '') out.push(cur);
    return out;
  }

  /**
   * ?order=col.desc.nullslast,col2.asc
   * Embedded: ?order=rel(col).desc  → sort on the dotted `rel.col`, which
   * the engine resolves through the same alias registry the embed registers.
   */
  private parseOrder(order: unknown): SortCondition[] {
    if (order === undefined || order === null) return [];
    // Split at top level so `rel(col).desc,other` isn't broken inside parens.
    const items = Array.isArray(order)
      ? order.map(String)
      : this.splitTopLevel(String(order));
    const result: SortCondition[] = [];
    for (const raw of items) {
      const t = String(raw).trim();
      if (!t) continue;
      if (t.includes('->')) throw jsonPath(t);
      let field: string;
      let parts: string[];
      const open = t.indexOf('(');
      if (open !== -1) {
        // embedded order: rel(col).dir[.nullsX]
        const rel = t.slice(0, open).trim();
        const close = t.indexOf(')', open);
        if (close === -1) throw new RequestQueryException(`Invalid embedded order: ${t}`);
        const col = t.slice(open + 1, close).trim();
        if (!rel || !col) throw new RequestQueryException(`Invalid embedded order: ${t}`);
        field = `${rel}.${col}`;
        parts = [field, ...t.slice(close + 1).split('.').filter(Boolean)];
      } else {
        parts = t.split('.');
        field = parts[0];
      }
      if (!field) continue;
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
      if (key === 'not.and' || key === 'not.or') {
        throw new RequestQueryException(`Negated groups (${key}=(...)) are not supported. Negate each condition instead, for example or=(a.not.eq.1,b.not.eq.2).`);
      }
      if (key.includes('->')) throw jsonPath(key);
      const modifier = /\.(order|limit|offset|or|and)$/.exec(key);
      if (modifier) {
        throw new RequestQueryException(`'${key}' is not supported: order, limit, offset, or and and apply to the top level only, not to an embed.`);
      }
      const values = Array.isArray(rawVal) ? rawVal : [rawVal];
      for (const v of values) {
        result.push(this.parseCondition(key, String(v)));
      }
    }
    return result;
  }

  /**
   * Parse `op.value` (or `not.op.value`) for a column. Inside an or=()/and=()
   * group (`inGroup`) a value wrapped in double quotes is taken literally,
   * which is how PostgREST passes reserved characters there.
   */
  private parseCondition(field: string, spec: string, inGroup = false): FilterCondition {
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

    // Quoted value inside a group: strip the quotes and keep it a string.
    // ponytail: no \" escapes inside the quotes; add when a value needs a literal quote.
    let literal = false;
    if (inGroup && op !== 'in' && rest.length >= 2 && rest.startsWith('"') && rest.endsWith('"')) {
      rest = rest.slice(1, -1);
      literal = true;
    }

    // `is` — is.null / is.true / is.false (is.unknown => null)
    if (op === 'is') {
      const lit = rest.toLowerCase();
      if (lit === 'null' || lit === 'unknown') {
        return { field, operator: negated ? '$notnull' : '$isnull', value: undefined };
      }
      if (lit === 'not_null') {
        return { field, operator: negated ? '$isnull' : '$notnull', value: undefined };
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
    return { field, operator: mapped, value: literal ? rest : this.coerce(rest) };
  }

  /**
   * ?or=(c1.op.v1,c2.op.v2) / ?and=(...) — PostgREST logical combinators.
   * Each condition is `col.op.value` (or `col.not.op.value`); nested groups
   * `or(...)`/`and(...)` are supported recursively. Returns a `$or`/`$and`
   * SearchCondition, or null when the param is absent.
   */
  private parseLogical(raw: unknown, key: '$or' | '$and'): SearchCondition | null {
    if (raw === undefined || raw === null) return null;
    const val = Array.isArray(raw) ? String(raw[0]) : String(raw);
    return this.parseLogicalGroup(val, key);
  }

  private parseLogicalGroup(raw: string, key: '$or' | '$and'): SearchCondition {
    const label = key === '$or' ? 'or' : 'and';
    const trimmed = raw.trim();
    if (!(trimmed.startsWith('(') && trimmed.endsWith(')'))) {
      throw new RequestQueryException(`Invalid ${label}= group: expected ${label}=(cond,cond,...)`);
    }
    const parts = this.splitTopLevel(trimmed.slice(1, -1)).map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) {
      throw new RequestQueryException(`Empty ${label}= group`);
    }
    const branches: SearchCondition[] = parts.map(part => {
      if (part.startsWith('or(')) return this.parseLogicalGroup(part.slice(2), '$or');
      if (part.startsWith('and(')) return this.parseLogicalGroup(part.slice(3), '$and');
      const dot = part.indexOf('.');
      if (dot === -1) {
        throw new RequestQueryException(`Invalid condition in ${label}= group: ${part}`);
      }
      const c = this.parseCondition(part.slice(0, dot), part.slice(dot + 1), true);
      return { [c.field]: { [c.operator]: c.value } } as SearchCondition;
    });
    return { [key]: branches } as SearchCondition;
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
    groups: SearchCondition[] = [],
    params: any = {},
  ): SearchCondition {
    const and: SearchCondition[] = [];
    // Route params (/:id) always constrain the query.
    for (const c of this.parseParams(params)) and.push({ [c.field]: { [c.operator]: c.value } });
    // The controller's own query.filter always applies, as in the nestjsx parser.
    const optionsFilter = this.options.query?.filter;
    if (Array.isArray(optionsFilter)) {
      for (const c of optionsFilter) if (c && c.field && c.operator) and.push({ [c.field]: { [c.operator]: c.value } });
    } else if (optionsFilter && typeof optionsFilter === 'object') {
      and.push(optionsFilter as SearchCondition);
    }
    for (const c of conditions) and.push({ [c.field]: { [c.operator]: c.value } });
    // Logical combinators (?or=/?and=) are ANDed alongside the column filters.
    for (const g of groups) and.push(g);
    if (authContext.or) {
      return and.length > 0 ? { $or: [authContext.or, { $and: and }] } : { $or: [authContext.or] };
    }
    if (authContext.filter) and.unshift(authContext.filter);
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
