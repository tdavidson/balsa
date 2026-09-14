import { describe, expect, it, vi } from "vitest";
import {
  CompanyAccessDeniedError,
  InvalidCompanyInputError,
  createAuthService,
  isCompanyId,
  normalizeNewCompanyInput,
  type AuthIdentity,
  type AuthRepository,
  type AuthorizedCompany,
  type CompanySelectionStore,
} from "./index";

const identity: AuthIdentity = {
  provider: "test-provider",
  providerUserId: "user_123",
  email: "cfo@example.com",
  name: "CFO",
};

const user = { id: "app-user", email: identity.email, name: identity.name, hasAvatar: false };

const firstCompany: AuthorizedCompany = {
  id: "0f6c6d3e-1b6e-4f2c-9a5b-1c2d3e4f5a6b",
  name: "Acme Management",
  baseCurrency: "USD",
  financialStateRevision: "0",
  role: "owner",
};

const secondCompany: AuthorizedCompany = {
  id: "7d1f0a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b",
  name: "Beta Holdings",
  baseCurrency: "EUR",
  financialStateRevision: "4",
  role: "owner",
};

const foreignCompanyId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const provisioned = { user, company: firstCompany };

function repository(companies: AuthorizedCompany[] = [firstCompany, secondCompany]): AuthRepository {
  return {
    provisionIdentity: vi.fn().mockResolvedValue(provisioned),
    findUser: vi.fn().mockResolvedValue(user),
    findCompanyForUser: vi.fn().mockImplementation(async (_userId, companyId) =>
      companyId ? companies.find((company) => company.id === companyId) ?? null : companies[0] ?? null,
    ),
    listCompaniesForUser: vi.fn().mockResolvedValue(companies),
    createCompanyForUser: vi.fn().mockImplementation(async (_userId, input) => ({
      id: "new-company", financialStateRevision: "0", role: "owner", ...input,
    })),
  };
}

function selection(value: string | null): CompanySelectionStore {
  return { read: vi.fn().mockResolvedValue(value) };
}

function service(repo = repository(), store?: CompanySelectionStore) {
  return createAuthService({ getIdentity: vi.fn().mockResolvedValue(identity) }, repo, store ? { selection: store } : {});
}

describe("company authorization", () => {
  it("derives company access from the authenticated identity", async () => {
    await expect(service().requireCompanyAccess()).resolves.toEqual({
      ...provisioned,
      selection: { source: "default", staleSelection: false },
    });
  });

  it("rejects a browser-supplied company without a membership", async () => {
    await expect(service().requireCompanyAccess(foreignCompanyId)).rejects.toBeInstanceOf(CompanyAccessDeniedError);
  });

  it("rejects a malformed requested company id without querying the repository", async () => {
    const repo = repository();
    await expect(service(repo).requireCompanyAccess("not-a-company")).rejects.toBeInstanceOf(CompanyAccessDeniedError);
    expect(repo.findCompanyForUser).not.toHaveBeenCalled();
  });

  it("opens an explicitly requested company the user belongs to", async () => {
    await expect(service().requireCompanyAccess(secondCompany.id)).resolves.toEqual({
      user,
      company: secondCompany,
      selection: { source: "requested", staleSelection: false },
    });
  });

  it("provisions a newly authenticated identity before a company is read", async () => {
    const repo = repository();
    vi.mocked(repo.findUser).mockResolvedValue(null);
    await expect(service(repo).requireUser()).resolves.toEqual(user);
    expect(repo.provisionIdentity).toHaveBeenCalledWith(identity);
  });
});

describe("active-company selection", () => {
  it("opens the stored company when the user belongs to it", async () => {
    await expect(service(repository(), selection(secondCompany.id)).requireCompanyAccess()).resolves.toEqual({
      user,
      company: secondCompany,
      selection: { source: "selected", staleSelection: false },
    });
  });

  it("reports the stored default company as selected", async () => {
    await expect(service(repository(), selection(firstCompany.id)).requireCompanyAccess()).resolves.toEqual({
      ...provisioned,
      selection: { source: "selected", staleSelection: false },
    });
  });

  it("falls back to the first company and flags a stored company the user cannot access", async () => {
    await expect(service(repository(), selection(foreignCompanyId)).requireCompanyAccess()).resolves.toEqual({
      ...provisioned,
      selection: { source: "default", staleSelection: true },
    });
  });

  it("falls back to the first company and flags a stored company that no longer exists", async () => {
    const repo = repository([firstCompany]);
    await expect(service(repo, selection(secondCompany.id)).requireCompanyAccess()).resolves.toEqual({
      ...provisioned,
      selection: { source: "default", staleSelection: true },
    });
  });

  it("ignores a malformed stored value without querying the repository", async () => {
    const repo = repository();
    await expect(service(repo, selection("'; drop table companies; --")).requireCompanyAccess()).resolves.toEqual({
      ...provisioned,
      selection: { source: "default", staleSelection: false },
    });
    expect(repo.findCompanyForUser).not.toHaveBeenCalled();
  });

  it("never lets the stored preference override an explicit request", async () => {
    const repo = repository();
    await expect(service(repo, selection(secondCompany.id)).requireCompanyAccess(foreignCompanyId)).rejects.toBeInstanceOf(CompanyAccessDeniedError);
  });
});

describe("company listing and creation", () => {
  it("lists every company the user belongs to", async () => {
    await expect(service().listCompanies()).resolves.toEqual([firstCompany, secondCompany]);
  });

  it("creates a company from normalized input for the current user", async () => {
    const repo = repository();
    await expect(service(repo).createCompany({ name: "  Gamma Ltd ", baseCurrency: "gbp" })).resolves.toMatchObject({
      name: "Gamma Ltd",
      baseCurrency: "GBP",
      role: "owner",
    });
    expect(repo.createCompanyForUser).toHaveBeenCalledWith(user.id, { name: "Gamma Ltd", baseCurrency: "GBP" });
  });

  it("rejects invalid company input before touching the repository", async () => {
    const repo = repository();
    await expect(service(repo).createCompany({ name: "", baseCurrency: "USD" })).rejects.toBeInstanceOf(InvalidCompanyInputError);
    await expect(service(repo).createCompany({ name: "Delta", baseCurrency: "US" })).rejects.toBeInstanceOf(InvalidCompanyInputError);
    expect(repo.createCompanyForUser).not.toHaveBeenCalled();
  });
});

describe("input helpers", () => {
  it("recognizes company ids", () => {
    expect(isCompanyId(firstCompany.id)).toBe(true);
    expect(isCompanyId("company-1")).toBe(false);
    expect(isCompanyId(null)).toBe(false);
  });

  it("normalizes new company input", () => {
    expect(normalizeNewCompanyInput({ name: " Acme ", baseCurrency: "usd" })).toEqual({ name: "Acme", baseCurrency: "USD" });
    expect(() => normalizeNewCompanyInput({ name: "x".repeat(161), baseCurrency: "USD" })).toThrow(InvalidCompanyInputError);
  });
});
