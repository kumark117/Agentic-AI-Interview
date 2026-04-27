import Link from "next/link";

export function ReportView({
  report,
  loading,
  error
}: {
  report: Record<string, unknown> | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) return <main>Loading report...</main>;
  if (error) return <main>{error}</main>;
  if (!report) return <main>No report found.</main>;

  const runtime = report.runtime as Record<string, unknown> | undefined;

  return (
    <main>
      <h1>Interview Report</h1>
      <Link href="/" className="report-home-link">
        New Session
      </Link>
      {report.is_complete === false ? <p>Partial report — interview ended before completion.</p> : null}
      {runtime ? (
        <section className="card" style={{ marginBottom: 14 }}>
          <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Engine and mode</h2>
          <p style={{ margin: "6px 0", opacity: 0.95 }}>
            <strong>Selected mode:</strong> {String(runtime.selected_mode ?? "—")}
          </p>
          <p style={{ margin: "6px 0", opacity: 0.95 }}>
            <strong>Interviewer:</strong> {String(runtime.interviewer ?? "—")} &nbsp;|&nbsp; <strong>Evaluator:</strong>{" "}
            {String(runtime.evaluator ?? "—")}
          </p>
          <p style={{ margin: "6px 0 0", opacity: 0.85, fontSize: 14 }}>
            Fallback used: {String(runtime.fallback_used ?? "—")} — per-turn sources are in each{" "}
            <code>question_results</code> row (<code>question_source</code>, <code>evaluation_source</code>).
          </p>
        </section>
      ) : (
        <section className="card" style={{ marginBottom: 14, borderColor: "#6b4a1a" }}>
          <p style={{ margin: 0 }}>
            No <code>runtime</code> block in this report — the API is likely an older deploy. Redeploy the backend service, then start a new interview session and open the report again.
          </p>
        </section>
      )}
      <section className="report-section">
        <pre className="report-json">{JSON.stringify(report, null, 2)}</pre>
      </section>
    </main>
  );
}
