import 'server-only';

/**
 * Fixed-window limiter, in memory. Enough for a single server; behind several instances swap
 * the Map for Redis/Upstash (same interface). Limits are generous — they exist to stop scripts,
 * not to slow down a person tapping quickly.
 */
const buckets = new Map<string, { n: number; reset: number }>();

export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    if (buckets.size > 50_000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
    return true;
  }
  b.n++;
  return b.n <= max;
}
