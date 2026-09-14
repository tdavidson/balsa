import "server-only";
import { redirect } from "next/navigation";
import { AuthenticationRequiredError, createAuthService, requireCompanyRole } from "@finance/auth";
import { createDatabaseAuthRepository } from "@finance/database/auth-repository";
import { createDatabaseMemberRepository } from "@finance/database/member-repository";
import { configuredAuthMode } from "@/lib/better-auth";
import { BetterAuthIdentityProvider } from "./better-auth-provider";
import { readActiveCompanyId } from "./company-selection";
import { DisabledIdentityProvider } from "./disabled-provider";

const authService = createAuthService(
  configuredAuthMode() === "disabled" ? new DisabledIdentityProvider() : new BetterAuthIdentityProvider(),
  createDatabaseAuthRepository(),
  // The stored company preference is read here, but membership is always
  // re-verified by the service before the company is used.
  { selection: { read: readActiveCompanyId } },
);

export const {
  getCurrentUser,
  requireUser,
  getCurrentCompany,
  requireCompanyAccess,
  listCompanies,
  createCompany,
} = authService;

/**
 * The company context for an owner-only action. Routes map
 * `CompanyRoleRequiredError` to 403; every other failure keeps its meaning.
 */
export async function requireOwner(requestedCompanyId?: string) {
  const context = await authService.requireCompanyAccess(requestedCompanyId);
  requireCompanyRole(context, "owner");
  return context;
}

/** Member management shares the request's database connection like the auth repository. */
export const memberRepository = createDatabaseMemberRepository();

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
