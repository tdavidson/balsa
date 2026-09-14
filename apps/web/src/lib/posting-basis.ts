export type PostingBasis = { evidenceId?: string | undefined; factId?: string | undefined; decisionId?: string | undefined; policyId?: string | undefined; approvalEventId?: string | undefined };

/** A raw document reference is useful lineage, but never enough to authorize a posting. */
export function hasPostingBasis(basis: PostingBasis) {
  return Boolean(basis.evidenceId || basis.factId || basis.decisionId || basis.policyId || basis.approvalEventId);
}
