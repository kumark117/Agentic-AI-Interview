import { describe, expect, it, vi, beforeEach } from "vitest";

import { computeBackoffMs, fetchWithRetry } from "../lib/fetch-retry";

describe("fetch-retry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("computeBackoffMs stays within bounds", () => {
    expect(computeBackoffMs(0, 500, 10_000)).toBeGreaterThanOrEqual(400);
    expect(computeBackoffMs(0, 500, 10_000)).toBeLessThanOrEqual(10_000);
    expect(computeBackoffMs(99, 500, 10_000)).toBeLessThanOrEqual(10_000);
  });

  it("retries on 503 then returns ok response", async () => {
    vi.useRealTimers();
    const bad = { ok: false, status: 503 };
    const good = { ok: true, status: 200, json: async () => ({}) };
    const fetchMock = vi.fn().mockResolvedValueOnce(bad).mockResolvedValueOnce(good);
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchWithRetry("http://example.test/health", {}, { maxRetries: 3, initialDelayMs: 1, maxDelayMs: 5 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(true);
  });

  it("throws after retries on persistent network error", async () => {
    vi.useRealTimers();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchWithRetry("http://example.test/health", {}, { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 5 })
    ).rejects.toThrow(TypeError);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
