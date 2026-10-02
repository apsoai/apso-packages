import pluralize from "pluralize";
import {
  RELATIONSHIP_TYPES,
  camelCase,
  describeRelationship,
  pascalCase,
  relationshipProperties,
  snakeCase,
  tableName,
} from "./naming";
import { Finding, Rule, Schema, SchemaEntity, SchemaField, SchemaRelationship, Severity } from "./types";

/** Valid in TypeScript, Python and Go, so every CLI target language compiles it. */
const IDENTIFIER = /^[A-Za-z_]\w*$/;

/** Postgres silently truncates longer identifiers. */
const MAX_IDENTIFIER = 63;

/**
 * Field types the CLI can scaffold: one entity-col-<type>.eta template each in
 * @apso/cli src/lib/templates/entities, plus the spellings normalizeFieldType
 * maps onto them (src/lib/utils/field.ts).
 */
const FIELD_TYPES = new Set([
  "array", "bigint", "bigserial", "boolean", "bytea", "char", "date", "datetime", "decimal",
  "double", "enum", "float", "geography", "geometry", "geometrycollection", "inet", "int4range",
  "integer", "interval", "json", "json-plain", "jsonb", "linestring", "money", "multilinestring",
  "multipoint", "multipolygon", "numeric", "point", "polygon", "real", "serial", "smallint",
  "smallserial", "string", "text", "time", "timestamp", "timestamptz", "timetz", "tsvector",
  "uuid", "varchar", "xml",
]);
/** normalizeFieldType looks these up lowercased. */
const NORMALIZED_TYPES = new Set([
  "double precision", "character varying", "time without time zone", "time with time zone",
  "timestamp without time zone", "timestamp with time zone", "datetime",
]);

/** Common wrong spellings with an unambiguous CLI type. */
const TYPE_ALIASES: Record<string, string> = {
  number: "integer", int: "integer", int4: "integer", int2: "smallint", int8: "bigint",
  bool: "boolean", float4: "real", float8: "double", character: "char",
};

/** JS/TS words that cannot name a class. */
const RESERVED_CLASS_NAMES = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do",
  "else", "enum", "export", "extends", "false", "finally", "for", "function", "if", "import", "in",
  "instanceof", "new", "null", "return", "super", "switch", "this", "throw", "true", "try",
  "typeof", "var", "void", "while", "with", "implements", "interface", "let", "package",
  "private", "protected", "public", "static", "yield", "await", "any", "boolean", "number",
  "string", "symbol", "never", "unknown", "object", "undefined", "bigint",
]);

/**
 * Identifiers the generated NestJS files import next to the entity class
 * (entity.eta, controller/service/module/dto templates). An entity with one of
 * these names is a TS2300/TS2440 duplicate identifier.
 */
const GENERATED_IMPORTS = new Set([
  "Column", "CreateDateColumn", "Entity", "Generated", "Index", "JoinColumn", "JoinTable",
  "PrimaryColumn", "PrimaryGeneratedColumn", "Unique", "UpdateDateColumn", "OneToMany",
  "ManyToOne", "ManyToMany", "OneToOne", "IsOptional", "IsString", "MaxLength", "IsNotEmpty",
  "IsEmail", "IsBoolean", "IsArray", "IsDate", "IsEnum", "IsNumber", "IsObject", "IsUUID",
  "ValidateNested", "Type", "CrudValidationGroups", "ApiProperty", "ApiPropertyOptional",
  "ApiTags", "ApiResponse", "ApiOperation", "ApiBody", "Controller", "Body", "Crud",
  "CrudController", "Override", "ParsedRequest", "CrudRequest", "ParsedBody", "CreateManyDto",
  "Injectable", "NotFoundException", "InjectRepository", "Module", "ParsedRequestParams",
  "QueryOptions", "Repository", "DeepPartial", "TypeOrmCrudService", "TypeOrmModule", "Promise",
]);

