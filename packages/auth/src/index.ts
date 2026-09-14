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

/**
 * An owner holds every right in the company; a member does all financial work
 * but cannot change settings, manage members, or reset the company.
 */
export const companyRoles = ["owner", "member"] as const;

export type CompanyRole = (typeof companyRoles)[number];

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

/** An accepted member of a company: a user row plus the membership's role. */
export type CompanyMember = {
  userId: string;
  email: string;
  name: string | null;
  role: CompanyRole;
  createdAt: string;
};

/** An address invited to a company before an account with it existed. */
export type PendingMember = {
  id: string;
  email: string;
  role: CompanyRole;
  createdAt: string;
};

export type AddMemberResult =
  | { status: "active"; member: CompanyMember }
  | { status: "pending"; pending: PendingMember };

/** `worker` has no actor; `agent` is attributed to the user who asked. */
export type AuditVia = "ui" | "agent" | "worker";

/**
 * One recorded change. The optional fields are declared with `| undefined` so
 * a caller under `exactOptionalPropertyTypes` may pass them through unset.
 */
export type AuditEntry = {
  companyId: string;
  actorUserId: string | null;
  via: AuditVia;
  action: string;
  entityType?: string | undefined;
  entityId?: string | undefined;
  summary: string;
  before?: unknown;
  after?: unknown;
  requestId?: string | undefined;
};

export interface MemberRepository {
  listMembers(companyId: string): Promise<{ members: CompanyMember[]; pending: PendingMember[] }>;
  /**
   * Add an address to the company. An existing user becomes a member at once;
   * any other address waits in `pending` until it first signs in. Adding an
   * address that is already a member is a no-op that reports the membership.
   */
  addMember(
    companyId: string,
    input: { email: string; role: CompanyRole },
    actorUserId: string | null,
  ): Promise<AddMemberResult>;
  /** Throws `LastOwnerError` rather than leave the company without an owner. */
  updateMemberRole(companyId: string, userId: string, role: CompanyRole): Promise<CompanyMember>;
  /** Throws `LastOwnerError` rather than leave the company without an owner. */
  removeMember(companyId: string, userId: string): Promise<void>;
  removePendingMember(companyId: string, pendingId: string): Promise<void>;
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

export class InvalidMemberInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMemberInputError";
  }
}

/** The acting user's role is below what the action needs; adapters map it to 403. */
export class CompanyRoleRequiredError extends Error {
  readonly role: CompanyRole;

  constructor(role: CompanyRole) {
    super(`This action requires the ${role} role`);
    this.name = "CompanyRoleRequiredError";
    this.role = role;
  }
}

/** A company always keeps one owner, so the last one cannot be demoted or removed. */
export class LastOwnerError extends Error {
  constructor() {
    super("A company must keep at least one owner");
    this.name = "LastOwnerError";
  }
}

export const maxCompanyNameLength = 160;
/** The longest address RFC 5321 allows; the column is text, the bound is ours. */
export const maxMemberEmailLength = 254;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A stored or requested company id must at least look like a company id before it reaches the database. */
export function isCompanyId(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

export function isCompanyRole(value: unknown): value is CompanyRole {
  return typeof value === "string" && (companyRoles as readonly string[]).includes(value);
}

/**
 * Rights are the role's, so a role check is a lattice, not an equality: an
 * owner satisfies every requirement, a member only its own.
 */
export function requireCompanyRole(context: ApplicationContext, role: CompanyRole): void {
  if (context.company.role === "owner") return;
  if (context.company.role === role) return;
  throw new CompanyRoleRequiredError(role);
}

/**
 * Addresses are compared lowercased and trimmed, so the stored form is the
 * comparison form. The shape check stays deliberately weak - no address can be
 * verified without sending mail, and this installation sends none - it only
 * rejects values that cannot be an address at all.
 */
export function normalizeMemberEmail(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
  if (!email || email.length > maxMemberEmailLength || !/^[^\s@]+@[^\s@]+$/.test(email)) {
    throw new InvalidMemberInputError(
      `A member email address is required and must be ${maxMemberEmailLength} characters or fewer`,
    );
  }
  return email;
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
