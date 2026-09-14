import { NextRequest, NextResponse } from "next/server";

// Authorization is deliberately performed in protected page and route handlers
// through the app-owned auth boundary. This edge-safe guard still rejects
// cross-site state changes before they reach a route handler.
export default function proxy(request: NextRequest) {
  const isApiRequest = request.nextUrl.pathname.startsWith("/api/");
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  if (isApiRequest && isMutation) {
    const origin = request.headers.get("origin");
    const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL;
    const expectedHost = configuredOrigin ? new URL(configuredOrigin).host : request.headers.get("host");
    const fetchSite = request.headers.get("sec-fetch-site");
    let crossOrigin = fetchSite === "cross-site";
    if (origin && expectedHost) {
      try { crossOrigin ||= new URL(origin).host !== expectedHost; } catch { crossOrigin = true; }
    }
    if (crossOrigin) return NextResponse.json({ error: "Cross-site API requests are not allowed" }, { status: 403 });
  }

  if (isApiRequest) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (process.env.NODE_ENV === "production") response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    return response;
  }
  const response = NextResponse.next();
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return response;
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
