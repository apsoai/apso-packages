# @apso/schema-tools

Lint, autofix and edit `.apsorc` v2 schemas. One package shared by the Apso CLI (`apso schema lint`, the check before `apso generate`, and the MCP server), the platform, and the AI schema builder.

## Lint

Errors mean the CLI would scaffold code that does not compile or a database you cannot insert into (for example a field `notes` on `Contact` next to `Note ManyToOne Contact`, which generates a second `notes` property). Warnings are quality issues.

```ts
import { lintSchema, fixSchema, formatLintReport } from "@apso/schema-tools";

const { schema, applied } = fixSchema(apsorc); // deterministic fixes only; never drops entities or relationships
const result = lintSchema(schema);              // { issues, errorCount, warningCount }
console.log(formatLintReport(result));          // plain text for a terminal or an LLM prompt
```

Each issue is `{ rule, severity, entity?, field?, relationship?, message, fixable }`. The rules live in `src/rules.ts` as a flat array; the relationship property names mirror `@apso/cli` `src/lib/utils/relationships/parse.ts` and must change with it.

## Edit operations (agent tools)

Pure functions that take a schema and an input and return `{ schema, issues, ok, message, data? }`. The input schema is never mutated. A write that would add a lint error is rejected: `ok` is false, the schema comes back unchanged, and `message` holds the lint report, so an agent can correct itself.

| Tool | Does |
|---|---|
| `get_schema` | Outline (default) or full JSON |
| `describe_entity` | One entity plus the relationships that touch it |
| `add_entity`, `rename_entity`, `remove_entity` | Entities; renames and removals update relationships and foreign key indexes |
| `add_field`, `update_field`, `rename_field`, `remove_field` | Fields; renames and removals keep `indexes` and `uniques` in sync |
| `add_relationship`, `remove_relationship` | Relationships |
| `add_index` | Index or unique index, foreign key columns allowed |
| `lint_schema` | The lint report |

```ts
import { addField, runSchemaTool, schemaTools } from "@apso/schema-tools";

const r = addField(apsorc, { entity: "Contact", field: { name: "phone", type: "text", nullable: true } });
if (!r.ok) console.log(r.message);

// The same definitions back AI SDK tools and MCP tools:
for (const t of schemaTools) {
  // t.name, t.description, t.inputSchema (JSON Schema), t.readOnly
}
runSchemaTool(apsorc, "rename_field", { entity: "Contact", field: "notes", newName: "notes_text" }); // validates input first
```
