"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
  const sessionRef = useRef(sessionStore);
  const routerRef = useRef(router);
  sessionRef.current = sessionStore;
  routerRef.current = router;

  const [detail, setDetail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) {
      routerRef.current.replace("/");
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
      routerRef.current.replace("/");
      return;
    }

    interviewBootstrapInFlight = (async () => {
      try {
        setDetail("Calling the API (first question may use the LLM — this can take a bit)…");
        const response = await startInterview(payload);
        sessionStorage.removeItem(PENDING_KEY);
        sessionRef.current.setSession(
          response.session_id,
          response.session_token,
          response.current_question,
          payload.candidate_id,
          payload.candidate_name.trim(),
          payload.max_questions
        );
        routerRef.current.replace(`/interview/${response.session_id}`);
      } catch (e) {
        sessionStorage.removeItem(PENDING_KEY);
        setError((e as Error).message);
        setDetail(null);
      } finally {
        interviewBootstrapInFlight = null;
      }
    })();
    // Intentionally run once on mount: including `sessionStore` would re-run after setSession()
    // and clear storage, then this effect would see no pending payload and send the user home.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap is a one-shot; refs hold latest store/router
  }, []);

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
