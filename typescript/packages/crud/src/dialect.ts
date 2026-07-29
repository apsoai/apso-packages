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
    if (NESTJSX_KEYS.has(key)) {
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
