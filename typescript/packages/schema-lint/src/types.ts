/**
 * The .apsorc v2 shape the linter reads. Loose on purpose: it accepts both the
 * CLI spelling (`unique`, `index`) and the platform/AI spelling (`isUnique`,
 * `isIndex`), and every property is optional so half-built AI output lints
 * instead of throwing.
 */
export interface SchemaField {
  name: string;
  type: string;
  nullable?: boolean;
  unique?: boolean;
  isUnique?: boolean;
  index?: boolean;
  isIndex?: boolean;
  primary?: boolean;
  values?: string[];
  default?: unknown;
  length?: number;
}

export interface SchemaIndex {
  fields: string[];
  unique?: boolean;
}

export interface SchemaUnique {
  fields: string[];
  name?: string;
}

export interface SchemaEntity {
  name: string;
  /** Explicit table name; defaults to the snake_cased entity name. */
  table?: string;
  fields?: SchemaField[];
  indexes?: SchemaIndex[];
  uniques?: SchemaUnique[];
  created_at?: boolean;
  updated_at?: boolean;
}

export interface SchemaRelationship {
  from: string;
  to: string;
  type: string;
  to_name?: string;
  nullable?: boolean;
  bi_directional?: boolean;
  index?: boolean;
  joinTableName?: string;
}

export interface Schema {
  entities: SchemaEntity[];
  relationships?: SchemaRelationship[];
}

export type Severity = "error" | "warning";

export interface LintIssue {
  /** Stable rule id, e.g. FIELD_RELATIONSHIP_COLLISION. */
  rule: string;
  severity: Severity;
  entity?: string;
  field?: string;
  /** The relationship involved, e.g. `Note ManyToOne Contact`. */
  relationship?: string;
  message: string;
  /** fixSchema can resolve this issue without dropping entities or relationships. */
  fixable: boolean;
}

export interface LintResult {
  issues: LintIssue[];
  errorCount: number;
  warningCount: number;
}

/** A rule's raw output: the issue plus, when fixable, the mutation that fixes it. */
export interface Finding {
  issue: LintIssue;
  fix?: () => void;
}

export interface Rule {
  id: string;
  severity: Severity;
  check: (schema: Schema) => Finding[];
}
