export type EntityId = string;
export type ISODate = string;

export type Source = { id: EntityId; companyId: EntityId; type: "file" | "conversation" | "system"; filename?: string; mimeType?: string; storageReference?: string; hash?: string; metadata: Record<string, unknown>; createdAt: ISODate };
export type Observation = { id: EntityId; companyId: EntityId; sourceId: EntityId; type: string; observedAt?: ISODate; effectiveDate?: ISODate; amount?: string; currency?: string; counterpartyText?: string; attributes: Record<string, unknown>; confidence: number };
export type Entity = { id: EntityId; companyId: EntityId; type: "company" | "person" | "vendor" | "customer" | "account"; name: string; attributes: Record<string, unknown> };
export type Relationship = { id: EntityId; companyId: EntityId; fromEntityId: EntityId; toEntityId: EntityId; type: string; attributes: Record<string, unknown> };
export type Agreement = { id: EntityId; companyId: EntityId; sourceId?: EntityId; counterparty?: string; label: string; amount?: string; currency?: string; cadence?: string; accountingTreatment?: "cash" | "accrual" | "prepaid"; recognitionStart?: string; recognitionEnd?: string; status: "proposed" | "confirmed" | "rejected" };
export type Fact = { id: EntityId; companyId: EntityId; sourceId?: EntityId; label: string; value: string; confidence: number; status: "pending" | "approved" | "rejected" };
export type Event = { id: EntityId; companyId: EntityId; sourceId?: EntityId; effectiveDate: ISODate; amount: string; currency: string; direction: "receipt" | "spend"; description: string; category?: string; accountingTreatment?: "cash" | "accrual" | "prepaid"; actual: boolean };
export type Obligation = { id: EntityId; companyId: EntityId; sourceId?: EntityId; counterparty?: string; label: string; amount?: string; currency?: string; cadence?: string; accountingTreatment?: "cash" | "accrual" | "prepaid"; recognitionStart?: string; recognitionEnd?: string; status: "proposed" | "confirmed" | "rejected" };
export type Decision = { id: EntityId; companyId: EntityId; question: string; answer: string; appliesTo?: string; createdAt: ISODate };
export type Policy = { id: EntityId; companyId: EntityId; name: string; rule: string; sourceDecisionId?: EntityId; active: boolean };
export type Assumption = { id: EntityId; companyId: EntityId; name: string; value: string; unit?: string; sourceId?: EntityId; active: boolean };
export type Scenario = { id: EntityId; companyId: EntityId; name: string; assumptions: EntityId[]; active: boolean };
export type Allocation = { id: EntityId; companyId: EntityId; eventId?: EntityId; payerEntityId?: EntityId; bearerEntityId?: EntityId; percentage?: string; amount?: string; sourceId?: EntityId; status: "proposed" | "approved" | "rejected" };
export type ReviewItem = { id: EntityId; companyId: EntityId; sourceId?: EntityId; question: string; confidence?: number; status: "pending" | "approved" | "rejected" };

export type CompanyState = { sources: Source[]; observations: Observation[]; entities: Entity[]; relationships: Relationship[]; agreements: Agreement[]; facts: Fact[]; events: Event[]; obligations: Obligation[]; decisions: Decision[]; policies: Policy[]; assumptions: Assumption[]; scenarios: Scenario[]; allocations: Allocation[]; reviewItems: ReviewItem[] };
