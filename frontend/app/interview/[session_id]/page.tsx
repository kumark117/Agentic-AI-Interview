"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { AnswerInput } from "../../../components/AnswerInput";
import { FeedbackPanel } from "../../../components/FeedbackPanel";
import { LogPanel } from "../../../components/LogPanel";
import { QuestionPanel } from "../../../components/QuestionPanel";
import { StatusBanner } from "../../../components/StatusBanner";
import { startInterview, submitAnswer } from "../../../lib/api";
import { useSessionStore } from "../../../lib/session-context";
import { connectSessionStream } from "../../../lib/sse";
import type { StartSessionRequest } from "../../../lib/types";
import { EvaluationPayload, Question, SessionEvent } from "../../../lib/types";

const PENDING_SESSION_START_KEY = "ai_interview_pending_session_start";
/** Reserved URL segment — not a real backend session id. */
const BOOTSTRAP_ROUTE = "_bootstrap";
const REPORT_REDIRECT_MS = 1500;

let interviewBootstrapInFlight: Promise<void> | null = null;

export default function InterviewPage() {
  const params = useParams<{ session_id: string }>();
  const router = useRouter();
  const sessionStore = useSessionStore();
  const sessionRef = useRef(sessionStore);
  const routerRef = useRef(router);
  sessionRef.current = sessionStore;
  routerRef.current = router;

  const lastSeenSeqRef = useRef(0);
  const reportNavTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [question, setQuestion] = useState<Question | null>(sessionStore.currentQuestion);
  const [feedback, setFeedback] = useState<EvaluationPayload | null>(null);
  const [status, setStatus] = useState<"QUESTIONING" | "PROCESSING" | "END">("QUESTIONING");
  const [banner, setBanner] = useState<string | null>(null);
  const [logs, setLogs] = useState<SessionEvent[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  const isBootstrapRoute = params.session_id === BOOTSTRAP_ROUTE;

  const pendingBootstrapMode = useMemo<"llm" | "mock" | null>(() => {
    if (typeof window === "undefined" || !isBootstrapRoute) return null;
    const raw = sessionStorage.getItem(PENDING_SESSION_START_KEY);
    if (!raw) return null;
    try {
      const p = JSON.parse(raw) as { interview_mode?: string };
      if (p.interview_mode === "llm") return "llm";
      if (p.interview_mode === "mock") return "mock";
      return null;
    } catch {
      return null;
    }
  }, [isBootstrapRoute]);

  const llmEndReportHint = (
    <>
      At the end of the interview, open the Interview Report — you can run <strong>Correct Answers Report</strong> there for
      LLM-written reference solutions.
    </>
  );

  const mockBootstrapReportHint = (
    <>
      <strong>Correct Answers Report</strong> is only available for sessions started in <strong>AI LLM</strong> mode (from the
      Interview Report after you finish). Mock interviews use the standard report only.
    </>
  );

  const showFixedLlmReportHint = sessionStore.interviewMode === "llm" && !isBootstrapRoute;

  useEffect(() => {
    if (params.session_id !== BOOTSTRAP_ROUTE) {
      return;
    }

    const raw = sessionStorage.getItem(PENDING_SESSION_START_KEY);
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
      sessionStorage.removeItem(PENDING_SESSION_START_KEY);
      routerRef.current.replace("/");
      return;
    }

    setBootstrapError(null);

    interviewBootstrapInFlight = (async () => {
      try {
        const response = await startInterview(payload);
        sessionStorage.removeItem(PENDING_SESSION_START_KEY);
        sessionRef.current.setSession(
          response.session_id,
          response.session_token,
          response.current_question,
          payload.candidate_id,
          payload.candidate_name.trim(),
          payload.max_questions,
          payload.interview_mode
        );
        setQuestion(response.current_question);
        routerRef.current.replace(`/interview/${response.session_id}`);
      } catch (e) {
        sessionStorage.removeItem(PENDING_SESSION_START_KEY);
        setBootstrapError((e as Error).message);
      } finally {
        interviewBootstrapInFlight = null;
      }
    })();
    // One-shot when URL is /interview/_bootstrap; refs carry latest store/router (see setSession note above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.session_id]);

  useEffect(() => {
    if (params.session_id === BOOTSTRAP_ROUTE) {
      return;
    }
    if (!sessionStore.token || !sessionStore.sessionId || sessionStore.sessionId !== params.session_id) {
      setBanner("Session token missing. Please restart from home page.");
      return;
    }

    const source = connectSessionStream(
      sessionStore.sessionId,
      sessionStore.token,
      (event) => {
        if (event.event_seq <= lastSeenSeqRef.current) return;
        lastSeenSeqRef.current = event.event_seq;
        setLogs((prev) => [...prev, event]);

        if (event.event_type === "thinking") {
          setStatus("PROCESSING");
          setBanner("Thinking...");
        } else if (event.event_type === "queue_delay") {
          setBanner(String(event.payload.message ?? "High load (~5-7s delay)"));
        } else if (event.event_type === "evaluation_completed") {
          setFeedback(event.payload as EvaluationPayload);
        } else if (event.event_type === "question_generated") {
          const nextQuestion = event.payload as Question;
          setQuestion(nextQuestion);
          sessionStore.setCurrentQuestion(nextQuestion);
          sessionStore.incrementQuestionsAsked();
          setStatus("QUESTIONING");
          setBanner(null);
        } else if (event.event_type === "interview_completed") {
          setStatus("END");
          setBanner(null);
          if (reportNavTimeoutRef.current != null) {
            clearTimeout(reportNavTimeoutRef.current);
          }
          reportNavTimeoutRef.current = setTimeout(() => {
            reportNavTimeoutRef.current = null;
            router.push(`/report/${params.session_id}`);
          }, REPORT_REDIRECT_MS);
        } else if (event.event_type === "error") {
          setBanner(String(event.payload.message ?? "An error occurred."));
        }
      },
      () => setBanner("Reconnecting...")
    );

    return () => {
      source.close();
      if (reportNavTimeoutRef.current != null) {
        clearTimeout(reportNavTimeoutRef.current);
        reportNavTimeoutRef.current = null;
      }
    };
  }, [params.session_id, router, sessionStore]);

  async function onSubmit(answerText: string) {
    if (!question || !sessionStore.token || !sessionStore.sessionId) return;
    setSubmitError(null);
    setStatus("PROCESSING");
    try {
      await submitAnswer(sessionStore.sessionId, sessionStore.token, question.question_id, answerText);
    } catch (e) {
      const message = (e as Error).message;
      if (message.includes("already been submitted")) {
        setSubmitError("Answer already submitted. Waiting for streamed updates.");
      } else if (message.includes("already being processed")) {
        setSubmitError("Another turn is already being processed. Please wait.");
      } else {
        setSubmitError(message);
      }
    }
  }

  const sessionClosed = [banner, submitError].some((message) =>
    String(message ?? "")
      .toLowerCase()
      .includes("not accepting answers")
  );
  const sessionRestartSuggested = [banner, submitError].some((message) => {
    const normalized = String(message ?? "").toLowerCase();
    return normalized.includes("not accepting answers") || normalized.includes("session token missing");
  });

  return (
    <main className="interview-page">
      <h1>Live Interview</h1>
      {!isBootstrapRoute ? (
        <div className="interview-primary-status-slot">
          <StatusBanner message={banner} />
        </div>
      ) : (
        <StatusBanner message={banner} />
      )}
      {bootstrapError ? <StatusBanner message={bootstrapError} /> : null}
      {submitError ? <StatusBanner message={submitError} /> : null}
      {sessionRestartSuggested ? (
        <section>
          <p style={{ marginTop: 0 }}>
            This session cannot continue from this page. Start a new session, or open report if it is already completed.
          </p>
          {sessionClosed ? (
            <button type="button" style={{ width: "auto", marginRight: 10 }} onClick={() => router.push(`/report/${params.session_id}`)}>
              View Report
            </button>
          ) : null}
          <button type="button" style={{ width: "auto" }} onClick={() => router.push("/")}>
            New Session
          </button>
        </section>
      ) : null}
      <div className={`interview-layout${status === "END" ? " interview-layout--winding-down" : ""}`}>
        <div className="interview-layout__column interview-layout__column--primary">
          {isBootstrapRoute ? (
            <section className="question-panel">
              <h2 className="question-panel__title">Question</h2>
              <div className="interview-spinner-wrap" role="status" aria-live="polite" aria-label="Creating session">
                <div className="interview-spinner" />
                <p className="interview-spinner__caption">Creating your session…</p>
              </div>
              {pendingBootstrapMode === "llm" ? (
                <p className="interview-hint interview-hint--below-spinner">{llmEndReportHint}</p>
              ) : pendingBootstrapMode === "mock" ? (
                <p className="interview-hint interview-hint--below-spinner">{mockBootstrapReportHint}</p>
              ) : null}
            </section>
          ) : (
            <>
              <QuestionPanel
                question={question}
                currentQuestionNumber={sessionStore.questionsAsked}
                maxQuestions={sessionStore.maxQuestions}
              />
              {showFixedLlmReportHint ? (
                <aside className="interview-llm-report-hint-box" aria-label="Correct Answers Report reminder">
                  <p className="interview-hint interview-hint--fixed-llm">{llmEndReportHint}</p>
                </aside>
              ) : null}
            </>
          )}
          <AnswerInput
            disabled={isBootstrapRoute || status !== "QUESTIONING"}
            questionKey={question?.question_id ?? null}
            onSubmit={onSubmit}
          />
        </div>
        <aside className="interview-layout__column interview-layout__column--log" aria-label="Log and feedback">
          <LogPanel logs={logs} />
          <FeedbackPanel feedback={feedback} />
        </aside>
      </div>
    </main>
  );
}
