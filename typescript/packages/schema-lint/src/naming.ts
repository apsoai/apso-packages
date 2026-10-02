import pluralize from "pluralize";
import { Schema, SchemaRelationship } from "./types";

// Casing helpers copied from @apso/cli src/lib/utils/casing.ts. The linter has
// to predict the exact identifiers the CLI emits, so these must stay in sync.
export function camelCase(str: string): string {
  return str
    .replace(/([\da-z])([A-Z])/g, "$1 $2")
    .replace(/[ _-]+/g, " ")
    .toLowerCase()
    .replace(/ (\w)/g, (_, c) => (c ? c.toUpperCase() : ""))
    .replace(/ /g, "");
}

export const snakeCase = (str: string): string =>
  str[0].toLowerCase() +
  str.slice(1).replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

export function pascalCase(str: string): string {
  const c = camelCase(str);
  return c.charAt(0).toUpperCase() + c.slice(1);
}

/** Table name the CLI uses for an entity (cli#98: `table` overrides). */
export const tableName = (entity: { name: string; table?: string }): string =>
  entity.table || snakeCase(entity.name);

export const RELATIONSHIP_TYPES = ["OneToMany", "ManyToOne", "ManyToMany", "OneToOne"];

export const describeRelationship = (rel: SchemaRelationship): string =>
  `${rel.from} ${rel.type} ${rel.to}${rel.to_name ? ` (to_name "${rel.to_name}")` : ""}`;

/** One end of a relationship, as the CLI's parseRelationship emits it. */
export interface RelationshipSide {
  entity: string;
  other: string;
  type: string;
  /** Property base name (to_name or entity name) before camelCase/pluralize. */
  ref: string;
  rel: SchemaRelationship;
  /** True for the side the .apsorc entry is declared on (where to_name applies). */
  isFrom: boolean;
}

/** A TypeScript property the CLI generates on an entity for a relationship. */
export interface GeneratedProperty {
  name: string;
  /** The ManyToOne foreign key column (`contactId`) rather than the relation itself. */
  foreignKey: boolean;
  side: RelationshipSide;
}

/**
 * Both ends of every relationship, mirroring parseRelationship in
 * @apso/cli src/lib/utils/relationships/parse.ts: ManyToOne and OneToMany are
 * bidirectional (ManyToOne unless bi_directional: false or self-referencing);
 * ManyToMany and OneToOne only when either declaration sets bi_directional.
 */
export function relationshipSides(schema: Schema): RelationshipSide[] {
  const all = Array.isArray(schema.relationships) ? schema.relationships : [];
  const sides: RelationshipSide[] = [];
  for (const rel of all) {
    const { from, to } = rel || {};
    if (typeof from !== "string" || typeof to !== "string") continue;
    const toRef = rel.to_name || to;
    const inverse = all.find((d) => d.from === to && d.to === from && d.type === rel.type);
    if (rel.type === "ManyToOne") {
      sides.push({ entity: from, other: to, type: "ManyToOne", ref: toRef, rel, isFrom: true });
      if (rel.bi_directional !== false && from !== to) {
        sides.push({ entity: to, other: from, type: "OneToMany", ref: from, rel, isFrom: false });
      }
    } else if (rel.type === "OneToMany") {
      sides.push({ entity: from, other: to, type: "OneToMany", ref: toRef, rel, isFrom: true });
      sides.push({ entity: to, other: from, type: "ManyToOne", ref: from, rel, isFrom: false });
    } else if (rel.type === "ManyToMany" || rel.type === "OneToOne") {
      sides.push({ entity: from, other: to, type: rel.type, ref: toRef, rel, isFrom: true });
      if (rel.bi_directional || inverse?.bi_directional) {
        sides.push({ entity: to, other: from, type: rel.type, ref: inverse?.to_name || from, rel, isFrom: false });
      }
    }
  }
  return sides;
}

/**
 * Properties the CLI generates per entity, deduped the way
 * getRelationshipForTemplate does (by other entity + reference name), plus any
 * property that two different relationships both generate on one entity.
 */
export function relationshipProperties(schema: Schema): {
  props: Map<string, Map<string, GeneratedProperty>>;
  clashes: { entity: string; first: GeneratedProperty; second: GeneratedProperty }[];
} {
  const props = new Map<string, Map<string, GeneratedProperty>>();
  const clashes: { entity: string; first: GeneratedProperty; second: GeneratedProperty }[] = [];
  const seenKeys = new Set<string>();
  for (const side of relationshipSides(schema)) {
    const key = `${side.entity}|${side.other}:${side.ref}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const plural = side.type === "OneToMany" || side.type === "ManyToMany";
    const relation = camelCase(plural ? pluralize(side.ref) : side.ref);
    const generated: GeneratedProperty[] = [{ name: relation, foreignKey: false, side }];
    if (side.type === "ManyToOne") generated.push({ name: `${relation}Id`, foreignKey: true, side });

    if (!props.has(side.entity)) props.set(side.entity, new Map());
    const entityProps = props.get(side.entity)!;
    for (const prop of generated) {
      const existing = entityProps.get(prop.name);
      if (existing) {
        clashes.push({ entity: side.entity, first: existing, second: prop });
        continue;
      }
      entityProps.set(prop.name, prop);
    }
  }
  return { props, clashes };
}
