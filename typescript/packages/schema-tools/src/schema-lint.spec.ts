import { fixSchema, formatLintReport, lintSchema, rules, Schema, SchemaEntity, SchemaField } from "./index";
import namingCases from "./fixtures/codegen-naming-cases.json";

const errors = (schema: Schema) => lintSchema(schema).issues.filter((i) => i.severity === "error");
const rulesHit = (schema: Schema) => lintSchema(schema).issues.map((i) => i.rule);
const entity = (name: string, fields: SchemaField[] = [{ name: "label", type: "text" }]): SchemaEntity =>
  ({ name, created_at: true, updated_at: true, fields });

// Canonical codegen naming cases, ported from the client
// (tests/fixtures/codegen-naming-cases.json) and the CLI
// (test/fixtures/codegen-naming-cases.json), which held identical copies.
describe("codegen naming cases", () => {
  for (const c of namingCases.cases) {
    test(c.name, () => {
      const found = errors(c.schema as unknown as Schema);
      if (!c.error) return expect(found).toEqual([]);
      expect(found[0]).toMatchObject({ rule: c.error.code, entity: c.error.entity, ...("field" in c.error ? { field: c.error.field } : {}) });
    });
  }

  test("every fixable naming case lints clean after fixSchema, keeping entities and relationships", () => {
    for (const c of namingCases.cases) {
      const schema = c.schema as unknown as Schema;
      const { schema: fixed } = fixSchema(schema);
      if (c.error?.code === "DUPLICATE_ENTITY_NAME") continue; // not auto-fixable by design
      expect(errors(fixed)).toEqual([]);
      expect(fixed.entities).toHaveLength(schema.entities.length);
      expect(fixed.relationships).toHaveLength(schema.relationships!.length);
    }
  });

  test("the service 4720 collision is renamed to notes_text", () => {
    const { schema, applied } = fixSchema(namingCases.cases[0].schema as unknown as Schema);
    expect(schema.entities[0].fields!.map((f) => f.name)).toEqual(["notes_text"]);
    expect(applied.map((i) => i.rule)).toEqual(["FIELD_RELATIONSHIP_COLLISION"]);
  });
});

