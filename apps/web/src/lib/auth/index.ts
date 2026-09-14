import "server-only";
import { redirect } from "next/navigation";
import { AuthenticationRequiredError, createAuthService } from "@finance/auth";
import { createDatabaseAuthRepository } from "@finance/database/auth-repository";
import { configuredAuthMode } from "@/lib/better-auth";
import { BetterAuthIdentityProvider } from "./better-auth-provider";
import { DisabledIdentityProvider } from "./disabled-provider";

const authService = createAuthService(
  configuredAuthMode() === "disabled" ? new DisabledIdentityProvider() : new BetterAuthIdentityProvider(),
  createDatabaseAuthRepository(),
);

export const {
  getCurrentUser,
  requireUser,
  getCurrentCompany,
  requireCompanyAccess,
} = authService;

/** Compatibility guard for routes while identity providers share one boundary. */
export const auth = {
  async protect(_options?: { unauthenticatedUrl?: string }) {
    try {
      // Provision on the first authenticated request. Checking only the
      // application-user table here would redirect a newly signed-in Better
      // Auth user before its normal company-provisioning step can run.
      await authService.requireUser();
    } catch (error) {
      if (!(error instanceof AuthenticationRequiredError)) throw error;
      redirect(_options?.unauthenticatedUrl ?? "/login");
    }
  },
};

export async function isAuthenticated() {
  return Boolean(await authService.getCurrentUser());
}

export const authMode = configuredAuthMode();
