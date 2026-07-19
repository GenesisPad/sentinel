export interface RateLimitCheckResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export interface RateLimiter {
  check(key: string, max: number): RateLimitCheckResult;
}

/**
 * Generic sliding-window rate limiter — used for both per-API-key limits (`max` = the key's
 * configured `rateLimitPerMinute`) and the stricter anonymous-request limit, keyed by client IP
 * when no key is presented. In-memory by design (matches the existing Telegram scan limiter):
 * cheap, no extra infra, and resets on restart rather than surviving across deploys.
 */
export function createRateLimiter(windowMs: number, now: () => number = Date.now): RateLimiter {
  const attemptsByKey = new Map<string, number[]>();

  return {
    check(key, max) {
      const currentTime = now();
      const windowStart = currentTime - windowMs;
      const attempts = (attemptsByKey.get(key) ?? []).filter((attemptedAt) => attemptedAt > windowStart);

      if (attempts.length >= max) {
        const oldestAttempt = attempts[0] ?? currentTime;
        return {
          allowed: false,
          retryAfterSeconds: Math.ceil((oldestAttempt + windowMs - currentTime) / 1_000)
        };
      }

      attempts.push(currentTime);
      attemptsByKey.set(key, attempts);
      return { allowed: true };
    }
  };
}
