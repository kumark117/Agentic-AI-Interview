/** Human-readable labels for API enum values shown in the UI. */

export function formatEvaluationSource(source: string): string {
  if (source === "llm") return "LLM";
  if (source === "fallback_timeout") return "Fallback (timeout)";
  return source;
}

export function formatQuestionSource(source: string): string {
  if (source === "interviewer_agent") return "Interviewer agent";
  if (source === "fallback_bank") return "Fallback bank";
  return source;
}

function cloneReport(report: Record<string, unknown>): Record<string, unknown> {
  if (typeof structuredClone === "function") {
    return structuredClone(report) as Record<string, unknown>;
  }
  return JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
}

/** Clone report and rewrite provenance fields for on-screen JSON and copy (API still returns raw enums). */
export function reportJsonForDisplay(report: Record<string, unknown>): Record<string, unknown> {
  const clone = cloneReport(report);
  const qr = clone["question_results"];
  if (!Array.isArray(qr)) return clone;
  for (const row of qr) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    if (typeof r["question_source"] === "string") {
      r["question_source"] = formatQuestionSource(r["question_source"]);
    }
    if (typeof r["evaluation_source"] === "string") {
      r["evaluation_source"] = formatEvaluationSource(r["evaluation_source"]);
    }
  }
  const runtime = clone["runtime"];
  if (runtime && typeof runtime === "object" && !Array.isArray(runtime)) {
    const rt = runtime as Record<string, unknown>;
    if (rt["selected_mode"] === "llm") rt["selected_mode"] = "LLM";
    if (rt["selected_mode"] === "mock") rt["selected_mode"] = "Mock";
  }
  return clone;
}