/** Postgres reserved key words (the "reserved" column of the SQL key words table). */
const PG_RESERVED = new Set([
  "all", "analyse", "analyze", "and", "any", "array", "as", "asc", "asymmetric", "authorization",
  "binary", "both", "case", "cast", "check", "collate", "collation", "column", "concurrently",
  "constraint", "create", "cross", "current_catalog", "current_date", "current_role",
  "current_schema", "current_time", "current_timestamp", "current_user", "default", "deferrable",
  "desc", "distinct", "do", "else", "end", "except", "false", "fetch", "for", "foreign", "freeze",
  "from", "full", "grant", "group", "having", "ilike", "in", "initially", "inner", "intersect",
  "into", "is", "isnull", "join", "lateral", "leading", "left", "like", "limit", "localtime",
  "localtimestamp", "natural", "not", "notnull", "null", "offset", "on", "only", "or", "order",
  "outer", "overlaps", "placing", "primary", "references", "returning", "right", "select",
  "session_user", "similar", "some", "symmetric", "system_user", "table", "tablesample", "then",
  "to", "trailing", "true", "union", "unique", "user", "using", "variadic", "verbose", "when",
  "where", "window", "with",
]);

const entitiesOf = (schema: Schema): SchemaEntity[] => (Array.isArray(schema.entities) ? schema.entities : []);
const fieldsOf = (entity: SchemaEntity): SchemaField[] => (Array.isArray(entity.fields) ? entity.fields : []);
const relationshipsOf = (schema: Schema): SchemaRelationship[] =>
  Array.isArray(schema.relationships) ? schema.relationships : [];
const listOf = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);
const isWellFormed = (rel: SchemaRelationship) => typeof rel?.from === "string" && typeof rel?.to === "string";
const isText = (type: string) => ["text", "varchar", "char", "string"].includes(type);
const isUnique = (f: SchemaField) => Boolean(f.unique || f.isUnique);

/** Renames a field and keeps indexes/uniques pointing at it. */
function renameField(entity: SchemaEntity, field: SchemaField, to: string) {
  const from = field.name;
  field.name = to;
  for (const c of [...listOf(entity.indexes), ...listOf(entity.uniques)]) {
    if (Array.isArray(c?.fields)) c.fields = c.fields.map((n) => (n === from ? to : n));
  }
}

/** Renames an entity and every relationship end that names it. */
function renameEntity(schema: Schema, entity: SchemaEntity, to: string) {
  const from = entity.name;
  entity.name = to;
  for (const rel of relationshipsOf(schema)) {
    if (rel.from === from) rel.from = to;
    if (rel.to === from) rel.to = to;
  }
}

/** First of `base`, `base2`, `base3`... not already taken. */
function freeName(base: string, taken: (name: string) => boolean): string {
  let name = base;
  for (let n = 2; taken(name); n++) name = `${base}${n}`;
  return name;
}

function findDuplicates(names: string[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const n of names) (seen.has(n) ? dups : seen).add(n);
  return [...dups];
}

const finding = (
  rule: string,
  severity: Severity,
  message: string,
  where: { entity?: string; field?: string; relationship?: string },
  fix?: () => void
): Finding => ({ issue: { rule, severity, ...where, message, fixable: Boolean(fix) }, fix });

function rule(id: string, severity: Severity, check: (schema: Schema, report: Report) => void): Rule {
  return {
    id,
    severity,
    check: (schema) => {
      const out: Finding[] = [];
      check(schema, (message, where, fix) => out.push(finding(id, severity, message, where, fix)));
      return out;
    },
  };
}
type Report = (
  message: string,
  where: { entity?: string; field?: string; relationship?: string },
  fix?: () => void
) => void;

/**
 * The rule set. Errors are schemas the CLI scaffolds into code that does not
 * compile or a database that cannot be used; warnings are quality issues.
 * Order matters for fixSchema: entity renames run before rules that read names.
 */
