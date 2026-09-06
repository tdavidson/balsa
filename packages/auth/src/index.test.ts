import { describe, expect, it, vi } from "vitest";
import {
  CompanyAccessDeniedError,
  createAuthService,
  type AuthIdentity,
  type AuthRepository,
} from "./index";

const identity: AuthIdentity = {
  provider: "clerk",
  providerUserId: "user_123",
  email: "cfo@example.com",
  name: "CFO",
};

const context = {
  user: { id: "app-user", email: identity.email, name: identity.name },
  company: {
    id: "company-1",
    name: "Acme Management",
    baseCurrency: "USD",
    role: "owner" as const,
  },
};

function repository(): AuthRepository {
  return {
    provisionIdentity: vi.fn().mockResolvedValue(context),
    findUser: vi.fn().mockResolvedValue(context.user),
    findCompanyForUser: vi.fn().mockImplementation(async (_userId, companyId) =>
      !companyId || companyId === context.company.id ? context.company : null,
    ),
  };
}

describe("company authorization", () => {
  it("derives company access from the authenticated identity", async () => {
    const service = createAuthService(
      { getIdentity: vi.fn().mockResolvedValue(identity) },
      repository(),
    );

    await expect(service.requireCompanyAccess()).resolves.toEqual(context);
  });

  it("rejects a browser-supplied company without a membership", async () => {
    const service = createAuthService(
      { getIdentity: vi.fn().mockResolvedValue(identity) },
      repository(),
    );

    await expect(service.requireCompanyAccess("company-2")).rejects.toBeInstanceOf(
      CompanyAccessDeniedError,
    );
  });
});
