import "server-only";
import { Pool } from "pg";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";

export type AuthMode = "better-auth" | "disabled";

const isProduction = process.env.NODE_ENV === "production";

export function configuredAuthMode(): AuthMode {
  const value = process.env.AUTH_MODE ?? "better-auth";
  if (value === "better-auth" || value === "disabled") return value;
  throw new Error("AUTH_MODE must be either 'better-auth' or 'disabled'.");
}

const baseURL = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const secret = process.env.BETTER_AUTH_SECRET;
const configuredOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);

/** Public registration is convenient locally; production must opt in explicitly. */
export function isSignUpEnabled() {
  return process.env.AUTH_ALLOW_SIGN_UP === "true" || !isProduction;
}

if (configuredAuthMode() === "better-auth" && !secret) {
  throw new Error("BETTER_AUTH_SECRET is required when AUTH_MODE=better-auth. Generate one with `openssl rand -base64 32`.");
}
export function assertDisabledAuthAllowed() {
  if (configuredAuthMode() === "disabled" && isProduction && process.env.ALLOW_AUTH_DISABLED !== "true") {
    throw new Error("AUTH_MODE=disabled in production requires ALLOW_AUTH_DISABLED=true. Keep the installation behind a VPN, reverse proxy, or equivalent network access control.");
  }
}

let client: Pool | undefined;
function databaseClient() {
  if (client) return client;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required when AUTH_MODE=better-auth.");
  client = new Pool({
    connectionString: url,
    // Auth has a small, bounded query profile. Keep this pool intentionally
    // modest; each application instance has its own pool.
    max: process.env.NODE_ENV === "production" ? 10 : 1,
  });
  return client;
}

/** The provider database is isolated from Nevermodel's application-user tables. */
export const betterAuthServer = configuredAuthMode() === "better-auth"
  ? betterAuth({
    database: databaseClient(),
    baseURL,
    trustedOrigins: [...new Set([baseURL, ...configuredOrigins])],
    secret: secret!,
    // Nevermodel uses snake_case SQL columns. Keep Better Auth's public API in
    // its native camelCase while mapping its core models to that schema.
    user: { fields: { emailVerified: "email_verified", createdAt: "created_at", updatedAt: "updated_at" } },
    session: { fields: { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at", ipAddress: "ip_address", userAgent: "user_agent", userId: "user_id" } },
    account: { fields: { accountId: "account_id", providerId: "provider_id", userId: "user_id", accessToken: "access_token", refreshToken: "refresh_token", idToken: "id_token", accessTokenExpiresAt: "access_token_expires_at", refreshTokenExpiresAt: "refresh_token_expires_at", createdAt: "created_at", updatedAt: "updated_at" } },
    verification: { fields: { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at" } },
    emailAndPassword: { enabled: true, disableSignUp: !isSignUpEnabled(), minPasswordLength: 12, maxPasswordLength: 128 },
    plugins: [nextCookies()],
  })
  : null;
