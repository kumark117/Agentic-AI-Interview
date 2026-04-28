import { HealthResponse, StartSessionRequest, StartSessionResponse } from "./types";
import { API_BASE } from "./api-base";
import { fetchWithRetry } from "./fetch-retry";

const DEFAULT_RETRY = { maxRetries: 5, initialDelayMs: 700, maxDelayMs: 12_000 };
const LIGHT_RETRY = { maxRetries: 2, initialDelayMs: 450, maxDelayMs: 4_000 };

async function apiFetch(input: string, init?: RequestInit, retry = DEFAULT_RETRY): Promise<Response> {
  return fetchWithRetry(input, { ...init, cache: "no-store" }, retry);
}

export { API_BASE };

export async function startInterview(payload: StartSessionRequest): Promise<StartSessionResponse> {
  const response = await apiFetch(`${API_BASE}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error("Failed to start interview session.");
  }
  return response.json();
}

export async function submitAnswer(
  sessionId: string,
  token: string,
  questionId: string,
  answerText: string
): Promise<{ status: string; message: string }> {
  const response = await apiFetch(`${API_BASE}/sessions/${sessionId}/answers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Session-Token": token
    },
    body: JSON.stringify({
      question_id: questionId,
      answer_text: answerText
    })
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error?.detail?.message ?? "Answer submission failed.");
  }
  return response.json();
}

export async function getReport(sessionId: string, token: string): Promise<Record<string, unknown>> {
  const response = await apiFetch(`${API_BASE}/sessions/${sessionId}/report`, {
    headers: { "X-Session-Token": token }
  });
  if (!response.ok) {
    throw new Error("Failed to fetch report.");
  }
  return response.json();
}

export async function getCorrectAnswersReport(sessionId: string, token: string): Promise<Record<string, unknown>> {
  const response = await apiFetch(`${API_BASE}/sessions/${sessionId}/report/correct-answers`, {
    headers: { "X-Session-Token": token }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.detail;
    const msg =
      typeof detail === "object" && detail !== null && "message" in detail
        ? String((detail as { message: string }).message)
        : typeof detail === "string"
          ? detail
          : "Failed to fetch correct answers report.";
    throw new Error(msg);
  }
  return body as Record<string, unknown>;
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await apiFetch(`${API_BASE}/health`, undefined, LIGHT_RETRY);
  if (!response.ok) {
    throw new Error("Failed to fetch backend health.");
  }
  return response.json();
}
