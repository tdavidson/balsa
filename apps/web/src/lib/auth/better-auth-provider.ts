import "server-only";
import { headers } from "next/headers";
import type { AuthIdentity, IdentityProvider } from "@finance/auth";
import { betterAuthServer } from "@/lib/better-auth";

export class BetterAuthIdentityProvider implements IdentityProvider {
  async getIdentity(): Promise<AuthIdentity | null> {
    if (!betterAuthServer) return null;
    const session = await betterAuthServer.api.getSession({ headers: await headers() });
    if (!session?.user) return null;
    return { provider: "better-auth", providerUserId: session.user.id, email: session.user.email, name: session.user.name || null };
  }
}
