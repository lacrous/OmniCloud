import { RateLimitedError } from "@omnicloud/core";

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
}

/**
 * Minimal fixed-window, in-memory rate limiter for protecting the
 * authentication endpoints. Sufficient for a single-process v0.1 server.
 */
export function createRateLimiter({ windowMs, max }: RateLimiterOptions) {
  const hits = new Map<string, number[]>();

  return function check(key: string): void {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      throw new RateLimitedError(
        `Too many attempts — try again in ${Math.ceil(windowMs / 1000)} seconds`,
      );
    }
    recent.push(now);
    hits.set(key, recent);

    // Periodic compaction so the map cannot grow without bound.
    if (hits.size > 10_000) {
      for (const [k, times] of hits) {
        if (times.every((t) => now - t >= windowMs)) hits.delete(k);
      }
    }
  };
}