export const rules: Rule[] = [
  rule("INVALID_ENTITY_NAME", "error", (schema, report) => {
    const names = new Set(entitiesOf(schema).map((e) => e.name));
    for (const entity of entitiesOf(schema)) {
      if (typeof entity.name === "string" && IDENTIFIER.test(entity.name)) continue;
      const raw = typeof entity.name === "string" ? entity.name : "";
      const safe = pascalCase(raw.replace(/[^A-Za-z0-9]+/g, " ").trim());
      const fixable = IDENTIFIER.test(safe) && !names.has(safe);
      report(
        raw
          ? `Entity "${raw}" is not a valid name. Use letters, digits and underscores, starting with a letter${fixable ? `, e.g. "${safe}"` : ""}.`
          : "An entity has no name. Give every entity a PascalCase name such as \"Customer\".",
        { entity: raw },
        fixable ? () => renameEntity(schema, entity, safe) : undefined
      );
    }
  }),

  rule("DUPLICATE_ENTITY_NAME", "error", (schema, report) => {
    for (const dup of findDuplicates(entitiesOf(schema).map((e) => e.name))) {
      report(`Entity "${dup}" is defined more than once. Merge the definitions into one entity or rename one of them.`, {
        entity: dup,
      });
    }
  }),

  rule("RESERVED_ENTITY_NAME", "error", (schema, report) => {
    const names = new Set(entitiesOf(schema).map((e) => e.name));
    for (const entity of entitiesOf(schema)) {
      const { name } = entity;
      const reserved = RESERVED_CLASS_NAMES.has(name);
      if (!reserved && !GENERATED_IMPORTS.has(name)) continue;
      const safe = freeName(`${pascalCase(name)}Record`, (n) => names.has(n));
      report(
        reserved
          ? `Entity "${name}" is a reserved word in TypeScript and cannot name a class. Rename it, e.g. to "${safe}".`
          : `Entity "${name}" has the same name as "${name}", which the generated code imports from a library, so it would not compile. Rename it, e.g. to "${safe}".`,
        { entity: name },
        () => renameEntity(schema, entity, safe)
      );
    }
  }),

  rule("INVALID_FIELD_NAME", "error", (schema, report) => {
    for (const entity of entitiesOf(schema)) {
      const fields = fieldsOf(entity);
      for (const field of fields) {
        if (typeof field.name === "string" && IDENTIFIER.test(field.name)) continue;
        const raw = typeof field.name === "string" ? field.name : "";
        const safe = raw.trim().replace(/[^A-Za-z0-9_]+/g, "_").replace(/^(\d)/, "_$1");
        const fixable = IDENTIFIER.test(safe) && !fields.some((f) => f.name === safe);
        report(
          raw
            ? `Field "${raw}" on entity "${entity.name}" is not a valid name. Use letters, digits and underscores${fixable ? `, e.g. "${safe}"` : ""}.`
            : `Entity "${entity.name}" has a field with no name. Name it or remove it.`,
          { entity: entity.name, field: raw },
          fixable ? () => renameField(entity, field, safe) : undefined
        );
      }
    }
  }),

  rule("DUPLICATE_FIELD_NAME", "error", (schema, report) => {
    for (const entity of entitiesOf(schema)) {
      for (const dup of findDuplicates(fieldsOf(entity).map((f) => f.name))) {
        report(
          `Entity "${entity.name}" has more than one field named "${dup}". Keep one and remove or rename the others.`,
          { entity: entity.name, field: dup },
          () => {
            const first = fieldsOf(entity).findIndex((f) => f.name === dup);
            entity.fields = fieldsOf(entity).filter((f, i) => f.name !== dup || i === first);
          }
        );
      }
    }
  }),

  rule("UNKNOWN_FIELD_TYPE", "error", (schema, report) => {
    for (const entity of entitiesOf(schema)) {
      for (const field of fieldsOf(entity)) {
        const type = typeof field.type === "string" ? field.type : "";
        if (FIELD_TYPES.has(type) || NORMALIZED_TYPES.has(type.toLowerCase())) continue;
        const lower = type.toLowerCase().trim();
        const fixed = TYPE_ALIASES[lower] || (FIELD_TYPES.has(lower) ? lower : undefined);
        report(
          type
            ? `Field "${field.name}" on entity "${entity.name}" has type "${type}", which Apso cannot generate.${fixed ? ` Use "${fixed}".` : " Use a supported type such as text, varchar, integer, decimal, boolean, timestamptz, uuid, jsonb or enum."}`
            : `Field "${field.name}" on entity "${entity.name}" has no type. Set one, e.g. "text".`,
          { entity: entity.name, field: field.name },
          fixed ? () => (field.type = fixed) : undefined
        );
      }
    }
  }),

  rule("ENUM_WITHOUT_VALUES", "error", (schema, report) => {
    for (const entity of entitiesOf(schema)) {
      for (const field of fieldsOf(entity)) {
        if (field.type !== "enum" || (Array.isArray(field.values) && field.values.length > 0)) continue;
        report(
          `Enum field "${field.name}" on entity "${entity.name}" has no values. Add a "values" list (e.g. ["active", "archived"]) or change the type to "text".`,
          { entity: entity.name, field: field.name },
          () => {
            field.type = "text";
            delete field.values;
            delete field.default;
          }
        );
      }
    }
  }),

  rule("RELATIONSHIP_MALFORMED", "error", (schema, report) => {
    relationshipsOf(schema).forEach((rel, i) => {
      if (typeof rel?.from === "string" && typeof rel?.to === "string") return;
      const keys = rel && typeof rel === "object" ? Object.keys(rel).join(", ") : String(rel);
      report(
        `Relationship #${i + 1} has no "from" and "to" (it has: ${keys}). Apso skips it, so the relationship is never generated. Write it as { "from": "Order", "to": "Customer", "type": "ManyToOne" }.`,
        { relationship: `#${i + 1}` }
      );
    });
  }),

  rule("RELATIONSHIP_INVALID_TYPE", "error", (schema, report) => {
    for (const rel of relationshipsOf(schema).filter(isWellFormed)) {
      if (RELATIONSHIP_TYPES.includes(rel.type)) continue;
      const loose = String(rel.type ?? "").replace(/[^a-z]/gi, "").toLowerCase();
      const fixed = RELATIONSHIP_TYPES.find((t) => t.toLowerCase() === loose);
      report(
        `Relationship ${describeRelationship(rel)} has type "${rel.type}". Use one of ${RELATIONSHIP_TYPES.join(", ")}.`,
        { relationship: describeRelationship(rel) },
        fixed ? () => (rel.type = fixed) : undefined
      );
    }
  }),

  rule("RELATIONSHIP_MISSING_ENTITY", "error", (schema, report) => {
    const names = entitiesOf(schema).map((e) => e.name);
    for (const rel of relationshipsOf(schema).filter(isWellFormed)) {
      for (const end of ["from", "to"] as const) {
        if (names.includes(rel[end])) continue;
        const match = names.find((n) => typeof n === "string" && n.toLowerCase() === rel[end].toLowerCase());
        report(
          `Relationship ${describeRelationship(rel)} refers to entity "${rel[end]}", which is not defined.${match ? ` Did you mean "${match}"?` : " Add the entity or remove the relationship."}`,
          { relationship: describeRelationship(rel), entity: rel[end] },
          match ? () => (rel[end] = match) : undefined
        );
      }
    }
  }),

  rule("FOREIGN_KEY_FIELD_DUPLICATE", "error", (schema, report) => {
    const { props } = relationshipProperties(schema);
    for (const entity of entitiesOf(schema)) {
      for (const field of fieldsOf(entity)) {
        const prop = props.get(entity.name)?.get(field.name);
        if (!prop?.foreignKey) continue;
        report(
          `Field "${field.name}" on entity "${entity.name}" duplicates the foreign key column that relationship ${describeRelationship(prop.side.rel)} already generates. Remove the field; the relationship creates "${field.name}".`,
          { entity: entity.name, field: field.name, relationship: describeRelationship(prop.side.rel) },
          () => (entity.fields = fieldsOf(entity).filter((f) => f !== field))
        );
      }
    }
  }),

  rule("FIELD_RELATIONSHIP_COLLISION", "error", (schema, report) => {
    const { props } = relationshipProperties(schema);
    for (const entity of entitiesOf(schema)) {
      const fields = fieldsOf(entity);
      for (const field of fields) {
        const prop = props.get(entity.name)?.get(field.name);
        if (!prop || prop.foreignKey) continue;
        const taken = (n: string) => fields.some((f) => f.name === n) || Boolean(props.get(entity.name)?.has(n));
        const renamed = freeName(`${field.name}_${isText(field.type) ? "text" : "value"}`, taken);
        report(
          `Field "${field.name}" on entity "${entity.name}" has the same name as the property "${field.name}" that relationship ${describeRelationship(prop.side.rel)} generates on "${entity.name}". Rename the field, e.g. to "${renamed}".`,
          { entity: entity.name, field: field.name, relationship: describeRelationship(prop.side.rel) },
          () => renameField(entity, field, renamed)
        );
      }
    }
  }),

  rule("RELATIONSHIP_PROPERTY_CLASH", "error", (schema, report) => {
    const { props, clashes } = relationshipProperties(schema);
    for (const { entity, first, second } of clashes) {
      if (first.side.rel === second.side.rel) continue;
      const desc = describeRelationship(second.side.rel);
      const rel = second.side.rel;
      let fix: (() => void) | undefined;
      let hint = 'Give one of them a different "to_name".';
      if (second.side.isFrom) {
        const toName = freeName(`${camelCase(second.side.ref)}${pascalCase(rel.to)}`, (n) =>
          Boolean(props.get(entity)?.has(camelCase(n)))
        );
        hint = `Set "to_name" on ${desc} to "${toName}".`;
        fix = () => (rel.to_name = toName);
      } else if (rel.type === "ManyToOne") {
        hint = `Set "bi_directional": false on ${desc} so it does not add "${second.name}" to "${entity}".`;
        fix = () => (rel.bi_directional = false);
      }
      report(
        `Entity "${entity}" gets the property "${second.name}" from both ${describeRelationship(first.side.rel)} and ${desc}. ${hint}`,
        { entity, field: second.name, relationship: desc },
        fix
      );
    }
  }),

  rule("INDEX_UNKNOWN_FIELD", "error", (schema, report) => {
    const { props } = relationshipProperties(schema);
    for (const entity of entitiesOf(schema)) {
      const known = new Set([
        "id", "created_at", "updated_at",
        ...fieldsOf(entity).map((f) => f.name),
        ...(props.get(entity.name)?.keys() || []),
      ]);
      for (const kind of ["indexes", "uniques"] as const) {
        const list = entity[kind];
        if (!Array.isArray(list)) continue;
        for (const constraint of list) {
          const fields = Array.isArray(constraint?.fields) ? constraint.fields : [];
          const missing = fields.filter((n) => !known.has(n));
          if (fields.length > 0 && missing.length === 0) continue;
          report(
            fields.length === 0
              ? `Entity "${entity.name}" has an entry in "${kind}" without a "fields" list. Write it as { "fields": ["fieldName"] } or remove it.`
              : `Entity "${entity.name}" has an entry in "${kind}" on ${missing.map((n) => `"${n}"`).join(", ")}, which is not a field of "${entity.name}". Point it at an existing field or remove it.`,
            { entity: entity.name, field: missing[0] },
            () => {
              constraint.fields = fields.filter((n) => known.has(n));
              if (constraint.fields.length === 0) entity[kind] = (entity[kind] as unknown[]).filter((c) => c !== constraint) as never;
            }
          );
        }
      }
    }
  }),

  rule("REQUIRED_RELATIONSHIP_CYCLE", "error", (schema, report) => {
    // Edge child -> parent for every non-nullable foreign key (relationships are NOT NULL by default).
    const edges: { from: string; to: string; rel: SchemaRelationship }[] = [];
    for (const rel of relationshipsOf(schema).filter(isWellFormed)) {
      if (rel.nullable) continue;
      if (rel.type === "ManyToOne") edges.push({ from: rel.from, to: rel.to, rel });
      if (rel.type === "OneToMany") edges.push({ from: rel.to, to: rel.from, rel });
    }
    // ponytail: O(n^2) reachability, fine for schema-sized graphs (tens of entities).
    const reach = (start: string): Set<string> => {
      const seen = new Set<string>();
      const stack = [start];
      while (stack.length) {
        const node = stack.pop()!;
        for (const e of edges) if (e.from === node && !seen.has(e.to)) (seen.add(e.to), stack.push(e.to));
      }
      return seen;
    };
    const reported = new Set<string>();
    for (const edge of edges) {
      if (!reach(edge.to).has(edge.from) && edge.from !== edge.to) continue;
      const cycle = [...new Set([edge.from, ...[...reach(edge.from)].filter((n) => reach(n).has(edge.from))])].sort();
      const key = cycle.join(",");
      if (reported.has(key)) continue;
      reported.add(key);
      const desc = describeRelationship(edge.rel);
      report(
        cycle.length === 1
          ? `${desc} is required, so the first "${edge.from}" row can never be inserted (it must point at an existing "${edge.from}"). Set "nullable": true on it.`
          : `Required relationships form a cycle between ${cycle.map((n) => `"${n}"`).join(", ")}, so none of them can be inserted first. Set "nullable": true on one of them, e.g. ${desc}.`,
        { relationship: desc, entity: edge.from },
        () => (edge.rel.nullable = true)
      );
    }
  }),

  // ---------------------------------------------------------------- warnings

  rule("ID_FIELD", "warning", (schema, report) => {
    for (const entity of entitiesOf(schema)) {
      for (const field of fieldsOf(entity)) {
        if (typeof field.name !== "string" || field.name.toLowerCase() !== "id" || field.primary) continue;
        report(
          `Entity "${entity.name}" defines an "id" field. Apso generates the primary key, so this field is ignored; remove it.`,
          { entity: entity.name, field: field.name },
          () => (entity.fields = fieldsOf(entity).filter((f) => f !== field))
        );
      }
    }
  }),

  rule("IDENTIFIER_TOO_LONG", "warning", (schema, report) => {
    const { props } = relationshipProperties(schema);
    const tooLong = (s: string) => s.length > MAX_IDENTIFIER;
    const tables = new Map(entitiesOf(schema).map((e) => [e.name, typeof e.name === "string" ? tableName(e) : ""]));
    for (const entity of entitiesOf(schema)) {
      const table = tables.get(entity.name) || "";
      if (tooLong(table)) {
        report(`Table name "${table}" for entity "${entity.name}" is ${table.length} characters; Postgres truncates names over ${MAX_IDENTIFIER}, so hand-written SQL and migrations will not find it. Shorten the entity name or set a shorter "table".`, {
          entity: entity.name,
        });
      }
      const columns = [...fieldsOf(entity).map((f) => f.name), ...[...(props.get(entity.name)?.values() || [])].filter((p) => p.foreignKey).map((p) => p.name)];
      for (const column of columns.filter((c) => typeof c === "string" && tooLong(c))) {
        report(`Column "${column}" on entity "${entity.name}" is ${column.length} characters; Postgres truncates names over ${MAX_IDENTIFIER}. Use a shorter name.`, {
          entity: entity.name,
          field: column,
        });
      }
    }
    // TypeORM's default join table name: snake_case(<owner table>_<property>_<other table>).
    for (const rel of relationshipsOf(schema)) {
      if (rel.type !== "ManyToMany" || !tables.has(rel.from) || !tables.has(rel.to)) continue;
      const join = rel.joinTableName || snakeCase(`${tables.get(rel.from)}_${camelCase(pluralize(rel.to_name || rel.to))}_${tables.get(rel.to)}`);
      if (tooLong(join)) {
        report(`The join table "${join}" for ${describeRelationship(rel)} is ${join.length} characters; Postgres truncates names over ${MAX_IDENTIFIER}. Set a shorter "joinTableName" on the relationship.`, {
          relationship: describeRelationship(rel),
        });
      }
    }
  }),

  rule("RESERVED_TABLE_NAME", "warning", (schema, report) => {
    for (const entity of entitiesOf(schema)) {
      if (typeof entity.name !== "string" || !IDENTIFIER.test(entity.name)) continue;
      const table = tableName(entity);
      if (!PG_RESERVED.has(table.toLowerCase())) continue;
      report(
        `Entity "${entity.name}" maps to the table "${table}", a reserved word in Postgres. Generated code quotes it, but hand-written SQL must too. Set "table": "${table}_record" to avoid it.`,
        { entity: entity.name }
      );
    }
  }),

  rule("ENTITY_NAME_STYLE", "warning", (schema, report) => {
    for (const entity of entitiesOf(schema)) {
      const { name } = entity;
      if (typeof name !== "string" || !IDENTIFIER.test(name)) continue;
      const singular = pluralize.singular(name);
      if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
        report(`Entity "${name}" should be PascalCase, e.g. "${pascalCase(singular)}".`, { entity: name });
      } else if (singular !== name && pluralize.isPlural(name)) {
        report(`Entity "${name}" is plural. Name entities in the singular, e.g. "${singular}"; Apso pluralizes routes and collections itself.`, {
          entity: name,
        });
      }
    }
  }),

  rule("FIELD_NAME_STYLE", "warning", (schema, report) => {
    for (const entity of entitiesOf(schema)) {
      const names = fieldsOf(entity).map((f) => f.name).filter((n) => typeof n === "string" && !["created_at", "updated_at"].includes(n));
      const snake = names.filter((n) => /[a-z0-9]_[a-z0-9]/.test(n));
      const camel = names.filter((n) => /[a-z0-9][A-Z]/.test(n));
      if (snake.length === 0 || camel.length === 0) continue;
      report(
        `Entity "${entity.name}" mixes snake_case fields (${snake.slice(0, 2).join(", ")}) and camelCase fields (${camel.slice(0, 2).join(", ")}). Pick one style for the API.`,
        { entity: entity.name }
      );
    }
  }),

  rule("EMAIL_NOT_UNIQUE", "warning", (schema, report) => {
    for (const entity of entitiesOf(schema)) {
      const singleUniques = new Set([
        ...listOf(entity.uniques).filter((u) => u?.fields?.length === 1).map((u) => u.fields[0]),
        ...listOf(entity.indexes).filter((i) => i?.unique && i.fields?.length === 1).map((i) => i.fields[0]),
      ]);
      for (const field of fieldsOf(entity)) {
        if (!/^(email|email_address|emailAddress)$/.test(field.name) || isUnique(field) || singleUniques.has(field.name)) continue;
        report(
          `Field "${field.name}" on entity "${entity.name}" is not unique. If each ${entity.name} has its own email, set "isUnique": true so duplicates are rejected.`,
          { entity: entity.name, field: field.name }
        );
      }
    }
  }),

  rule("FOREIGN_KEY_NOT_INDEXED", "warning", (schema, report) => {
    const { props } = relationshipProperties(schema);
    for (const entity of entitiesOf(schema)) {
      const indexedFirst = new Set(listOf(entity.indexes).map((i) => i?.fields?.[0]));
      const keys = [...(props.get(entity.name)?.values() || [])].filter(
        (p) => p.foreignKey && !p.side.rel.index && !indexedFirst.has(p.name)
      );
      if (keys.length === 0) continue;
      report(
        `Foreign key${keys.length > 1 ? "s" : ""} ${keys.map((k) => `"${k.name}"`).join(", ")} on entity "${entity.name}" ${keys.length > 1 ? "have" : "has"} no index, so loading related ${entity.name} rows scans the table. Set "index": true on ${keys.map((k) => describeRelationship(k.side.rel)).join("; ")}.`,
        { entity: entity.name, field: keys[0].name }
      );
    }
  }),

  rule("ENTITY_WITHOUT_FIELDS", "warning", (schema, report) => {
    for (const entity of entitiesOf(schema)) {
      if (fieldsOf(entity).length > 0) continue;
      report(`Entity "${entity.name}" has no fields of its own, only an id and relationships. Add the data it stores, or replace it with a ManyToMany if it only links two entities.`, {
        entity: entity.name,
      });
    }
  }),

  rule("MISSING_TIMESTAMPS", "warning", (schema, report) => {
    for (const entity of entitiesOf(schema)) {
      const names = new Set(fieldsOf(entity).map((f) => f.name));
      const missing = (["created_at", "updated_at"] as const).filter((k) => entity[k] !== true && !names.has(k));
      if (missing.length === 0) continue;
      report(`Entity "${entity.name}" does not track ${missing.join(" or ")}. Set ${missing.map((k) => `"${k}": true`).join(" and ")} unless rows never change.`, {
        entity: entity.name,
      });
    }
  }),
];
