/**
 * Same-origin check for state-changing API requests. Edge-safe: no Node APIs.
 *
 * A mutation is accepted when its Origin names the configured application
 * address (NEXT_PUBLIC_APP_URL or BETTER_AUTH_URL). It is also accepted when
 * the browser reached the server through a loopback address (localhost,
 * 127.0.0.1, ::1) and the Origin matches that same address, so a private local
 * installation keeps working at 127.0.0.1 or on another port. The loopback
 * allowance cannot be reached through DNS rebinding: a rebinding page sends its
 * own hostname as Host, which is never a loopback name.
 */
export type SameOriginInput = {
  origin: string | null;
  host: string | null;
  fetchSite: string | null;
  configuredOrigin?: string | null | undefined;
};

const loopbackHostnames = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostnameOf(host: string) {
  try { return new URL(`http://${host}`).hostname; } catch { return ""; }
}

export function isLoopbackHost(host: string | null): boolean {
  return Boolean(host) && loopbackHostnames.has(hostnameOf(host!));
}

export function isCrossOriginMutation({ origin, host, fetchSite, configuredOrigin }: SameOriginInput): boolean {
  if (fetchSite === "cross-site") return true;
  if (!origin) return false;
  let originHost: string;
  try { originHost = new URL(origin).host; } catch { return true; }
  const allowed = new Set<string>();
  if (configuredOrigin) {
    try { allowed.add(new URL(configuredOrigin).host); } catch { /* an invalid setting allows nothing by itself */ }
  } else if (host) {
    allowed.add(host);
  }
  if (host && isLoopbackHost(host)) allowed.add(host);
  return !allowed.has(originHost);
}

export const crossOriginMessage =
  "Cross-site API requests are not allowed. Open Balsa at the address set in BETTER_AUTH_URL (or NEXT_PUBLIC_APP_URL), or change that setting to the address you use.";
