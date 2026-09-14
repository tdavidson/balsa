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
  hasAvatar: boolean;
};

export type CompanyRole = "owner";

/** The public shape of a company the current user may operate. */
export type CompanySummary = {
  id: string;
  name: string;
  baseCurrency: string;
  role: CompanyRole;
};

export type AuthorizedCompany = CompanySummary & {
  financialStateRevision: string;
};

/**
 * How the active company was chosen for this request.
 *
 * - `requested`: the caller named a company and membership was verified.
 * - `selected`: the stored preference (cookie) named an authorized company.
 * - `default`: the user's first company; `staleSelection` is true when a
 *   stored preference existed but was rejected and should be cleared.
 */
export type CompanySelection = {
  source: "requested" | "selected" | "default";
  staleSelection: boolean;
};

export type ProvisionedIdentity = {
  user: ApplicationUser;
  company: AuthorizedCompany;
};

export type ApplicationContext = ProvisionedIdentity & {
  selection: CompanySelection;
};

export type NewCompanyInput = {
  name: string;
  baseCurrency: string;
};

export interface IdentityProvider {
  getIdentity(): Promise<AuthIdentity | null>;
}

/**
 * Reads the user's stored company preference. The value is a preference, not
 * authorization: the service always verifies membership before using it.
 */
export interface CompanySelectionStore {
  read(): Promise<string | null>;
}

export interface AuthRepository {
  /**
   * Resolve or create the application user for an identity and return the
   * user's first company. A company is created only when the user has no
   * membership at all; a multi-company user never receives an extra company.
   */
  provisionIdentity(identity: AuthIdentity): Promise<ProvisionedIdentity>;
  findUser(identity: AuthIdentity): Promise<ApplicationUser | null>;
  findCompanyForUser(
    userId: string,
    requestedCompanyId?: string,
  ): Promise<AuthorizedCompany | null>;
  /** Every company the user belongs to, in the same order provisioning uses for the default. */
  listCompaniesForUser(userId: string): Promise<AuthorizedCompany[]>;
  /** Insert a clean company and an owner membership for the user in one transaction. */
  createCompanyForUser(
    userId: string,
    input: NewCompanyInput,
  ): Promise<AuthorizedCompany>;
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

export class InvalidCompanyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCompanyInputError";
  }
}

export const maxCompanyNameLength = 160;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A stored or requested company id must at least look like a company id before it reaches the database. */
export function isCompanyId(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

/** Normalize and validate the fields a user supplies when creating a company. */
export function normalizeNewCompanyInput(input: {
  name?: unknown;
  baseCurrency?: unknown;
}): NewCompanyInput {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const baseCurrency =
    typeof input.baseCurrency === "string" ? input.baseCurrency.trim().toUpperCase() : "";
  if (!name || name.length > maxCompanyNameLength) {
    throw new InvalidCompanyInputError(
      `Company name is required and must be ${maxCompanyNameLength} characters or fewer`,
    );
  }
  if (!/^[A-Z]{3}$/.test(baseCurrency)) {
    throw new InvalidCompanyInputError("Base currency must be a three-letter code");
  }
  return { name, baseCurrency };
}

/**
 * Companies declared in the environment, as comma-separated `Name` or
 * `Name:CUR` entries. The trailing `:CUR` is a separator only when it is
 * exactly three letters, so `Acme: Berlin` stays one name; the cost of that
 * rule is that a name whose own last colon-separated segment is three letters
 * (`Acme:Ltd`) cannot be expressed and reads as a currency. An entry that does
 * not normalize is skipped rather than thrown: a typo in installation
 * configuration must never block the owner's sign-in.
 */
export function parseConfiguredCompanies(value: string | undefined): NewCompanyInput[] {
  const configured: NewCompanyInput[] = [];
  for (const entry of (value ?? "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const separator = trimmed.lastIndexOf(":");
    const suffix = separator === -1 ? "" : trimmed.slice(separator + 1).trim();
    const hasCurrency = /^[A-Za-z]{3}$/.test(suffix);
    try {
      configured.push(
        normalizeNewCompanyInput({
          name: hasCurrency ? trimmed.slice(0, separator) : trimmed,
          baseCurrency: hasCurrency ? suffix : "USD",
        }),
      );
    } catch {
      // Skipped by design; see the note above.
    }
  }
  return configured;
}

export function createAuthService(
  provider: IdentityProvider,
  repository: AuthRepository,
  options: { selection?: CompanySelectionStore } = {},
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

  async function readSelectedCompanyId() {
    const stored = await options.selection?.read();
    return isCompanyId(stored) ? stored : null;
  }

  /**
   * Resolve the company for this request. An explicitly requested company must
   * be one the user belongs to. Without an explicit request, the stored
   * preference is used when it names an authorized company; otherwise the
   * user's first company is opened and the stale preference is reported so the
   * caller can clear it.
   */
  async function requireCompanyAccess(
    requestedCompanyId?: string,
  ): Promise<ApplicationContext> {
    const identity = await getCurrentIdentity();
    if (!identity) throw new AuthenticationRequiredError();

    const provisioned = await repository.provisionIdentity(identity);

    if (requestedCompanyId !== undefined) {
      if (provisioned.company.id === requestedCompanyId) {
        return { ...provisioned, selection: { source: "requested", staleSelection: false } };
      }
      const company = isCompanyId(requestedCompanyId)
        ? await repository.findCompanyForUser(provisioned.user.id, requestedCompanyId)
        : null;
      if (!company) throw new CompanyAccessDeniedError();
      return { user: provisioned.user, company, selection: { source: "requested", staleSelection: false } };
    }

    const selectedCompanyId = await readSelectedCompanyId();
    if (selectedCompanyId) {
      if (selectedCompanyId === provisioned.company.id) {
        return { ...provisioned, selection: { source: "selected", staleSelection: false } };
      }
      const company = await repository.findCompanyForUser(provisioned.user.id, selectedCompanyId);
      if (company) {
        return { user: provisioned.user, company, selection: { source: "selected", staleSelection: false } };
      }
      return { ...provisioned, selection: { source: "default", staleSelection: true } };
    }

    return { ...provisioned, selection: { source: "default", staleSelection: false } };
  }

  /** Every company the current user may open, in default-selection order. */
  async function listCompanies(): Promise<AuthorizedCompany[]> {
    const user = await requireUser();
    return repository.listCompaniesForUser(user.id);
  }

  /** Create a clean company owned by the current user. It copies nothing from other companies. */
  async function createCompany(input: { name?: unknown; baseCurrency?: unknown }) {
    const user = await requireUser();
    return repository.createCompanyForUser(user.id, normalizeNewCompanyInput(input));
  }

  return {
    getCurrentUser,
    requireUser,
    getCurrentCompany,
    requireCompanyAccess,
    listCompanies,
    createCompany,
  };
}
