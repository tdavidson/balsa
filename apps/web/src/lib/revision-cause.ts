export type RevisionCauseKind =
  | "evidence_published" | "evidence_revoked" | "evidence_reprocessed"
  | "item_confirmed" | "item_rejected" | "item_edited" | "item_created"
  | "decision_applied" | "journal_posted" | "journal_reversed"
  | "period_closed" | "period_reopened" | "fx_changed" | "entity_changed"
  | "allocation_changed" | "mapping_approved" | "plan_pinned" | "settings_changed"
  | "period_rolled";

/** Why the financial state changed; recorded once per revision so every forecast consequence can name its causes. */
export type RevisionCause = { kind: RevisionCauseKind; subjectType: string; subjectId: string | null; actorUserId: string | null; via: "ui" | "agent" | "worker"; subjectIds?: string[] };