describe("error rules", () => {
  test("RESERVED_ENTITY_NAME: library imports and TS keywords, renamed with relationships", () => {
    const schema: Schema = {
      entities: [entity("Module"), entity("Course")],
      relationships: [{ from: "Module", to: "Course", type: "ManyToOne" }],
    };
    expect(rulesHit(schema)).toContain("RESERVED_ENTITY_NAME");
    const { schema: fixed } = fixSchema(schema);
    expect(fixed.entities[0].name).toBe("ModuleRecord");
    expect(fixed.relationships![0].from).toBe("ModuleRecord");
    expect(rulesHit({ entities: [entity("class")] })).toContain("RESERVED_ENTITY_NAME");
  });

  test("INVALID_ENTITY_NAME fixes to PascalCase and updates relationships", () => {
    const schema: Schema = {
      entities: [entity("Line Item"), entity("Order1")],
      relationships: [{ from: "Line Item", to: "Order1", type: "ManyToOne" }],
    };
    const { schema: fixed } = fixSchema(schema);
    expect(fixed.entities[0].name).toBe("LineItem");
    expect(fixed.relationships![0].from).toBe("LineItem");
  });

  test("UNKNOWN_FIELD_TYPE: aliases fix, CLI spellings pass, unknown types stay errors", () => {
    const schema: Schema = {
      entities: [
        entity("Thing", [
          { name: "count", type: "number" },
          { name: "price", type: "double precision" },
          { name: "seen", type: "DateTime" },
          { name: "shape", type: "hologram" },
        ]),
      ],
    };
    const found = errors(schema).filter((i) => i.rule === "UNKNOWN_FIELD_TYPE");
    expect(found.map((i) => [i.field, i.fixable])).toEqual([["count", true], ["shape", false]]);
    expect(fixSchema(schema).schema.entities[0].fields![0].type).toBe("integer");
  });

  test("ENUM_WITHOUT_VALUES converts to text", () => {
    const schema: Schema = { entities: [entity("Task", [{ name: "status", type: "enum", values: [], default: "x" }])] };
    expect(rulesHit(schema)).toContain("ENUM_WITHOUT_VALUES");
    expect(fixSchema(schema).schema.entities[0].fields![0]).toEqual({ name: "status", type: "text" });
  });

  test("RELATIONSHIP_INVALID_TYPE and RELATIONSHIP_MISSING_ENTITY fix obvious typos only", () => {
    const schema: Schema = {
      entities: [entity("Note"), entity("Contact")],
      relationships: [
        { from: "Note", to: "contact", type: "many-to-one" },
        { from: "Note", to: "Ghost", type: "ManyToOne" },
      ],
    };
    const found = errors(schema);
    expect(found.map((i) => [i.rule, i.fixable])).toEqual([
      ["RELATIONSHIP_INVALID_TYPE", true],
      ["RELATIONSHIP_MISSING_ENTITY", true],
      ["RELATIONSHIP_MISSING_ENTITY", false],
    ]);
    const { schema: fixed } = fixSchema(schema);
    expect(fixed.relationships).toEqual([
      { from: "Note", to: "Contact", type: "ManyToOne" },
      { from: "Note", to: "Ghost", type: "ManyToOne" },
    ]);
  });

  test("FOREIGN_KEY_FIELD_DUPLICATE: a contactId field next to Note ManyToOne Contact is removed", () => {
    const schema: Schema = {
      entities: [entity("Note", [{ name: "body", type: "text" }, { name: "contactId", type: "integer" }]), entity("Contact")],
      relationships: [{ from: "Note", to: "Contact", type: "ManyToOne" }],
    };
    expect(errors(schema).map((i) => i.rule)).toEqual(["FOREIGN_KEY_FIELD_DUPLICATE"]);
    expect(fixSchema(schema).schema.entities[0].fields!.map((f) => f.name)).toEqual(["body"]);
    // to_name changes the generated column
    schema.relationships![0].to_name = "owner";
    expect(errors(schema)).toEqual([]);
  });

  test("FIELD_RELATIONSHIP_COLLISION keeps indexes and uniques in sync and avoids taken names", () => {
    const schema: Schema = {
      entities: [
        {
          ...entity("Contact", [{ name: "notes", type: "integer" }, { name: "notes_value", type: "text" }]),
          indexes: [{ fields: ["notes"] }],
          uniques: [{ fields: ["notes", "notes_value"] }],
        },
        entity("Note"),
      ],
      relationships: [{ from: "Note", to: "Contact", type: "ManyToOne" }],
    };
    const fixed = fixSchema(schema).schema.entities[0];
    expect(fixed.fields!.map((f) => f.name)).toEqual(["notes_value2", "notes_value"]);
    expect(fixed.indexes![0].fields).toEqual(["notes_value2"]);
    expect(fixed.uniques![0].fields).toEqual(["notes_value2", "notes_value"]);
  });

  test("RELATIONSHIP_PROPERTY_CLASH is fixed with a to_name on the declaring side", () => {
    const { schema } = fixSchema(namingCases.cases[4].schema as unknown as Schema);
    expect(schema.relationships![1].to_name).toBe("ownerTeam");
  });

  test("INDEX_UNKNOWN_FIELD allows generated columns and drops unknown ones", () => {
    const schema: Schema = {
      entities: [
        { ...entity("Note"), indexes: [{ fields: ["contactId", "created_at"] }, { fields: ["ghost"] }], uniques: [{ fields: ["label", "nope"] }] },
        entity("Contact"),
      ],
      relationships: [{ from: "Note", to: "Contact", type: "ManyToOne" }],
    };
    expect(errors(schema).map((i) => [i.rule, i.field])).toEqual([
      ["INDEX_UNKNOWN_FIELD", "ghost"],
      ["INDEX_UNKNOWN_FIELD", "nope"],
    ]);
    const fixed = fixSchema(schema).schema.entities[0];
    expect(fixed.indexes).toEqual([{ fields: ["contactId", "created_at"] }]);
    expect(fixed.uniques).toEqual([{ fields: ["label"] }]);
  });

  test("RELATIONSHIP_MALFORMED: entries without from/to are reported once, not as missing entities", () => {
    const schema = {
      entities: [entity("User"), entity("Session")],
      relationships: [{ name: "User", relationship: "hasMany", target: "Session" }],
    } as unknown as Schema;
    expect(errors(schema).map((i) => i.rule)).toEqual(["RELATIONSHIP_MALFORMED"]);
    expect(errors(schema)[0].message).toContain("it has: name, relationship, target");
  });

  test("REQUIRED_RELATIONSHIP_CYCLE: two-way and self-referencing required keys", () => {
    const schema: Schema = {
      entities: [entity("User"), entity("Workspace"), entity("Category")],
      relationships: [
        { from: "User", to: "Workspace", type: "ManyToOne" },
        { from: "Workspace", to: "User", type: "ManyToOne", to_name: "owner" },
        { from: "Category", to: "Category", type: "ManyToOne", to_name: "parent" },
      ],
    };
    expect(errors(schema).filter((i) => i.rule === "REQUIRED_RELATIONSHIP_CYCLE")).toHaveLength(2);
    const { schema: fixed } = fixSchema(schema);
    expect(errors(fixed)).toEqual([]);
    expect(fixed.relationships!.map((r) => Boolean(r.nullable))).toEqual([true, false, true]);
  });
});

