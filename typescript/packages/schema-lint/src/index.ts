import { rules } from "./rules";
import { Finding, LintIssue, LintResult, Schema } from "./types";

export * from "./types";
export { rules } from "./rules";
export { relationshipProperties } from "./naming";

function findings(schema: Schema): Finding[] {
  if (!schema || typeof schema !== "object") {
    return [
      {
        issue: {
          rule: "INVALID_SCHEMA",
          severity: "error",
          message: 'The schema is not an object. Expected { "entities": [...], "relationships": [...] }.',
          fixable: false,
        },
      },
    ];
  }
  return rules.flatMap((r) => r.check(schema));
}

/** Lint a .apsorc schema. Errors mean the CLI would scaffold code that does not compile. */
export function lintSchema(schema: Schema): LintResult {
  const issues = findings(schema).map((f) => f.issue);
  const errorCount = issues.filter((i) => i.severity === "error").length;
  return { issues, errorCount, warningCount: issues.length - errorCount };
}

/**
 * Apply every deterministic fix (renames, type corrections, dropping duplicate
 * or ignored fields) to a copy of the schema. Never removes an entity or a
 * relationship. Re-lint the result: issues without a fix remain.
 */
export function fixSchema<T extends Schema>(schema: T): { schema: T; applied: LintIssue[] } {
  const working: T = JSON.parse(JSON.stringify(schema));
  const applied: LintIssue[] = [];
  // One fix per pass so each fix sees the names the previous one produced.
  // ponytail: capped at 200 passes; a schema needing more is not a real one.
  for (let pass = 0; pass < 200; pass++) {
    const next = findings(working).find((f) => f.fix);
    if (!next) break;
    next.fix!();
    applied.push(next.issue);
  }
  return { schema: working, applied };
}

/** Plain-text report for an LLM prompt or a terminal. */
export function formatLintReport(result: LintResult): string {
  if (result.issues.length === 0) return "No schema issues found.";
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const lines = [`${plural(result.errorCount, "error")}, ${plural(result.warningCount, "warning")}`];
  for (const severity of ["error", "warning"] as const) {
    for (const issue of result.issues.filter((i) => i.severity === severity)) {
      const where = issue.entity ? ` ${issue.entity}${issue.field ? `.${issue.field}` : ""}` : "";
      lines.push(`- ${severity.toUpperCase()} ${issue.rule}${where}: ${issue.message}${issue.fixable ? " (auto-fixable)" : ""}`);
    }
  }
  return lines.join("\n");
}
