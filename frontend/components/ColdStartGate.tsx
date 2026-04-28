"use client";

import { useEffect, useState } from "react";

import { getHealth } from "../lib/api";

const WARMUP_BUDGET_MS = 120_000;

/**
 * Blocks the app until GET /health succeeds, so Render free-tier cold starts show a clear message
 * instead of a blank or half-loaded UI.
 */
export function ColdStartGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<"warming" | "error">("warming");
  const [attemptWave, setAttemptWave] = useState(0);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (ready) {
      return;
    }

    let cancelled = false;

    async function warmUp(): Promise<void> {
      const started = Date.now();
      let wave = 0;

      while (Date.now() - started < WARMUP_BUDGET_MS && !cancelled) {
        wave += 1;
        setAttemptWave(wave);
        try {
          await getHealth();
          if (!cancelled) {
            setReady(true);
          }
          return;
        } catch {
          const waitMs = Math.min(900 * 1.35 ** Math.min(wave, 18), 8_000);
          await new Promise((r) => setTimeout(r, waitMs));
        }
      }

      if (!cancelled) {
        setPhase("error");
      }
    }

    setPhase("warming");
    void warmUp();

    return () => {
      cancelled = true;
    };
  }, [ready, retryKey]);

  if (ready) {
    return <>{children}</>;
  }

  if (phase === "error") {
    return (
      <div className="cold-start cold-start--error" role="alert">
        <p className="cold-start__title">Services are taking longer than expected</p>
        <p className="cold-start__hint">
          The API may still be waking on free hosting. Check your network, wait a bit, then try again.
        </p>
        <button
          type="button"
          className="cold-start__retry"
          onClick={() => {
            setReady(false);
            setPhase("warming");
            setAttemptWave(0);
            setRetryKey((k) => k + 1);
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="cold-start" role="status" aria-live="polite">
      <p className="cold-start__title">Waking up services…</p>
      <p className="cold-start__hint">
        Hosted backends sometimes sleep after idle; first load can take 30–60 seconds. Retrying automatically.
      </p>
      {attemptWave > 1 ? (
        <p className="cold-start__meta">Connection attempt {attemptWave}</p>
      ) : null}
    </div>
  );
}
