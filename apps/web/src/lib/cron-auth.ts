import "server-only";
import { timingSafeEqual } from "node:crypto";

/** Constant-time comparison for machine-to-machine recovery endpoints. */
export function hasScheduledJobAuthorization(value: string | null, secret: string | undefined) {
  const expected = secret ? `Bearer ${secret}` : "";
  if (!secret || !value || Buffer.byteLength(value) !== Buffer.byteLength(expected)) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}
