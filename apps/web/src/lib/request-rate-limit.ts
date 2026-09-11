type Bucket = { count: number; resetsAt: number };
const buckets = new Map<string, Bucket>();

/** Process-local guardrail. A shared limiter should replace this when horizontally scaled. */
export function takeRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const current = buckets.get(key);
  const bucket = !current || current.resetsAt <= now ? { count: 0, resetsAt: now + windowMs } : current;
  bucket.count += 1;
  buckets.set(key, bucket);
  return { allowed: bucket.count <= limit, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetsAt - now) / 1_000)) };
}
