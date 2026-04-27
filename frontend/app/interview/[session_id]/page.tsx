"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { AnswerInput } from "../../../components/AnswerInput";
import { FeedbackPanel } from "../../../components/FeedbackPanel";
import { LogPanel } from "../../../components/LogPanel";
import { QuestionPanel } from "../../../components/QuestionPanel";
import { StatusBanner } from "../../../components/StatusBanner";
import { submitAnswer } from "../../../lib/api";
import { useSessionStore } from "../../../lib/session-context";
import { connectSessionStream } from "../../../lib/sse";
import { EvaluationPayload, Question, SessionEvent } from "../../../lib/types";

export default function InterviewPage() {
  const params = useParams<{ session_id: string }>();
  const router = useRouter();
  const sessionStore = useSessionStore();
  const lastSeenSeqRef = useRef(0);

  const [question, setQuestion] = useState<Question | null>(sessionStore.currentQuestion);
  const [feedback, setFeedback] = useState<EvaluationPayload | null>(null);
  const [status, setStatus] = useState<"QUESTIONING" | "PROCESSING" | "END">("QUESTIONING");
  const [banner, setBanner] = useState<string | null>(null);
  const [logs, setLogs] = useState<SessionEvent[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
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
          setStatus("QUESTIONING");
          setBanner(null);
        } else if (event.event_type === "interview_completed") {
          setStatus("END");
          router.push(`/report/${params.session_id}`);
        } else if (event.event_type === "error") {
          setBanner(String(event.payload.message ?? "An error occurred."));
        }
      },
      () => setBanner("Reconnecting...")
    );

    return () => source.close();
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
    <main>
      <section
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 10
        }}
      >
        <div
          style={{
            border: "1px solid #2f3f7a",
            borderRadius: 10,
            padding: "8px 12px",
            background: "rgba(10, 20, 52, 0.35)",
            maxWidth: 420
          }}
        >
          <div style={{ opacity: 0.85, fontSize: 13 }}>
            <strong>Name:</strong> {sessionStore.candidateName ?? "Unknown"}
          </div>
          <div style={{ opacity: 0.85, fontSize: 13 }}>
            <strong>Candidate ID:</strong> {sessionStore.candidateId ?? "Unknown"}
          </div>
        </div>
      </section>
      <h1>Live Interview</h1>
      <StatusBanner message={banner} />
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
      <QuestionPanel question={question} />
      <AnswerInput disabled={status !== "QUESTIONING"} onSubmit={onSubmit} />
      <FeedbackPanel feedback={feedback} />
      <LogPanel logs={logs} />
    </main>
  );
}
