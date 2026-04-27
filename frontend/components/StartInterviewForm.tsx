"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { getHealth, startInterview } from "../lib/api";
import { useSessionStore } from "../lib/session-context";
import { StartSessionRequest } from "../lib/types";

export function StartInterviewForm() {
  const productVersion = "3.0";
  const frontendVersion = "3.0";
  const releaseTag = "v3.0-LLM";
  const router = useRouter();
  const sessionStore = useSessionStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [backendVersion, setBackendVersion] = useState<string | null>(null);
  const [backendReleaseTag, setBackendReleaseTag] = useState<string | null>(null);
  const [backendService, setBackendService] = useState<string | null>(null);
  const [aboutLoading, setAboutLoading] = useState(false);
  const [aboutError, setAboutError] = useState<string | null>(null);
  const [maxQuestionsInput, setMaxQuestionsInput] = useState("8");
  const parsedMaxQuestions = Number(maxQuestionsInput);
  const maxQuestionsValid =
    maxQuestionsInput.trim() !== "" &&
    Number.isInteger(parsedMaxQuestions) &&
    parsedMaxQuestions >= 1 &&
    parsedMaxQuestions <= 20;

  const [form, setForm] = useState<StartSessionRequest>({
    candidate_id: "cand_123",
    candidate_name: "Kumar",
    role: "Senior React + AI Engineer",
    experience_level: "senior",
    interview_type: "frontend_ai_fullstack",
    interview_mode: "llm",
    max_questions: 8
  });
  const normalizedCandidateName = form.candidate_name.trim();
  const candidateNameAllowedPattern = /^[A-Za-z .'-]+$/;
  const candidateNameCharsetValid =
    normalizedCandidateName.length === 0 || candidateNameAllowedPattern.test(normalizedCandidateName);
  const candidateNameValid =
    normalizedCandidateName.length >= 2 &&
    normalizedCandidateName.length <= 80 &&
    candidateNameCharsetValid;

  useEffect(() => {
    if (!showAbout) return;

    setAboutError(null);
    setAboutLoading(true);
    getHealth()
      .then((health) => {
        setBackendVersion(health.version);
        setBackendReleaseTag(health.release_tag);
        setBackendService(health.service);
      })
      .catch(() => {
        setAboutError("Unable to fetch backend version.");
      })
      .finally(() => setAboutLoading(false));
  }, [showAbout]);

  useEffect(() => {
    if (!showAbout) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowAbout(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showAbout]);

  async function onStart() {
    setError(null);
    if (!candidateNameCharsetValid) {
      setError("Candidate Name can contain letters, spaces, apostrophe ('), hyphen (-), and dot (.) only.");
      return;
    }
    if (!candidateNameValid) {
      setError("Candidate Name must be 2 to 80 characters.");
      return;
    }
    if (!Number.isInteger(parsedMaxQuestions) || parsedMaxQuestions < 1 || parsedMaxQuestions > 20) {
      setError("Max Questions must be an integer between 1 and 20.");
      return;
    }

    setLoading(true);
    try {
      const response = await startInterview({
        ...form,
        candidate_name: normalizedCandidateName,
        max_questions: parsedMaxQuestions
      });
      sessionStore.setSession(response.session_id, response.session_token, response.current_question, form.candidate_id, normalizedCandidateName, parsedMaxQuestions);
      router.push(`/interview/${response.session_id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const nameInputClass =
    "start-input" + (!candidateNameValid && normalizedCandidateName.length > 0 ? " start-input--error" : "");
  const maxQInputClass = "start-input" + (!maxQuestionsValid ? " start-input--error" : "");

  return (
    <main className="start-page">
      <header className="start-hero">
        <div className="start-hero__row">
          <div className="start-hero__lead">
            <p className="start-hero__eyebrow">Agentic AI Interview</p>
            <h1 className="start-hero__title">Start your session</h1>
            <p className="start-hero__subtitle">
              Choose Mock or AI LLM, set your name and # of questions, then open the live interview with SSE updates.
            </p>
          </div>
          <div className="start-hero__actions">
            <button className="start-toolbar__about" type="button" onClick={() => setShowAbout(true)}>
              About
            </button>
            <div className="start-engine" role="group" aria-label="Interview engine">
              <span className="start-engine__label">Engine</span>
              <div className="start-engine__toggle">
                <button
                  type="button"
                  className={`start-engine__option${form.interview_mode === "mock" ? " start-engine__option--active" : ""}`}
                  aria-pressed={form.interview_mode === "mock"}
                  onClick={() => setForm((prev) => ({ ...prev, interview_mode: "mock" }))}
                >
                  Mock
                </button>
                <button
                  type="button"
                  className={`start-engine__option${form.interview_mode === "llm" ? " start-engine__option--active" : ""}`}
                  aria-pressed={form.interview_mode === "llm"}
                  onClick={() => setForm((prev) => ({ ...prev, interview_mode: "llm" }))}
                >
                  AI LLM
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="start-form-card" aria-labelledby="start-form-heading">
        <h2 id="start-form-heading" className="start-form-card__title">
          Session setup
        </h2>

        <div className="start-form-grid">
          <div className="start-field start-field--span-2">
            <span className="start-field__label">Candidate ID</span>
            <div className="start-field__row">
              <span className="start-badge">{form.candidate_id}</span>
            </div>
            <p className="start-field__hint">Demo-assigned.</p>
          </div>

          <div className="start-field start-field--span-2">
            <label className="start-field__label" htmlFor="candidate_name">
              Candidate name
            </label>
            <input
              id="candidate_name"
              className={nameInputClass}
              value={form.candidate_name}
              maxLength={80}
              autoComplete="name"
              onChange={(e) => setForm((prev) => ({ ...prev, candidate_name: e.target.value }))}
            />
            {!candidateNameCharsetValid ? (
              <p className="start-field__error">Use letters, spaces, apostrophe (&apos;), hyphen (-), and dot (.) only.</p>
            ) : null}
            {candidateNameCharsetValid && !candidateNameValid ? (
              <p className="start-field__error">Name must be between 2 and 80 characters.</p>
            ) : null}
          </div>

          <div className="start-field">
            <label className="start-field__label" htmlFor="role">
              Role (template)
            </label>
            <input id="role" className="start-input start-input--readonly" value={form.role} readOnly tabIndex={-1} />
            <p className="start-field__hint">Locked for this track.</p>
          </div>

          <div className="start-field">
            <label className="start-field__label" htmlFor="max_questions">
              Max questions
            </label>
            <input
              id="max_questions"
              className={maxQInputClass}
              type="number"
              min={1}
              max={20}
              value={maxQuestionsInput}
              onChange={(e) => setMaxQuestionsInput(e.target.value)}
              onBlur={() => {
                if (maxQuestionsInput.trim() === "") {
                  setMaxQuestionsInput("8");
                  return;
                }
                const value = Number(maxQuestionsInput);
                if (!Number.isFinite(value)) {
                  setMaxQuestionsInput("8");
                  return;
                }
                const clamped = Math.min(20, Math.max(1, Math.trunc(value)));
                setMaxQuestionsInput(String(clamped));
              }}
            />
            {!maxQuestionsValid ? <p className="start-field__error">Enter a whole number from 1 to 20.</p> : null}
            <p className="start-field__hint">1–20; set before start.</p>
          </div>
        </div>

        <div className="start-cta-wrap">
          <button className="start-cta" type="button" onClick={onStart} disabled={loading}>
            {loading ? "Starting session…" : "Start interview"}
          </button>
          {error ? <div className="start-alert start-alert--error">{error}</div> : null}
        </div>
      </section>

      {showAbout ? (
        <div className="about-modal-backdrop" role="presentation" onClick={() => setShowAbout(false)}>
          <section className="about-modal-card" role="dialog" aria-modal="true" aria-label="About this product" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>About This Product</h2>
            <p>
              AI Agentic Interview is a fullstack interview simulator with a Next.js frontend and a FastAPI backend.
              It runs adaptive question flow, answer evaluation, and live event streaming for realistic interview
              sessions.
            </p>
            <p style={{ marginBottom: 6 }}>
              <strong>Tech:</strong> Next.js, React, TypeScript, FastAPI, PostgreSQL, Redis, SSE
            </p>
            <p style={{ marginTop: 0 }}>
              <strong>UI Version:</strong> {frontendVersion}
            </p>
            <p style={{ marginTop: 0, marginBottom: 6 }}>
              <strong>Backend Version:</strong> {aboutLoading ? "Checking..." : backendVersion ?? "Unavailable"}
            </p>
            {backendService ? (
              <p style={{ marginTop: 0 }}>
                <strong>Backend Service:</strong> {backendService}
              </p>
            ) : null}
            <p style={{ marginTop: 0 }}>
              <strong>Product Version:</strong> {productVersion}
            </p>
            <p style={{ marginTop: 0 }}>
              <strong>Release tag (UI):</strong> {releaseTag}
            </p>
            <p style={{ marginTop: 0 }}>
              <strong>Release tag (API):</strong> {aboutLoading ? "Checking..." : backendReleaseTag ?? "—"}
            </p>
            {aboutError ? <p style={{ color: "#ff8a8a", marginTop: 0 }}>{aboutError}</p> : null}
            <button type="button" onClick={() => setShowAbout(false)}>
              Close
            </button>
          </section>
        </div>
      ) : null}
    </main>
  );
}
