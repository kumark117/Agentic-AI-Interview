"use client";

import { useEffect, useRef } from "react";
import { formatEvaluationSource } from "../lib/formatDisplay";
import { SessionEvent } from "../lib/types";

function summarize(event: SessionEvent): string {
  if (event.event_type === "thinking") return "Thinking...";
  if (event.event_type === "evaluation_started") return String(event.payload.question_id ?? "");
  if (event.event_type === "evaluation_completed") {
    const src = formatEvaluationSource(String(event.payload.source ?? ""));
    return `score: ${String(event.payload.score ?? "")}, confidence: ${String(event.payload.confidence ?? "")}, source: ${src}`;
  }
  if (event.event_type === "question_generated") return String(event.payload.question_id ?? "");
  if (event.event_type === "queue_delay") return String(event.payload.message ?? "Queue delay");
  if (event.event_type === "engine_notice") {
    const msg = String(event.payload.message ?? "");
    const detail = event.payload.detail ? ` — ${String(event.payload.detail)}` : "";
    return msg + detail;
  }
  if (event.event_type === "interview_completed") return String(event.payload.end_reason ?? "complete");
  if (event.event_type === "error") return String(event.payload.message ?? "Error");
  return "";
}

export function LogPanel({ logs }: { logs: SessionEvent[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <section className="log-panel">
      <h3>Log Panel</h3>
      {logs.length === 0 ? (
        <p>No events yet.</p>
      ) : (
        <div ref={scrollRef} className="log-panel__scroll">
          <ul className="log-panel__list">
            {logs.map((event) => (
              <li key={event.event_id}>
                [{event.event_seq}] {event.event_type} — {summarize(event)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
