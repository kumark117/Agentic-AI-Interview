"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

export function CorrectAnswersReportView({
  sessionId,
  payload,
  loading,
  error
}: {
  sessionId: string;
  payload: Record<string, unknown> | null;
  loading: boolean;
  error: string | null;
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");

  const copyJson = useCallback(async () => {
    if (!payload) return;
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus("idle"), 2000);
    } catch {
      setCopyStatus("error");
      window.setTimeout(() => setCopyStatus("idle"), 3000);
    }
  }, [payload]);

  if (loading) {
    return (
      <main className="interview-page">
        <h1>Correct Answers Report</h1>
        <p style={{ marginTop: 0, opacity: 0.9 }}>Generating reference answers with the LLM…</p>
        <div className="interview-spinner-wrap" role="status" aria-live="polite" aria-label="Loading">
          <div className="interview-spinner" />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="interview-page">
        <h1>Correct Answers Report</h1>
        <p>{error}</p>
        <Link href={`/report/${sessionId}`} className="report-home-link">
          Back to Interview Report
        </Link>
      </main>
    );
  }

  if (!payload) {
    return (
      <main className="interview-page">
        <h1>Correct Answers Report</h1>
        <p>No data.</p>
        <Link href={`/report/${sessionId}`} className="report-home-link">
          Back to Interview Report
        </Link>
      </main>
    );
  }

  return (
    <main>
      <h1>Correct Answers Report</h1>
      <p style={{ marginTop: 0, maxWidth: "52em", lineHeight: 1.5, opacity: 0.92 }}>
        Reference answers for this session were generated on demand using the configured LLM (evaluator model). Available only for sessions started in{" "}
        <strong>LLM</strong> mode.
      </p>
      <div className="report-toolbar">
        <Link href="/" className="report-home-link">
          New Session
        </Link>
        <Link href={`/report/${sessionId}`} className="report-home-link report-home-link--secondary">
          Back to Interview Report
        </Link>
      </div>
      <section className="report-section">
        <div className="report-json-toolbar">
          <span className="report-json-toolbar__label">Correct answers JSON</span>
          <button type="button" className="report-copy-btn" onClick={() => void copyJson()}>
            Copy to clipboard
          </button>
          {copyStatus === "copied" ? <span className="report-copy-status">Copied.</span> : null}
          {copyStatus === "error" ? (
            <span className="report-copy-status report-copy-status--error">Copy failed — try again or select the JSON manually.</span>
          ) : null}
        </div>
        <pre className="report-json">{JSON.stringify(payload, null, 2)}</pre>
      </section>
    </main>
  );
}
