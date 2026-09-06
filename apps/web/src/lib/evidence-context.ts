export type EvidenceDocument = {
  id: string;
  sourceName: string;
  rawText: string;
  extractedJson?: string | null;
};

const stopWords = new Set([
  "about", "after", "again", "could", "from", "have", "into", "just", "need", "question", "regarding", "should", "statement", "statements", "that", "their", "there", "these", "they", "this", "what", "when", "where", "which", "with", "would", "your",
]);

function queryTerms(query: string) {
  return [...new Set(query.toLowerCase().match(/[a-z0-9][a-z0-9'-]{3,}/g) ?? [])]
    .filter((term) => !stopWords.has(term))
    .slice(0, 40);
}

function excerptFor(rawText: string, terms: string[], focused: boolean) {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const matches = lines.flatMap((line, index) => {
    const lower = line.toLowerCase();
    const score = terms.reduce((total, term) => total + (lower.includes(term) ? 1 : 0), 0);
    return score ? [{ index, score }] : [];
  }).sort((a, b) => b.score - a.score || a.index - b.index);

  if (!matches.length) return focused ? rawText.slice(0, 12_000) : "";
  const indexes = new Set<number>();
  for (const match of matches.slice(0, 24)) {
    for (let index = Math.max(0, match.index - 1); index <= Math.min(lines.length - 1, match.index + 1); index += 1) indexes.add(index);
  }
  return [...indexes].sort((a, b) => a - b).map((index) => lines[index]).join("\n").slice(0, 20_000);
}

function extractedFor(extractedJson: string | null | undefined, terms: string[], focused: boolean) {
  if (!extractedJson) return null;
  try {
    const parsed = JSON.parse(extractedJson) as { summary?: string; facts?: unknown[]; questions?: string[] };
    const facts = (parsed.facts ?? []).filter((fact) => {
      const text = JSON.stringify(fact).toLowerCase();
      return terms.some((term) => text.includes(term));
    });
    return {
      summary: parsed.summary,
      facts: (facts.length ? facts : focused ? parsed.facts ?? [] : []).slice(0, 40),
      questions: (parsed.questions ?? []).slice(0, 10),
    };
  } catch {
    return focused ? extractedJson.slice(0, 12_000) : null;
  }
}

/** Select small, query-relevant excerpts while always retaining the source attached to the focused review item. */
export function relevantEvidenceContext(documents: EvidenceDocument[], query: string, focusedEvidenceId?: string | null) {
  const terms = queryTerms(query);
  return documents
    .map((document) => {
      const focused = document.id === focusedEvidenceId;
      const excerpt = excerptFor(document.rawText, terms, focused);
      const lower = `${document.sourceName}\n${excerpt}`.toLowerCase();
      const score = (focused ? 1_000 : 0) + terms.reduce((total, term) => total + (lower.includes(term) ? 1 : 0), 0);
      return { id: document.id, sourceName: document.sourceName, excerpt, extracted: extractedFor(document.extractedJson, terms, focused), score };
    })
    .filter((document) => document.excerpt && document.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((document) => ({ id: document.id, sourceName: document.sourceName, excerpt: document.excerpt, extracted: document.extracted }));
}
