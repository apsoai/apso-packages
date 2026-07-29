/**
 * The shared query corpus. Every entry is issued verbatim against both
 * apps and the {status, body} pair must match exactly, unless listed in
 * EXPECTED_DIVERGENCES with a reason.
 *
 * Grow this with apso-e2e: operators x types, join shapes, search trees,
 * auth interactions, error cases. Seed values live in entities.ts.
 */
export const CORPUS: string[] = [
  // plain reads
  '/authors',
  '/authors/1',
  '/authors/999',                                    // 404 both sides
  '/authors?fields=name,age',
  '/authors?fields=name,name,age',                   // dedup (#777)

  // comparison operators
  '/authors?filter=age||$gt||30',
  '/authors?filter=age||$gte||36',
  '/authors?filter=age||$lt||30',
  '/authors?filter=age||$lte||28',
  '/authors?filter=name||$ne||Ada',
  '/authors?filter=name||$eq||Ada',

  // membership / null / like family
  '/authors?filter=plan||$in||Pro,Team',
  '/authors?filter=plan||$notin||Free',
  '/authors?filter=email||$isnull',
  '/authors?filter=email||$notnull',
  '/authors?filter=name||$cont||a',
  '/authors?filter=name||$contL||A',
  '/authors?filter=name||$starts||C',
  '/authors?filter=name||$ends||o',
  '/authors?filter=age||$between||30,45',

  // multiple filters AND / filter+or truth table
  '/authors?filter=active||$eq||true&filter=age||$gt||30',
  '/authors?filter=plan||$eq||Pro&or=plan||$eq||Team',
  '/authors?or=age||$lt||30&or=age||$gt||50',

  // search trees
  '/authors?s={"name":{"$contL":"a"}}',
  '/authors?s={"$and":[{"active":true},{"age":{"$gt":30}}]}',
  '/authors?s={"$or":[{"plan":"Pro"},{"plan":"Team"}]}',
  '/authors?s={"$and":[{"$or":[{"plan":"Pro"},{"plan":"Team"}]},{"age":{"$lt":40}}]}',

  // sort
  '/authors?sort=age,DESC',
  '/authors?sort=plan,ASC&sort=age,DESC',

  // pagination shapes
  '/authors?limit=2',
  '/authors?limit=2&page=2',
  '/authors?limit=2&offset=1',
  '/authors?page=1',

  // joins (incl. nested)
  '/authors?join=posts',
  '/authors?join=posts&filter=posts.status||$eq||published',
  '/authors?join=posts&join=posts.comments',
  '/authors?join=posts||title',
  '/authors?fields=name&join=posts',
  '/authors?fields=name&join=posts||title',
  '/authors/1?fields=name&join=posts',
  '/authors/1?join=posts',
  '/authors?join=nonexistent',                        // not in allowlist: skipped both sides

  // #42: unknown column in fields= is silently ignored, not a 500
  '/authors?fields=name,notacolumn',
  '/authors?fields=notacolumn',
  '/authors/1?fields=name,bogus',

  // #41: $inL/$notinL lower only the column, values as given
  '/authors?filter=name||$inL||ada,cleo',
  '/authors?filter=name||$inL||ADA,CLEO',
  '/authors?filter=name||$notinL||ada,cleo',
  '/authors?filter=plan||$inL||pro,team',

  // parser edge cases (residual #19): invalid inputs must match nestjsx
  '/authors?sort=age,SIDEWAYS',
  '/authors?s={bad json',
  '/authors?filter=age||$bogus||5',
  '/authors?filter=age||$in||',
  '/authors?fields=',
  '/authors?filter=age',
  '/authors?filter=name||$eq||',
  '/authors?filter=age||eq||36',
  '/authors?sort=age,asc',
  '/authors?s={"age":{"$bogus":5}}',

  // auth filter scoping (scoped-authors has auth.filter -> active: true)
  '/scoped-authors',
  '/scoped-authors?filter=active||$eq||false',        // cannot widen past auth filter
  '/scoped-authors?or=active||$eq||false',            // or cannot widen either
  '/scoped-authors/2',                                // Bob is inactive: 404 both sides
];

/**
 * Known, intentional divergences. Path -> reason. The harness asserts these
 * DO diverge (so a silent convergence or regression is also caught) and
 * every divergence is documented here — nothing diverges silently.
 */
export const EXPECTED_DIVERGENCES: Record<string, string> = {};
