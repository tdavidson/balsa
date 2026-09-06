export type AuthIdentity = {
  provider: string;
  providerUserId: string;
  email: string;
  name: string | null;
};

export type ApplicationUser = {
  id: string;
  email: string;
  name: string | null;
};

export type AuthorizedCompany = {
  id: string;
  name: string;
  baseCurrency: string;
  role: "owner";
};

export type ApplicationContext = {
  user: ApplicationUser;
  company: AuthorizedCompany;
};

export interface IdentityProvider {
  getIdentity(): Promise<AuthIdentity | null>;
}

export interface AuthRepository {
  provisionIdentity(identity: AuthIdentity): Promise<ApplicationContext>;
  findUser(identity: AuthIdentity): Promise<ApplicationUser | null>;
  findCompanyForUser(
    userId: string,
    requestedCompanyId?: string,
  ): Promise<AuthorizedCompany | null>;
}

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Authentication is required");
    this.name = "AuthenticationRequiredError";
  }
}

export class CompanyAccessDeniedError extends Error {
  constructor() {
    super("The authenticated user cannot access this company");
    this.name = "CompanyAccessDeniedError";
  }
}

export function createAuthService(
  provider: IdentityProvider,
  repository: AuthRepository,
) {
  async function getCurrentIdentity() {
    return provider.getIdentity();
  }

  async function getCurrentUser() {
    const identity = await getCurrentIdentity();
    return identity ? repository.findUser(identity) : null;
  }

  async function requireUser() {
    const identity = await getCurrentIdentity();
    if (!identity) throw new AuthenticationRequiredError();

    const existing = await repository.findUser(identity);
    if (existing) return existing;

    return (await repository.provisionIdentity(identity)).user;
  }

  async function getCurrentCompany(requestedCompanyId?: string) {
    const identity = await getCurrentIdentity();
    if (!identity) return null;

    const user = await repository.findUser(identity);
    if (!user) return null;

    return repository.findCompanyForUser(user.id, requestedCompanyId);
  }

  async function requireCompanyAccess(
    requestedCompanyId?: string,
  ): Promise<ApplicationContext> {
    const identity = await getCurrentIdentity();
    if (!identity) throw new AuthenticationRequiredError();

    const provisioned = await repository.provisionIdentity(identity);
    if (!requestedCompanyId || provisioned.company.id === requestedCompanyId) {
      return provisioned;
    }

    const company = await repository.findCompanyForUser(
      provisioned.user.id,
      requestedCompanyId,
    );
    if (!company) throw new CompanyAccessDeniedError();

    return { user: provisioned.user, company };
  }

  return {
    getCurrentUser,
    requireUser,
    getCurrentCompany,
    requireCompanyAccess,
  };
}
