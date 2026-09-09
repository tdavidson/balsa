export type EvidenceFact = { label: string; value: string };

export function compareEvidenceFacts(previous: EvidenceFact[], current: EvidenceFact[]) {
  const before = new Map(previous.map((fact) => [fact.label.trim().toLowerCase(), fact]));
  const after = new Map(current.map((fact) => [fact.label.trim().toLowerCase(), fact]));
  const added = current.filter((fact) => !before.has(fact.label.trim().toLowerCase()));
  const removed = previous.filter((fact) => !after.has(fact.label.trim().toLowerCase()));
  const changed = current.filter((fact) => {
    const prior = before.get(fact.label.trim().toLowerCase());
    return prior && prior.value !== fact.value;
  }).map((fact) => ({ label: fact.label, before: before.get(fact.label.trim().toLowerCase())!.value, after: fact.value }));
  return { added, removed, changed };
}
