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
