import {
  addEntity,
  addField,
  addIndex,
  addRelationship,
  describeEntity,
  getSchema,
  removeEntity,
  removeField,
  removeRelationship,
  renameEntity,
  renameField,
  runSchemaTool,
  Schema,
  schemaTools,
  updateField,
} from "./index";

const crm = (): Schema => ({
  entities: [
    {
      name: "Contact",
      created_at: true,
      updated_at: true,
      fields: [
        { name: "email", type: "text", unique: true },
        { name: "notes", type: "text", nullable: true },
      ],
      indexes: [{ fields: ["email"], unique: true }],
      uniques: [{ fields: ["email", "notes"], name: "contact_email_notes" }],
    },
    { name: "Company", created_at: true, updated_at: true, fields: [{ name: "name", type: "text" }] },
  ],
  relationships: [{ from: "Contact", to: "Company", type: "ManyToOne" }],
});

describe("schema tools", () => {
  test("every tool has a name, description and object input schema", () => {
    const names = schemaTools.map((t) => t.name);
    expect(names).toEqual([
      "get_schema", "describe_entity", "add_entity", "rename_entity", "remove_entity", "add_field",
      "update_field", "rename_field", "remove_field", "add_relationship", "remove_relationship", "add_index", "lint_schema",
    ]);
    for (const t of schemaTools) {
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.inputSchema.type).toBe("object");
    }
  });

  test("operations are pure: the input schema is never mutated", () => {
    const schema = crm();
    const snapshot = JSON.stringify(schema);
    addField(schema, { entity: "Contact", field: { name: "phone", type: "text" } });
    renameEntity(schema, { entity: "Company", newName: "Account" });
    removeEntity(schema, { entity: "Contact" });
    expect(JSON.stringify(schema)).toBe(snapshot);
  });

  test("get_schema outline and describe_entity", () => {
    const out = getSchema(crm(), {});
    expect(out.data).toContain("Contact: email:text (unique); notes:text (nullable)");
    expect(out.data).toContain("Contact ManyToOne Company");
    expect((getSchema(crm(), { format: "json" }).data as Schema).entities).toHaveLength(2);
    const d = describeEntity(crm(), { entity: "company" });
    expect(d.ok).toBe(true);
    expect((d.data as { relationships: unknown[] }).relationships).toHaveLength(1);
    expect(describeEntity(crm(), { entity: "Deal" }).message).toContain("Entities: Contact, Company");
  });

  test("add_entity with fields, defaults timestamps, refuses duplicates", () => {
    const r = addEntity(crm(), { name: "Deal", fields: [{ name: "amount", type: "decimal", precision: 12, scale: 2 }] });
    expect(r.ok).toBe(true);
    expect(r.schema.entities[2]).toEqual({
      name: "Deal", created_at: true, updated_at: true, fields: [{ name: "amount", type: "decimal", precision: 12, scale: 2 }],
    });
    expect(addEntity(crm(), { name: "Contact" }).ok).toBe(false);
  });

  test("rename_entity updates relationships and foreign key indexes", () => {
    const schema = crm();
    schema.entities[0].indexes!.push({ fields: ["companyId"] });
    const r = renameEntity(schema, { entity: "Company", newName: "Account" });
    expect(r.ok).toBe(true);
    expect(r.schema.relationships![0]).toMatchObject({ from: "Contact", to: "Account" });
    expect(r.schema.entities[0].indexes![1].fields).toEqual(["accountId"]);
  });

  test("remove_entity drops its relationships", () => {
    const r = removeEntity(crm(), { entity: "Company" });
    expect(r.ok).toBe(true);
    expect(r.schema.entities.map((e) => e.name)).toEqual(["Contact"]);
    expect(r.schema.relationships).toEqual([]);
  });

  test("add_field rejects an op that would add a lint error, with the reason", () => {
    // Contact already has `notes`; a Note ManyToOne Contact would generate a second `notes` property.
    let schema = addEntity(crm(), { name: "Note", fields: [{ name: "body", type: "text" }] }).schema;
    const rejected = addRelationship(schema, { from: "Note", to: "Contact", type: "ManyToOne" });
    expect(rejected.ok).toBe(false);
    expect(rejected.message).toContain("FIELD_RELATIONSHIP_COLLISION");
    expect(rejected.schema).toBe(schema);
    // Renaming the field first lets the relationship in.
    schema = renameField(schema, { entity: "Contact", field: "notes", newName: "notes_text" }).schema;
    expect(addRelationship(schema, { from: "Note", to: "Contact", type: "ManyToOne" }).ok).toBe(true);
  });

  test("add_field keeps the schema's unique/index spelling", () => {
    const platform: Schema = { entities: [{ name: "User", fields: [{ name: "email", type: "text", isUnique: true }] }], relationships: [] };
    const r = addField(platform, { entity: "User", field: { name: "handle", type: "text", unique: true } });
    expect(r.schema.entities[0].fields![1]).toEqual({ name: "handle", type: "text", isUnique: true });
    const cli = addField(crm(), { entity: "Company", field: { name: "domain", type: "text", unique: true } });
    expect(cli.schema.entities[1].fields![1]).toEqual({ name: "domain", type: "text", unique: true });
    expect(addField(crm(), { entity: "Contact", field: { name: "email", type: "text" } }).ok).toBe(false);
  });

  test("update_field merges changes, null removes a setting, enum values drop with the type", () => {
    let r = updateField(crm(), { entity: "Contact", field: "notes", changes: { type: "enum", values: ["a", "b"], nullable: null } });
    expect(r.schema.entities[0].fields![1]).toEqual({ name: "notes", type: "enum", values: ["a", "b"] });
    r = updateField(r.schema, { entity: "Contact", field: "notes", changes: { type: "text" } });
    expect(r.schema.entities[0].fields![1]).toEqual({ name: "notes", type: "text" });
    expect(updateField(crm(), { entity: "Contact", field: "status", changes: { nullable: true } }).message).toContain("Fields: email, notes");
  });

  test("an enum without values is rejected", () => {
    const r = updateField(crm(), { entity: "Contact", field: "notes", changes: { type: "enum" } });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("ENUM_WITHOUT_VALUES");
  });

  test("rename_field and remove_field keep indexes and uniques in sync", () => {
    const renamed = renameField(crm(), { entity: "Contact", field: "email", newName: "emailAddress" });
    expect(renamed.schema.entities[0].indexes).toEqual([{ fields: ["emailAddress"], unique: true }]);
    expect(renamed.schema.entities[0].uniques![0].fields).toEqual(["emailAddress", "notes"]);
    const removed = removeField(crm(), { entity: "Contact", field: "email" });
    expect(removed.schema.entities[0].indexes).toEqual([]);
    expect(removed.schema.entities[0].uniques![0].fields).toEqual(["notes"]);
  });

  test("add/remove relationship", () => {
    expect(addRelationship(crm(), { from: "Contact", to: "Company", type: "ManyToOne" }).ok).toBe(false);
    expect(addRelationship(crm(), { from: "Contact", to: "Deal", type: "ManyToOne" }).message).toContain('"Deal" not found');
    const r = removeRelationship(crm(), { from: "contact", to: "company" });
    expect(r.ok).toBe(true);
    expect(r.schema.relationships).toEqual([]);
    expect(removeRelationship(crm(), { from: "Company", to: "Contact" }).ok).toBe(false);
  });

  test("add_index accepts foreign key columns and rejects unknown fields", () => {
    expect(addIndex(crm(), { entity: "Contact", fields: ["companyId"] }).ok).toBe(true);
    const bad = addIndex(crm(), { entity: "Contact", fields: ["nope"] });
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain("INDEX_UNKNOWN_FIELD");
  });

  test("an op on a schema that already has errors only fails on new errors", () => {
    const broken: Schema = { entities: [{ name: "Thing", fields: [{ name: "kind", type: "enum" }] }], relationships: [] };
    const r = addField(broken, { entity: "Thing", field: { name: "label", type: "text" } });
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.rule === "ENUM_WITHOUT_VALUES")).toBe(true);
  });

  test("runSchemaTool validates input against the JSON schema", () => {
    expect(runSchemaTool(crm(), "add_field", { entity: "Contact" }).message).toBe("Invalid input for add_field: input.field is required.");
    expect(runSchemaTool(crm(), "add_relationship", { from: "Contact", to: "Company", type: "HasMany" }).message).toContain("must be one of");
    expect(runSchemaTool(crm(), "add_field", { entity: "Contact", field: { name: "x", type: "text", bogus: 1 } }).message).toContain("not a known property");
    expect(runSchemaTool(crm(), "nope").ok).toBe(false);
    const lint = runSchemaTool(crm(), "lint_schema");
    expect(lint.ok).toBe(true);
    expect(lint.message).toContain("0 errors");
  });
});
