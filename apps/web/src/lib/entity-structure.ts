import "server-only";
import { asc, eq } from "drizzle-orm";
import { entities, getDatabase } from "@finance/database";
import { matchStatementAccount } from "@/lib/account-matching";
import { normalizeAlias, parseEntityAttributes } from "@/lib/interpretation";

/**
 * The company's own structure: legal entities and the accounts they own.
 * When no legal entity exists the company is one implicit entity; when they
 * exist, anything not stamped with an entity belongs to the oldest one.
 */
export type LegalEntity = { id: string; name: string; consolidated: boolean; functionalCurrency: string | null; consolidationMethod: "full" | "equity" | "exclude"; ownershipPercent: string | null; effectiveFrom: string | null; effectiveTo: string | null };
export type Account = { id: string; name: string; ownerEntityId: string | null; attributes: string };
export type EntityStructure = { legalEntities: LegalEntity[]; accounts: Account[]; defaultEntityId?: string; entityOfAccount: (accountId: string | null | undefined) => string | undefined; resolveEntityName: (name: string | null | undefined) => string | undefined };

export async function loadEntityStructure(companyId: string): Promise<EntityStructure> {
  const rows = await getDatabase().select({ id: entities.id, name: entities.name, type: entities.type, attributes: entities.attributes, ownerEntityId: entities.ownerEntityId, consolidated: entities.consolidated, functionalCurrency: entities.functionalCurrency, consolidationMethod: entities.consolidationMethod, ownershipPercent: entities.ownershipPercent, effectiveFrom: entities.effectiveFrom, effectiveTo: entities.effectiveTo }).from(entities).where(eq(entities.companyId, companyId)).orderBy(asc(entities.createdAt));
  const legalEntities = rows.filter((row) => row.type === "legal_entity").map((row) => ({ id: row.id, name: row.name, consolidated: row.consolidated === "Y", functionalCurrency: row.functionalCurrency, consolidationMethod: (row.consolidationMethod === "equity" || row.consolidationMethod === "exclude" ? row.consolidationMethod : "full") as LegalEntity["consolidationMethod"], ownershipPercent: row.ownershipPercent, effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo }));
  const accounts = rows.filter((row) => row.type === "account").map((row) => ({ id: row.id, name: row.name, ownerEntityId: row.ownerEntityId, attributes: row.attributes }));
  const defaultEntityId = legalEntities[0]?.id;
  const ownerByAccount = new Map(accounts.map((account) => [account.id, account.ownerEntityId ?? undefined]));
  return {
    legalEntities,
    accounts,
    ...(defaultEntityId ? { defaultEntityId } : {}),
    entityOfAccount: (accountId) => (accountId ? ownerByAccount.get(accountId) ?? defaultEntityId : defaultEntityId),
    resolveEntityName: (name) => {
      if (!name) return undefined;
      const wanted = normalizeAlias(name);
      return legalEntities.find((entity) => normalizeAlias(entity.name) === wanted)?.id ?? legalEntities.find((entity) => wanted.includes(normalizeAlias(entity.name)) || normalizeAlias(entity.name).includes(wanted))?.id;
    },
  };
}

/**
 * Resolve which account a bank import belongs to: an explicit id, a note or
 * file name mentioning the account's name, holder, or last digits, or the only
 * account the company has.
 */
export function resolveImportAccount(structure: EntityStructure, hints: { accountId?: string | null | undefined; note?: string | null | undefined; fileName?: string | null | undefined }): Account | undefined {
  if (hints.accountId) { const explicit = structure.accounts.find((account) => account.id === hints.accountId); if (explicit) return explicit; }
  if (structure.accounts.length === 1) return structure.accounts[0];
  const text = [hints.note ?? "", hints.fileName ?? ""].join(" ");
  if (!text.trim()) return undefined;
  const digits = [...text.matchAll(/\b(\d{4})\b/g)].map((match) => match[1]!);
  for (const identifier of digits) {
    const byIdentifier = matchStatementAccount({ accountIdentifier: identifier }, structure.accounts);
    if (byIdentifier) return structure.accounts.find((account) => account.id === byIdentifier.id);
  }
  const normalized = normalizeAlias(text);
  return structure.accounts.find((account) => {
    const names = [account.name, parseEntityAttributes(account.attributes).accountHolder ?? ""].map(normalizeAlias).filter((value) => value.length >= 4);
    return names.some((candidate) => normalized.includes(candidate));
  });
}
