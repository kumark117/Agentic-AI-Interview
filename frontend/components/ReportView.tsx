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

  return (
    <main>
      <h1>Interview Report</h1>
      <Link href="/" className="report-home-link">
        New Session
      </Link>
      {report.is_complete === false ? <p>Partial report — interview ended before completion.</p> : null}
      <section className="report-section">
        <pre className="report-json">{JSON.stringify(report, null, 2)}</pre>
      </section>
    </main>
  );
}