describe("warning rules", () => {
  test("IDENTIFIER_TOO_LONG warns on table, column and join table names (Postgres truncates; linus runs a 68-char join table in prod)", () => {
    const long = "A".repeat(10) + "b".repeat(60);
    const schema: Schema = {
      entities: [entity("Tag", [{ name: "x".repeat(64), type: "text" }]), entity(long)],
      relationships: [{ from: "Tag", to: long, type: "ManyToMany" }],
    };
    expect(lintSchema(schema).issues.filter((i) => i.rule === "IDENTIFIER_TOO_LONG")).toHaveLength(3);
  });

  test("each warning fires on a schema that compiles", () => {
    const schema: Schema = {
      entities: [
        { name: "Users", fields: [{ name: "email", type: "text" }, { name: "first_name", type: "text" }, { name: "lastName", type: "text" }, { name: "id", type: "uuid" }] },
        { name: "Order", created_at: true, updated_at: true, fields: [] },
      ],
      relationships: [{ from: "Order", to: "Users", type: "ManyToOne" }],
    };
    const result = lintSchema(schema);
    expect(result.errorCount).toBe(0);
    expect([...new Set(result.issues.map((i) => i.rule))].sort()).toEqual([
      "EMAIL_NOT_UNIQUE",
      "ENTITY_NAME_STYLE",
      "ENTITY_WITHOUT_FIELDS",
      "FIELD_NAME_STYLE",
      "FOREIGN_KEY_NOT_INDEXED",
      "ID_FIELD",
      "MISSING_TIMESTAMPS",
      "RESERVED_TABLE_NAME",
    ]);
    expect(fixSchema(schema).schema.entities[0].fields!.map((f) => f.name)).not.toContain("id");
  });
});

describe("REDUNDANT_MANY_TO_MANY", () => {
  const bookClub = (): Schema => ({
    entities: [
      entity("Member"),
      entity("ReadingGroup"),
      entity("GroupMembership", [{ name: "joined_date", type: "date" }, { name: "role", type: "enum", values: ["member", "admin"] }]),
    ],
    relationships: [
      { from: "Member", to: "ReadingGroup", type: "ManyToMany" },
      { from: "GroupMembership", to: "Member", type: "ManyToOne" },
      { from: "ReadingGroup", to: "GroupMembership", type: "OneToMany" },
    ],
  });
  const redundant = (schema: Schema) => lintSchema(schema).issues.filter((i) => i.rule === "REDUNDANT_MANY_TO_MANY");

  test("warns on a ManyToMany a join entity already models, either declaration direction", () => {
    expect(redundant(bookClub())).toEqual([
      expect.objectContaining({ severity: "warning", entity: "Member", relationship: "Member ManyToMany ReadingGroup", fixable: true }),
    ]);
    expect(redundant(bookClub())[0].message).toContain('"GroupMembership"');
  });

  test("fixSchema removes only the direct ManyToMany", () => {
    const { schema, applied } = fixSchema(bookClub());
    expect(applied.map((i) => i.rule)).toEqual(["REDUNDANT_MANY_TO_MANY"]);
    expect(schema.relationships!.map((r) => r.type)).toEqual(["ManyToOne", "OneToMany"]);
    expect(redundant(schema)).toEqual([]);
  });

  test("no warning without a join entity linking both sides", () => {
    const schema = bookClub();
    schema.relationships = schema.relationships!.filter((r) => r.from !== "ReadingGroup");
    expect(redundant(schema)).toEqual([]);
  });
});

describe("api", () => {
  test("every rule has a unique id", () => {
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
  });

  test("malformed input lints instead of throwing", () => {
    expect(lintSchema(null as unknown as Schema).errorCount).toBe(1);
    expect(lintSchema({} as Schema).issues).toEqual([]);
    expect(() => lintSchema({ entities: [{ name: "A", fields: [{}] }] } as unknown as Schema)).not.toThrow();
  });

  test("fixSchema does not mutate its input", () => {
    const input = namingCases.cases[0].schema as unknown as Schema;
    const before = JSON.stringify(input);
    fixSchema(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  test("formatLintReport lists errors before warnings", () => {
    const report = formatLintReport(lintSchema(namingCases.cases[0].schema as unknown as Schema));
    const lines = report.split("\n");
    expect(lines[1]).toMatch(/^- ERROR FIELD_RELATIONSHIP_COLLISION Contact\.notes: .*"notes_text".*\(auto-fixable\)$/);
    expect(lines.slice(2).every((l) => l.startsWith("- WARNING"))).toBe(true);
    expect(formatLintReport(lintSchema({ entities: [] }))).toBe("No schema issues found.");
  });
});
