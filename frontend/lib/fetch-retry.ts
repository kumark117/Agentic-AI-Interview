export type FetchRetryOptions = {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with light jitter (avoids thundering herd). */
export function computeBackoffMs(attempt: number, initialDelayMs: number, maxDelayMs: number): number {
  const cappedAttempt = Math.min(Math.max(attempt, 0), 20);
  const exp = Math.min(initialDelayMs * 2 ** cappedAttempt, maxDelayMs);
  const jitter = exp * 0.12 * (Math.random() * 2 - 1);
  return Math.round(Math.min(maxDelayMs, Math.max(initialDelayMs, exp + jitter)));
}

function isRetriableHttpStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

/**
 * fetch() with retries for cold starts and transient errors (502/503/504, network drops).
 * Does not retry most 4xx (caller gets the last response).
 */
export async function fetchWithRetry(
  input: string,
  init: RequestInit | undefined,
  options: FetchRetryOptions | undefined
): Promise<Response> {
  const maxRetries = options?.maxRetries ?? 5;
  const initialDelayMs = options?.initialDelayMs ?? 700;
  const maxDelayMs = options?.maxDelayMs ?? 12_000;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(input, init);
      if (response.ok) {
        return response;
      }
      if (isRetriableHttpStatus(response.status) && attempt < maxRetries) {
        await sleep(computeBackoffMs(attempt, initialDelayMs, maxDelayMs));
        continue;
      }
      return response;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await sleep(computeBackoffMs(attempt, initialDelayMs, maxDelayMs));
        continue;
      }
      throw err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
