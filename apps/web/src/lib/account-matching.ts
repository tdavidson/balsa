export type AccountCandidate = { id: string; name: string; attributes: string };

export type StatementAccountMetadata = {
  accountHolder?: string | undefined;
  accountIdentifier?: string | undefined;
};

export function normalizeAccountIdentifier(value: string | undefined) {
  return value?.replace(/[^a-z0-9]/gi, "").toLowerCase() || undefined;
}

export function matchStatementAccount(metadata: StatementAccountMetadata, candidates: AccountCandidate[]) {
  const identifier = normalizeAccountIdentifier(metadata.accountIdentifier);
  const holder = metadata.accountHolder?.trim().toLowerCase();
  if (!identifier && !holder) return undefined;
  return candidates.find((candidate) => {
    let attributes: { accountIdentifier?: string; accountHolder?: string } = {};
    try { attributes = JSON.parse(candidate.attributes) as typeof attributes; } catch { /* ignore malformed entity metadata */ }
    const candidateIdentifier = normalizeAccountIdentifier(attributes.accountIdentifier) ?? normalizeAccountIdentifier(candidate.name) ?? "";
    const candidateHolder = attributes.accountHolder?.trim().toLowerCase() ?? candidate.name.toLowerCase();
    const identifierMatches = Boolean(identifier && candidateIdentifier === identifier) || Boolean(identifier && identifier.length >= 4 && candidateIdentifier.endsWith(identifier));
    return identifierMatches || Boolean(holder && candidateHolder === holder);
  });
}
