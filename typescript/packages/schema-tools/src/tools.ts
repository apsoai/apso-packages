import { formatLintReport, lintSchema } from "./lint";
import { camelCase, describeRelationship, RELATIONSHIP_TYPES } from "./naming";
import { LintIssue, Schema, SchemaEntity, SchemaField, SchemaRelationship } from "./types";

/**
 * Targeted edit operations on a .apsorc v2 schema, for AI agents (AI SDK tools
 * in the platform, MCP tools in the CLI). Every operation is pure: it returns a
 * new schema and never mutates its input. A write that would add a lint ERROR
 * is rejected and the schema comes back unchanged with the reason.
 */
export interface ToolResult {
  /** The schema after the operation (the input schema when `ok` is false). */
  schema: Schema;
  /** Lint issues on the returned schema. */
  issues: LintIssue[];
  ok: boolean;
  /** What happened, or why the operation was rejected. */
  message: string;
  /** Read results (get_schema, describe_entity, lint_schema). */
  data?: unknown;
}

type JsonType = "object" | "string" | "boolean" | "number" | "integer" | "array" | "null";

/** The JSON Schema subset the tool inputs use. */
export interface JsonSchema {
  type?: JsonType | JsonType[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: string[];
}

export interface SchemaTool {
  name: string;
  description: string;
  /** JSON Schema for the input object; feed it to AI SDK `jsonSchema()` or an MCP tool. */
  inputSchema: JsonSchema & { type: "object" };
  /** True for tools that only read the schema. */
  readOnly: boolean;
  /** Run the tool. Prefer runSchemaTool, which validates the input first. */
  run: (schema: Schema, input: any) => ToolResult;
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

/** Validates `value` against the JSON Schema subset above. Returns the first problem, or undefined. */
export function validateInput(schema: JsonSchema, value: unknown, path = "input"): string | undefined {
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    const ok = allowed.some((t) => t === actual || (t === "number" && actual === "integer"));
    if (!ok) return `${path} must be ${allowed.join(" or ")}, got ${actual}.`;
  }
  if (schema.enum && !schema.enum.includes(value as string)) {
    return `${path} must be one of ${schema.enum.join(", ")}, got ${JSON.stringify(value)}.`;
  }
  if (Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      const problem = validateInput(schema.items, value[i], `${path}[${i}]`);
      if (problem) return problem;
    }
  }
  if (typeOf(value) === "object" && schema.properties) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required || []) {
      if (obj[key] === undefined) return `${path}.${key} is required.`;
    }
    for (const [key, v] of Object.entries(obj)) {
      const prop = schema.properties[key];
      if (!prop) {
        if (schema.additionalProperties === false) return `${path}.${key} is not a known property.`;
        continue;
      }
      if (v === undefined) continue;
      const problem = validateInput(prop, v, `${path}.${key}`);
      if (problem) return problem;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const errorKey = (i: LintIssue) => `${i.rule}|${i.entity || ""}|${i.field || ""}|${i.relationship || ""}`;

function read(schema: Schema, message: string, data: unknown): ToolResult {
  return { schema, issues: lintSchema(schema).issues, ok: true, message, data };
}

function fail(schema: Schema, message: string): ToolResult {
  return { schema, issues: lintSchema(schema).issues, ok: false, message };
}

/**
 * Accept `after` unless it has a lint error `before` did not have. A schema
 * that already has errors can still be edited, as long as no new error appears.
 */
function commit(before: Schema, after: Schema, message: string): ToolResult {
  const known = new Set(lintSchema(before).issues.filter((i) => i.severity === "error").map(errorKey));
  const lint = lintSchema(after);
  const added = lint.issues.filter((i) => i.severity === "error" && !known.has(errorKey(i)));
  if (added.length > 0) {
    const report = formatLintReport({ issues: added, errorCount: added.length, warningCount: 0 });
    return fail(before, `Rejected, the schema was not changed. This change would add lint errors:\n${report}`);
  }
  return { schema: after, issues: lint.issues, ok: true, message };
}

function findEntity(schema: Schema, name: string): SchemaEntity | undefined {
  const entities = schema.entities || [];
  return entities.find((e) => e.name === name) || entities.find((e) => e.name.toLowerCase() === String(name).toLowerCase());
}

const entityNames = (schema: Schema) => (schema.entities || []).map((e) => e.name).join(", ") || "none";

function missingEntity(schema: Schema, name: string): ToolResult {
  return fail(schema, `Entity "${name}" not found. Entities: ${entityNames(schema)}.`);
}

function findField(entity: SchemaEntity, name: string): SchemaField | undefined {
  return (entity.fields || []).find((f) => f.name === name);
}

function missingField(schema: Schema, entity: SchemaEntity, name: string): ToolResult {
  const names = (entity.fields || []).map((f) => f.name).join(", ") || "none";
  return fail(schema, `Field "${name}" not found on "${entity.name}". Fields: ${names}.`);
}

/** The platform writes isUnique/isIndex, the CLI unique/index. Keep whichever the schema already uses. */
function usesPlatformSpelling(schema: Schema): boolean {
  return (schema.entities || []).some((e) => (e.fields || []).some((f) => "isUnique" in f || "isIndex" in f));
}

/** Copies field settings from tool input onto `field`; `null` removes a setting. */
function applyFieldSettings(schema: Schema, field: SchemaField, settings: Record<string, unknown>): void {
  const platform = usesPlatformSpelling(schema);
  const target = field as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined || key === "name") continue;
    const names =
      key === "unique" ? ["unique", "isUnique"] : key === "index" ? ["index", "isIndex"] : [key];
    const write = names.length === 1 ? key : platform ? names[1] : names[0];
    for (const n of names) delete target[n];
    if (value !== null) target[write] = value;
  }
}

