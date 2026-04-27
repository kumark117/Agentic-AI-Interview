import { describe, expect, it, vi, beforeEach } from "vitest";

import { getHealth, startInterview, submitAnswer } from "../lib/api";

describe("frontend api client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("starts interview using sessions endpoint", async () => {
    const mockJson = vi.fn().mockResolvedValue({
      session_id: "sess_123",
      session_token: "tok_123",
      status: "QUESTIONING",
      current_question: {
        question_id: "q_1",
        text: "Explain reconciliation.",
        difficulty: "medium"
      },
      stream_url: "/api/v1/sessions/sess_123/stream?token=tok_123"
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: mockJson });
    vi.stubGlobal("fetch", fetchMock);

    const response = await startInterview({
      candidate_id: "cand_123",
      candidate_name: "Kumar",
      role: "Senior React + AI Engineer",
      experience_level: "senior",
      interview_type: "frontend_ai_fullstack",
      interview_mode: "mock",
      max_questions: 8
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/v1/sessions",
      expect.objectContaining({ method: "POST" })
    );
    expect(response.session_id).toBe("sess_123");
  });

  it("returns backend health payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ status: "ok", service: "ai-agentic-interview", version: "3.0", release_tag: "v3.0-LLM" })
    });
    vi.stubGlobal("fetch", fetchMock);

    const health = await getHealth();

    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8000/api/v1/health");
    expect(health.version).toBe("3.0");
    expect(health.release_tag).toBe("v3.0-LLM");
  });

  it("throws parsed message when answer submit fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({ detail: { message: "Session expired." } })
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitAnswer("sess_1", "tok_1", "q_1", "answer")).rejects.toThrow("Session expired.");
  });
});
