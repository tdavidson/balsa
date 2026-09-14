import "server-only";
import type { AuthIdentity, IdentityProvider } from "@finance/auth";
import { assertDisabledAuthAllowed } from "@/lib/better-auth";

/** Explicit single-user mode. It is never an implicit fallback for broken auth. */
export class DisabledIdentityProvider implements IdentityProvider {
  async getIdentity(): Promise<AuthIdentity> {
    assertDisabledAuthAllowed();
    const email = process.env.LOCAL_OWNER_EMAIL?.trim() || "owner@localhost";
    const name = process.env.LOCAL_OWNER_NAME?.trim() || "User";
    return { provider: "disabled", providerUserId: process.env.LOCAL_OWNER_ID?.trim() || "local-owner", email, name };
  }
}
