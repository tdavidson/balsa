import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

// Keep local development configuration at the monorepo root. Vercel injects
// these values directly and simply ignores the absent local files.
loadEnv({ path: "../../.env.local" });
loadEnv({ path: "../../.env" });

const clerkPublishableKey =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??
  process.env.CLERK_PUBLISHABLE_KEY;

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob: https: https://img.clerk.com; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.clerk.accounts.dev https://challenges.cloudflare.com https://*.protect.clerk.com; connect-src 'self' https://*.clerk.accounts.dev https://api.clerk.com https://*.protect.clerk.com:*; worker-src 'self' blob:; frame-src 'self' https://*.clerk.accounts.dev https://challenges.cloudflare.com https://*.protect.clerk.com" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      ],
    }];
  },
  // pdf.js resolves its worker relative to its own files; bundling it breaks that.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  env: clerkPublishableKey
    ? { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: clerkPublishableKey }
    : undefined,
  transpilePackages: [
    "@finance/auth",
    "@finance/database",
    "@finance/model-providers",
  ],
};

export default nextConfig;
