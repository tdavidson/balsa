/** A crashed worker leaves its claim behind; only an old claim is safe to retry. */
export const isCalculationJobStale = (updatedAt: Date, now = new Date(), maxAgeMs = 10 * 60_000) => now.getTime() - updatedAt.getTime() >= maxAgeMs;
