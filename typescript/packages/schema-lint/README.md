# @apso/schema-lint

One rule set for `.apsorc` schemas, shared by the Apso CLI (`apso schema lint`, and the check before `apso generate`), the platform, and the AI schema builder.

Errors mean the CLI would scaffold code that does not compile or a database you cannot insert into (for example a field `notes` on `Contact` next to `Note ManyToOne Contact`, which generates a second `notes` property). Warnings are quality issues.

```ts
import { lintSchema, fixSchema, formatLintReport } from "@apso/schema-lint";

const { schema, applied } = fixSchema(apsorc); // deterministic fixes only; never drops entities or relationships
const result = lintSchema(schema);              // { issues, errorCount, warningCount }
console.log(formatLintReport(result));          // plain text for a terminal or an LLM prompt
```

Each issue is `{ rule, severity, entity?, field?, relationship?, message, fixable }`. The rules live in `src/rules.ts` as a flat array; the relationship property names mirror `@apso/cli` `src/lib/utils/relationships/parse.ts` and must change with it.
