import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import type { AuthIdentity, IdentityProvider } from "@finance/auth";

export class ClerkIdentityProvider implements IdentityProvider {
  async getIdentity(): Promise<AuthIdentity | null> {
    const session = await auth();
    if (!session.userId) return null;

    const user = await currentUser();
    if (!user) return null;

    const email =
      user.primaryEmailAddress?.emailAddress ??
      user.emailAddresses[0]?.emailAddress;
    if (!email) throw new Error("The Clerk user does not have an email address");

    const displayName = [user.firstName, user.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();

    return {
      provider: "clerk",
      providerUserId: user.id,
      email,
      name: displayName || user.username || null,
    };
  }
}
