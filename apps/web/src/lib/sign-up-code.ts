import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison for the registration passcode. Deliberately free of
 * "server-only" so the comparison itself stays unit-testable; it is only ever
 * called from the Better Auth request hook.
 */
export function matchesSignUpCode(presented: string | null, configured: string | undefined) {
  const expected = configured?.trim() ?? "";
  if (!expected || !presented || Buffer.byteLength(presented) !== Buffer.byteLength(expected)) return false;
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}
