import "server-only";
import { createAuthService } from "@finance/auth";
import { createDatabaseAuthRepository } from "@finance/database/auth-repository";
import { ClerkIdentityProvider } from "./clerk-provider";

const authService = createAuthService(
  new ClerkIdentityProvider(),
  createDatabaseAuthRepository(),
);

export const {
  getCurrentUser,
  requireUser,
  getCurrentCompany,
  requireCompanyAccess,
} = authService;
