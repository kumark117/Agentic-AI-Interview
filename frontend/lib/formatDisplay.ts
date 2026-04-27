/** Human-readable labels for API enum values shown in the UI. */

export function formatEvaluationSource(source: string): string {
  if (source === "llm") return "LLM";
  if (source === "fallback_timeout") return "Fallback (timeout)";
  return source;
}
