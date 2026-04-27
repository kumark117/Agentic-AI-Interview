"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { startInterview } from "../../../lib/api";
import { useSessionStore } from "../../../lib/session-context";
import type { StartSessionRequest } from "../../../lib/types";

const PENDING_KEY = "ai_interview_pending_session_start";

/** Avoid duplicate POST /sessions when React Strict Mode runs the effect twice in dev. */
let interviewBootstrapInFlight: Promise<void> | null = null;

export default function InterviewBootstrapPage() {
  const router = useRouter();
  const sessionStore = useSessionStore();
  const [detail, setDetail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) {
      router.replace("/");
      return;
    }
    if (interviewBootstrapInFlight) {
      return;
    }

    let payload: StartSessionRequest;
    try {
      payload = JSON.parse(raw) as StartSessionRequest;
    } catch {
      sessionStorage.removeItem(PENDING_KEY);
      router.replace("/");
      return;
    }

    interviewBootstrapInFlight = (async () => {
      try {
        setDetail("Calling the API (first question may use the LLM — this can take a bit)…");
        const response = await startInterview(payload);
        sessionStorage.removeItem(PENDING_KEY);
        sessionStore.setSession(
          response.session_id,
          response.session_token,
          response.current_question,
          payload.candidate_id,
          payload.candidate_name.trim(),
          payload.max_questions
        );
        router.replace(`/interview/${response.session_id}`);
      } catch (e) {
        sessionStorage.removeItem(PENDING_KEY);
        setError((e as Error).message);
        setDetail(null);
      } finally {
        interviewBootstrapInFlight = null;
      }
    })();
  }, [router, sessionStore]);

  return (
    <main className="interview-bootstrap">
      <h1>Starting interview</h1>
      <p className="interview-bootstrap__lead">You are on the interview screen while we finish creating your session.</p>
      {detail ? <p className="interview-bootstrap__detail">{detail}</p> : null}
      {error ? (
        <section className="card" style={{ marginTop: 16 }}>
          <p style={{ marginTop: 0 }}>{error}</p>
          <Link href="/" className="report-home-link" style={{ marginTop: 12 }}>
            Back to start
          </Link>
        </section>
      ) : null}
    </main>
  );
}
