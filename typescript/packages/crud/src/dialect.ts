/**
 * Dialect detection for the dual-dialect CrudRequestInterceptor (#51).
 *
 * A request is parsed by EITHER the nestjsx parser (@apso/crud-request) or the
 * PostgREST parser (@apso/postgrest-request). This picks which, by an explicit
 * header override or by the shape of the query params. Detection rules are
 * documented in docs/DIALECTS.md.
 *
 * Precedence:
 *   1. `X-Crud-Dialect: postgrest|nestjsx` header — explicit, always wins.
 *      Any other value is a 400 (RequestQueryException), never a silent guess.
 *   2. Param-shape signals:
 *        - nestjsx-only keys: fields, filter, or, join, sort, s, per_page
 *          (`or=(...)` in parentheses is PostgREST's logical group instead)
 *        - PostgREST-only keys: select, order
 *        - a bare `col=op.value` param (value matches a PostgREST operator) is
 *          a PostgREST signal
 *        - limit / offset / page / cache are dialect-neutral (shared)
 *        - any other unknown param is neutral (does not force a dialect)
 *   3. Both families present => genuine collision => 400 (do NOT guess).
 *   4. Only PostgREST signals => postgrest.
 *   5. Otherwise (nestjsx signals, or neutral-only, or empty) => nestjsx, the
 *      incumbent dialect. This keeps every existing request byte-identical.
 */
import { RequestQueryException } from '@apso/crud-core';

export type Dialect = 'nestjsx' | 'postgrest';

/** Query keys that only the nestjsx dialect uses. */
const NESTJSX_KEYS = new Set(['fields', 'filter', 'or', 'join', 'sort', 's', 'per_page']);

/** Query keys that only the PostgREST dialect uses. */
const POSTGREST_KEYS = new Set(['select', 'order']);

/** Keys shared by both dialects — never a signal either way. */
const NEUTRAL_KEYS = new Set(['limit', 'offset', 'page', 'cache']);

/**
 * A bare PostgREST column filter value: `op.value` or `not.op.value`. The
 * operator set mirrors PostgREST's; unknown operators are handled by the
 * parser (400), detection only needs to recognize the SHAPE.
 */
const POSTGREST_OP = /^(not\.)?(eq|neq|gt|gte|lt|lte|like|ilike|match|imatch|in|is|isdistinct|fts|plfts|phfts|wfts|cs|cd|ov|sl|sr|nxr|nxl|adj)\./i;

/** A PostgREST logical group value: `(cond,cond,...)`. */
function isPostgrestGroup(raw: unknown): boolean {
  const val = Array.isArray(raw) ? raw[0] : raw;
  return typeof val === 'string' && val.trim().startsWith('(');
}

export function detectDialect(
  query: Record<string, any> | undefined,
  dialectHeader?: string | string[],
): Dialect {
  // 1. Explicit header override — always wins.
  const header = Array.isArray(dialectHeader) ? dialectHeader[0] : dialectHeader;
  if (header !== undefined && header !== null && String(header).trim() !== '') {
    const h = String(header).trim().toLowerCase();
    if (h === 'postgrest' || h === 'nestjsx') return h;
    throw new RequestQueryException(
      `Invalid X-Crud-Dialect header '${header}' (expected 'postgrest' or 'nestjsx').`,
    );
  }

  // 2. Param-shape signals.
  let nestjsx = false;
  let postgrest = false;
  for (const key of Object.keys(query || {})) {
    if (key === 'or' && isPostgrestGroup((query as any)[key])) {
      // `or` exists in both dialects: PostgREST writes or=(a.eq.1,b.eq.2),
      // nestjsx writes or=a||$eq||1. Only the parenthesised form is PostgREST.
      postgrest = true;
    } else if (NESTJSX_KEYS.has(key)) {
      nestjsx = true;
    } else if (POSTGREST_KEYS.has(key)) {
      postgrest = true;
    } else if (NEUTRAL_KEYS.has(key)) {
      continue;
    } else {
      // Unknown key: a PostgREST `col=op.value` is the only bare-param dialect
      // signal (nestjsx never puts column filters directly in the query key).
      const raw = (query as any)[key];
      const val = Array.isArray(raw) ? raw[0] : raw;
      if (typeof val === 'string' && POSTGREST_OP.test(val)) postgrest = true;
    }
  }

  // 3. Genuine collision — refuse to guess.
  if (nestjsx && postgrest) {
    throw new RequestQueryException(
      'Ambiguous query: it mixes nestjsx params (fields/filter/join/sort/s/or) with ' +
        'PostgREST params (select/order or col=op.value). Send a single dialect, or set ' +
        "the 'X-Crud-Dialect' header to force one.",
    );
  }

  // 4/5. One family, or neutral-only/empty (default to the incumbent nestjsx).
  return postgrest ? 'postgrest' : 'nestjsx';
}