const fieldsFor = (list: { fields: string[] }[] | undefined, map: (n: string) => string | undefined) =>
  (list || [])
    .map((c) => ({ ...c, fields: c.fields.map(map).filter((n): n is string => Boolean(n)) }))
    .filter((c) => c.fields.length > 0);

function outline(schema: Schema): string {
  const lines = (schema.entities || []).map((e) => {
    const fields = (e.fields || []).map((f) => {
      const flags = [
        f.nullable ? "nullable" : "",
        f.unique || f.isUnique ? "unique" : "",
        f.index || f.isIndex ? "index" : "",
        f.values ? `[${f.values.join("|")}]` : "",
        f.default !== undefined && f.default !== null ? `default=${JSON.stringify(f.default)}` : "",
      ].filter(Boolean);
      return `${f.name}:${f.type}${flags.length ? ` (${flags.join(", ")})` : ""}`;
    });
    return `${e.name}: ${fields.join("; ") || "(no fields)"}`;
  });
  const rels = (schema.relationships || []).map(describeRelationship);
  return [`Entities (${lines.length}):`, ...lines, `Relationships (${rels.length}):`, ...rels].join("\n");
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const str = (description: string): JsonSchema => ({ type: "string", description });
const bool = (description: string): JsonSchema => ({ type: "boolean", description });

const fieldSettings: Record<string, JsonSchema> = {
  type: str("Field type, e.g. text, integer, decimal, boolean, date, timestamptz, enum, json, uuid."),
  nullable: bool("True when the value is optional."),
  unique: bool("True for a unique column."),
  index: bool("True to index the column."),
  values: { type: "array", items: { type: "string" }, description: "Allowed values for an enum field." },
  default: { type: ["string", "number", "boolean", "null"], description: "Default value." },
  length: { type: "integer", description: "Max length for text/varchar." },
  precision: { type: "integer", description: "Total digits for decimal/numeric." },
  scale: { type: "integer", description: "Digits after the point for decimal/numeric." },
  is_email: bool("True for an email address column."),
};

/** update_field accepts null on any setting to remove it. */
const removableSettings: Record<string, JsonSchema> = Object.fromEntries(
  Object.entries(fieldSettings).map(([key, value]) => {
    const types = Array.isArray(value.type) ? value.type : [value.type!];
    return [key, { ...value, type: [...new Set([...types, "null" as const])] }];
  })
);

const fieldInput: JsonSchema = {
  type: "object",
  properties: { name: str("Field name in camelCase or snake_case."), ...fieldSettings },
  required: ["name", "type"],
  additionalProperties: false,
};

const relationshipProps: Record<string, JsonSchema> = {
  from: str("Entity the relationship is declared on."),
  to: str("Entity it points to."),
  type: { type: "string", enum: RELATIONSHIP_TYPES, description: "Cardinality from `from` to `to`." },
  to_name: str("Optional property name for the `to` side, used when two relationships point at the same entity."),
  nullable: bool("True when the relationship is optional."),
  bi_directional: bool("Generate the inverse property on `to` (ManyToMany and OneToOne)."),
  cascadeDelete: bool("Delete children with the parent."),
  index: bool("Index the foreign key column."),
  joinTableName: str("Join table name for ManyToMany."),
};

const obj = (properties: Record<string, JsonSchema>, required: string[]): JsonSchema & { type: "object" } => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const schemaTools: SchemaTool[] = [
  {
    name: "get_schema",
    description:
      "Read the whole schema. format \"outline\" (default) gives one line per entity and relationship; \"json\" gives the full .apsorc JSON.",
    readOnly: true,
    inputSchema: obj({ format: { type: "string", enum: ["outline", "json"], description: "outline or json." } }, []),
    run: (schema, input: { format?: string }) =>
      read(schema, "Schema read.", input.format === "json" ? schema : outline(schema)),
  },
  {
    name: "describe_entity",
    description: "Read one entity: its fields, indexes, uniques and every relationship that touches it.",
    readOnly: true,
    inputSchema: obj({ entity: str("Entity name.") }, ["entity"]),
    run: (schema, input: { entity: string }) => {
      const entity = findEntity(schema, input.entity);
      if (!entity) return missingEntity(schema, input.entity);
      const relationships = (schema.relationships || []).filter((r) => r.from === entity.name || r.to === entity.name);
      return read(schema, `Entity "${entity.name}".`, { entity, relationships });
    },
  },
  {
    name: "add_entity",
    description:
      "Add a new entity (PascalCase singular name). Do not add id, created_at or updated_at fields, or foreign key fields like contactId: relationships create those.",
    readOnly: false,
    inputSchema: obj(
      {
        name: str("PascalCase singular entity name, e.g. Invoice."),
        fields: { type: "array", items: fieldInput, description: "Fields." },
        created_at: bool("Add a created_at timestamp (default true)."),
        updated_at: bool("Add an updated_at timestamp (default true)."),
        table: str("Explicit table name. Usually omitted."),
      },
      ["name"]
    ),
    run: (schema, input: { name: string; fields?: Record<string, unknown>[]; created_at?: boolean; updated_at?: boolean; table?: string }) => {
      if (findEntity(schema, input.name)) return fail(schema, `Entity "${input.name}" already exists. Use add_field or update_field to change it.`);
      const next = clone(schema);
      const entity: SchemaEntity = {
        name: input.name,
        ...(input.table ? { table: input.table } : {}),
        created_at: input.created_at ?? true,
        updated_at: input.updated_at ?? true,
        fields: [],
      };
      for (const f of input.fields || []) {
        const field = { name: String(f.name), type: String(f.type) } as SchemaField;
        applyFieldSettings(next, field, f);
        entity.fields!.push(field);
      }
      next.entities = [...(next.entities || []), entity];
      return commit(schema, next, `Added entity "${input.name}" with ${entity.fields!.length} field(s).`);
    },
  },
  {
    name: "rename_entity",
    description: "Rename an entity. Relationships and foreign key indexes that refer to it are updated.",
    readOnly: false,
    inputSchema: obj({ entity: str("Current entity name."), newName: str("New PascalCase name.") }, ["entity", "newName"]),
    run: (schema, input: { entity: string; newName: string }) => {
      const current = findEntity(schema, input.entity);
      if (!current) return missingEntity(schema, input.entity);
      if (findEntity(schema, input.newName) && input.newName.toLowerCase() !== current.name.toLowerCase()) {
        return fail(schema, `Entity "${input.newName}" already exists.`);
      }
      const old = current.name;
      const next = clone(schema);
      const oldFk = `${camelCase(old)}Id`;
      const newFk = `${camelCase(input.newName)}Id`;
      for (const e of next.entities) {
        if (e.name === old) e.name = input.newName;
        const rename = (n: string) => (n === oldFk ? newFk : n);
        if (e.indexes) e.indexes = fieldsFor(e.indexes, rename);
        if (e.uniques) e.uniques = fieldsFor(e.uniques, rename) as typeof e.uniques;
      }
      for (const r of next.relationships || []) {
        if (r.from === old) r.from = input.newName;
        if (r.to === old) r.to = input.newName;
      }
      return commit(schema, next, `Renamed entity "${old}" to "${input.newName}".`);
    },
  },
  {
    name: "remove_entity",
    description: "Remove an entity and every relationship that touches it.",
    readOnly: false,
    inputSchema: obj({ entity: str("Entity name.") }, ["entity"]),
    run: (schema, input: { entity: string }) => {
      const current = findEntity(schema, input.entity);
      if (!current) return missingEntity(schema, input.entity);
      const next = clone(schema);
      next.entities = next.entities.filter((e) => e.name !== current.name);
      const before = (next.relationships || []).length;
      if (next.relationships) next.relationships = next.relationships.filter((r) => r.from !== current.name && r.to !== current.name);
      // Foreign key indexes pointing at the removed entity go with it.
      const fk = `${camelCase(current.name)}Id`;
      for (const e of next.entities) {
        if (e.indexes) e.indexes = fieldsFor(e.indexes, (n) => (n === fk ? undefined : n));
        if (e.uniques) e.uniques = fieldsFor(e.uniques, (n) => (n === fk ? undefined : n)) as typeof e.uniques;
      }
      const dropped = before - (next.relationships || []).length;
      return commit(schema, next, `Removed entity "${current.name}" and ${dropped} relationship(s).`);
    },
  },
  {
    name: "add_field",
    description:
      "Add a field to an entity. Use decimal (not float) for money, enum with values for a status or state, and a relationship (not a field) to link entities.",
    readOnly: false,
    inputSchema: obj({ entity: str("Entity name."), field: fieldInput }, ["entity", "field"]),
    run: (schema, input: { entity: string; field: Record<string, unknown> }) => {
      const current = findEntity(schema, input.entity);
      if (!current) return missingEntity(schema, input.entity);
      const name = String(input.field.name);
      if (findField(current, name)) return fail(schema, `Field "${name}" already exists on "${current.name}". Use update_field.`);
      const next = clone(schema);
      const field = { name, type: String(input.field.type) } as SchemaField;
      applyFieldSettings(next, field, input.field);
      const entity = findEntity(next, current.name)!;
      entity.fields = [...(entity.fields || []), field];
      return commit(schema, next, `Added field "${current.name}.${name}".`);
    },
  },
  {
    name: "update_field",
    description: "Change settings of an existing field (type, nullable, unique, index, values, default, length...). Set a setting to null to remove it.",
    readOnly: false,
    inputSchema: obj(
      {
        entity: str("Entity name."),
        field: str("Field name."),
        changes: { type: "object", properties: removableSettings, additionalProperties: false, description: "Settings to change." },
      },
      ["entity", "field", "changes"]
    ),
    run: (schema, input: { entity: string; field: string; changes: Record<string, unknown> }) => {
      const current = findEntity(schema, input.entity);
      if (!current) return missingEntity(schema, input.entity);
      if (!findField(current, input.field)) return missingField(schema, current, input.field);
      const next = clone(schema);
      const field = findField(findEntity(next, current.name)!, input.field)!;
      applyFieldSettings(next, field, input.changes);
      if (field.type !== "enum") delete field.values;
      return commit(schema, next, `Updated field "${current.name}.${input.field}": ${Object.keys(input.changes).join(", ")}.`);
    },
  },
  {
    name: "rename_field",
    description: "Rename a field. Indexes and uniques on it are updated.",
    readOnly: false,
    inputSchema: obj({ entity: str("Entity name."), field: str("Current field name."), newName: str("New field name.") }, [
      "entity",
      "field",
      "newName",
    ]),
    run: (schema, input: { entity: string; field: string; newName: string }) => {
      const current = findEntity(schema, input.entity);
      if (!current) return missingEntity(schema, input.entity);
      if (!findField(current, input.field)) return missingField(schema, current, input.field);
      if (findField(current, input.newName)) return fail(schema, `Field "${input.newName}" already exists on "${current.name}".`);
      const next = clone(schema);
      const entity = findEntity(next, current.name)!;
      findField(entity, input.field)!.name = input.newName;
      const rename = (n: string) => (n === input.field ? input.newName : n);
      if (entity.indexes) entity.indexes = fieldsFor(entity.indexes, rename);
      if (entity.uniques) entity.uniques = fieldsFor(entity.uniques, rename) as typeof entity.uniques;
      return commit(schema, next, `Renamed field "${current.name}.${input.field}" to "${input.newName}".`);
    },
  },
  {
    name: "remove_field",
    description: "Remove a field. Indexes and uniques on it are dropped.",
    readOnly: false,
    inputSchema: obj({ entity: str("Entity name."), field: str("Field name.") }, ["entity", "field"]),
    run: (schema, input: { entity: string; field: string }) => {
      const current = findEntity(schema, input.entity);
      if (!current) return missingEntity(schema, input.entity);
      if (!findField(current, input.field)) return missingField(schema, current, input.field);
      const next = clone(schema);
      const entity = findEntity(next, current.name)!;
      entity.fields = (entity.fields || []).filter((f) => f.name !== input.field);
      const drop = (n: string) => (n === input.field ? undefined : n);
      if (entity.indexes) entity.indexes = fieldsFor(entity.indexes, drop);
      if (entity.uniques) entity.uniques = fieldsFor(entity.uniques, drop) as typeof entity.uniques;
      return commit(schema, next, `Removed field "${current.name}.${input.field}".`);
    },
  },
  {
    name: "add_relationship",
    description:
      "Link two entities. ManyToOne from the child (Note ManyToOne Contact adds Note.contactId); ManyToMany for a plain link; a join entity with two ManyToOne relationships when the link carries data.",
    readOnly: false,
    inputSchema: obj(relationshipProps, ["from", "to", "type"]),
    run: (schema, input: SchemaRelationship) => {
      for (const side of [input.from, input.to]) if (!findEntity(schema, side)) return missingEntity(schema, side);
      const from = findEntity(schema, input.from)!.name;
      const to = findEntity(schema, input.to)!.name;
      const rel: SchemaRelationship = { ...input, from, to };
      const exists = (schema.relationships || []).some(
        (r) => r.from === from && r.to === to && r.type === rel.type && (r.to_name || "") === (rel.to_name || "")
      );
      if (exists) return fail(schema, `Relationship ${describeRelationship(rel)} already exists.`);
      const next = clone(schema);
      next.relationships = [...(next.relationships || []), rel];
      return commit(schema, next, `Added relationship ${describeRelationship(rel)}.`);
    },
  },
  {
    name: "remove_relationship",
    description: "Remove the relationship(s) declared from `from` to `to`. Pass type and to_name to pick one when there are several.",
    readOnly: false,
    inputSchema: obj(
      { from: relationshipProps.from, to: relationshipProps.to, type: relationshipProps.type, to_name: relationshipProps.to_name },
      ["from", "to"]
    ),
    run: (schema, input: { from: string; to: string; type?: string; to_name?: string }) => {
      const matches = (r: SchemaRelationship) =>
        r.from.toLowerCase() === input.from.toLowerCase() &&
        r.to.toLowerCase() === input.to.toLowerCase() &&
        (!input.type || r.type === input.type) &&
        (input.to_name === undefined || (r.to_name || "") === input.to_name);
      const found = (schema.relationships || []).filter(matches);
      if (found.length === 0) {
        const list = (schema.relationships || []).map(describeRelationship).join("; ") || "none";
        return fail(schema, `No relationship from "${input.from}" to "${input.to}" matches. Relationships: ${list}.`);
      }
      if (found.length > 1 && !input.type) {
        return fail(schema, `Several relationships match: ${found.map(describeRelationship).join("; ")}. Pass type (and to_name) to pick one.`);
      }
      const next = clone(schema);
      next.relationships = (next.relationships || []).filter((r) => !matches(r));
      return commit(schema, next, `Removed ${found.map(describeRelationship).join("; ")}.`);
    },
  },
  {
    name: "add_index",
    description: "Add an index (or a unique index) on one or more fields of an entity. Foreign key columns like contactId are allowed.",
    readOnly: false,
    inputSchema: obj(
      {
        entity: str("Entity name."),
        fields: { type: "array", items: { type: "string" }, description: "Field names, in index order." },
        unique: bool("True for a unique index."),
      },
      ["entity", "fields"]
    ),
    run: (schema, input: { entity: string; fields: string[]; unique?: boolean }) => {
      const current = findEntity(schema, input.entity);
      if (!current) return missingEntity(schema, input.entity);
      if (input.fields.length === 0) return fail(schema, "fields must list at least one field.");
      const same = (current.indexes || []).some((i) => i.fields.join(",") === input.fields.join(","));
      if (same) return fail(schema, `"${current.name}" already has an index on ${input.fields.join(", ")}.`);
      const next = clone(schema);
      const entity = findEntity(next, current.name)!;
      entity.indexes = [...(entity.indexes || []), { fields: input.fields, unique: Boolean(input.unique) }];
      return commit(schema, next, `Added ${input.unique ? "unique " : ""}index on "${current.name}" (${input.fields.join(", ")}).`);
    },
  },
  {
    name: "lint_schema",
    description: "Lint the schema with the rules `apso generate` enforces. Errors mean the generated code would not compile; warnings are quality hints.",
    readOnly: true,
    inputSchema: obj({}, []),
    run: (schema) => {
      const result = lintSchema(schema);
      return read(schema, formatLintReport(result), result);
    },
  },
];

/** Validate `input` against the tool's inputSchema, then run it. Unknown tools and bad input fail without changing the schema. */
export function runSchemaTool(schema: Schema, name: string, input: unknown = {}): ToolResult {
  const tool = schemaTools.find((t) => t.name === name);
  if (!tool) return fail(schema, `Unknown tool "${name}". Tools: ${schemaTools.map((t) => t.name).join(", ")}.`);
  const problem = validateInput(tool.inputSchema, input ?? {});
  if (problem) return fail(schema, `Invalid input for ${name}: ${problem}`);
  return tool.run(schema, input ?? {});
}

type Op<I> = (schema: Schema, input: I) => ToolResult;
const op = <I>(name: string): Op<I> => (schema, input) => runSchemaTool(schema, name, input);

export const getSchema = op<{ format?: "outline" | "json" }>("get_schema");
export const describeEntity = op<{ entity: string }>("describe_entity");
export const addEntity = op<{ name: string; fields?: Array<Partial<SchemaField> & { name: string; type: string }>; created_at?: boolean; updated_at?: boolean; table?: string }>("add_entity");
export const renameEntity = op<{ entity: string; newName: string }>("rename_entity");
export const removeEntity = op<{ entity: string }>("remove_entity");
export const addField = op<{ entity: string; field: Partial<SchemaField> & { name: string; type: string } }>("add_field");
export const updateField = op<{ entity: string; field: string; changes: Record<string, unknown> }>("update_field");
export const renameField = op<{ entity: string; field: string; newName: string }>("rename_field");
export const removeField = op<{ entity: string; field: string }>("remove_field");
export const addRelationship = op<SchemaRelationship & { cascadeDelete?: boolean }>("add_relationship");
export const removeRelationship = op<{ from: string; to: string; type?: string; to_name?: string }>("remove_relationship");
export const addIndex = op<{ entity: string; fields: string[]; unique?: boolean }>("add_index");
