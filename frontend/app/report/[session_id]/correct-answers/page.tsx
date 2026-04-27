"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { CorrectAnswersReportView } from "../../../../components/CorrectAnswersReportView";
import { getCorrectAnswersReport } from "../../../../lib/api";
import { useSessionStore } from "../../../../lib/session-context";

export default function CorrectAnswersReportPage() {
  const params = useParams<{ session_id: string }>();
  const sessionStore = useSessionStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!sessionStore.token || !sessionStore.sessionId || sessionStore.sessionId !== params.session_id) {
      setError("Session token unavailable. Restart from home page.");
      setLoading(false);
      return;
    }

    getCorrectAnswersReport(sessionStore.sessionId, sessionStore.token)
      .then((data) => {
        setPayload(data);
      })
      .catch((e) => {
        setError((e as Error).message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [params.session_id, sessionStore]);

  return (
    <CorrectAnswersReportView
      sessionId={params.session_id}
      payload={payload}
      loading={loading}
      error={error}
    />
  );
}