/** Every dialect. The default when neither the controller nor the app narrows it. */
export const ALL_DIALECTS: readonly Dialect[] = ['nestjsx', 'postgrest'];

let appDialects: readonly Dialect[] | undefined;

/**
 * App-wide default for the dialects every @Crud controller accepts. Call it
 * once at start-up, before the app listens:
 *
 *   setAcceptedDialects(['postgrest']);
 *
 * A controller's own `dialects` option wins over it. Call with no argument to
 * go back to accepting both.
 */
export function setAcceptedDialects(dialects?: readonly Dialect[]): void {
  appDialects = dialects && dialects.length > 0 ? [...dialects] : undefined;
}

/**
 * What to send instead of each nestjsx parameter. Used for the 400 a
 * PostgREST-only route gives a nestjsx request.
 */
const POSTGREST_EQUIVALENT: Record<string, string> = {
  fields: 'select, for example select=id,name',
  filter: 'a column filter, for example age=gt.30 in place of filter=age||$gt||30',
  or: 'or=(...), for example or=(age.lt.18,age.gt.65)',
  join: 'an embed in select, for example select=*,posts(title) in place of join=posts||title',
  sort: 'order, for example order=age.desc in place of sort=age,DESC',
  s: 'column filters with or=(...) and and=(...) groups, for example or=(age.lt.18,and(age.gte.65,active.is.true))',
  per_page: 'limit',
  page: 'limit and offset, where offset = (page - 1) * limit',
  cache: 'nothing. PostgREST has no cache parameter, remove it',
};

/** True when `key=value` is nestjsx syntax and cannot be a PostgREST param. */
function isNestjsxParam(key: string, raw: unknown): boolean {
  if (!(key in POSTGREST_EQUIVALENT)) return false;
  // PostgREST's own or=(...) group.
  if (key === 'or') return !isPostgrestGroup(raw);
  const val = Array.isArray(raw) ? raw[0] : raw;
  // A column that happens to be called `page`, `sort`, ... filtered the
  // PostgREST way (`page=eq.2`) is a column filter, not a nestjsx param.
  return !(typeof val === 'string' && POSTGREST_OP.test(val));
}

/**
 * The dialect that parses this request, given the dialects the route accepts
 * (the controller's `dialects` option, else setAcceptedDialects, else both).
 *
 * Both accepted: detectDialect decides, as before.
 *
 * One accepted: detection is skipped and that dialect parses every request.
 * An X-Crud-Dialect header naming the other one is a 400. On a PostgREST-only
 * route a nestjsx parameter is a 400 that names the parameter and its
 * PostgREST equivalent, so a request is never half understood.
 */
export function resolveDialect(
  query: Record<string, any> | undefined,
  dialectHeader?: string | string[],
  accepted?: readonly Dialect[],
): Dialect {
  const allowed = accepted && accepted.length > 0 ? accepted : appDialects ?? ALL_DIALECTS;
  if (ALL_DIALECTS.every(d => allowed.includes(d))) return detectDialect(query, dialectHeader);

  const only = allowed[0];
  // Reuses the header validation: an unknown value is a 400 either way.
  const header = Array.isArray(dialectHeader) ? dialectHeader[0] : dialectHeader;
  if (header !== undefined && header !== null && String(header).trim() !== '') {
    const asked = detectDialect({}, header);
    if (asked !== only) {
      throw new RequestQueryException(
        `X-Crud-Dialect '${asked}' is not accepted here. This route accepts the ${only} query syntax only.`,
      );
    }
  }

  if (only === 'postgrest') {
    for (const key of Object.keys(query || {})) {
      if (isNestjsxParam(key, (query as any)[key])) {
        throw new RequestQueryException(
          `The '${key}' query parameter is nestjsx syntax, and this route accepts the PostgREST ` +
            `query syntax only. Use ${POSTGREST_EQUIVALENT[key]}.`,
        );
      }
    }
  }
  return only;
}
