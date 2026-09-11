import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Clerk's request/session plumbing runs here. Authorization is deliberately
// performed in the protected page and route handlers that access company data,
// avoiding path-based redirect races during the sign-up handoff.
export default clerkMiddleware(async (auth, request) => {
  const isApiRequest = request.nextUrl.pathname.startsWith("/api/");
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  if (isApiRequest && isMutation) {
    const origin = request.headers.get("origin");
    const expectedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const fetchSite = request.headers.get("sec-fetch-site");
    let crossOrigin = fetchSite === "cross-site";
    if (origin && expectedHost) {
      try { crossOrigin ||= new URL(origin).host !== expectedHost; } catch { crossOrigin = true; }
    }
    if (crossOrigin) return NextResponse.json({ error: "Cross-site API requests are not allowed" }, { status: 403 });
  }

  // A stale development-browser handoff can be returned as a signed-out
  // redirect indefinitely. Remove it from the app URL so Clerk can establish
  // a fresh session instead of preserving the loop token in redirect_url.
  const { userId } = await auth();
  if (!userId && (request.nextUrl.pathname === "/" || request.nextUrl.pathname === "/login") && request.nextUrl.searchParams.has("__clerk_db_jwt")) {
    const cleanUrl = request.nextUrl.clone();
    cleanUrl.searchParams.delete("__clerk_db_jwt");
    return NextResponse.redirect(cleanUrl);
  }

  if (isApiRequest) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
