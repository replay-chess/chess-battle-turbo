interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimiterOptions {
  /** Maximum requests allowed in the window */
  limit: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

export function createRateLimiter({ limit, windowMs }: RateLimiterOptions) {
  const map = new Map<string, RateLimitEntry>();

  // Periodic cleanup to prevent memory leaks
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of map) {
      if (now > entry.resetAt) map.delete(key);
    }
  }, 5 * 60 * 1000);
  cleanup.unref();

  return {
    /** Returns true if the key has exceeded the rate limit */
    isLimited(key: string): boolean {
      const now = Date.now();
      const entry = map.get(key);
      if (!entry || now > entry.resetAt) {
        map.set(key, { count: 1, resetAt: now + windowMs });
        return false;
      }
      entry.count++;
      return entry.count > limit;
    },
  };
}
