/** Source-specific remediation must never leak across document types. */
export function validQuestionsForSource(questions: string[], source: { isPdf: boolean }) {
  if (source.isPdf) return questions;
  return questions.filter((question) => !(/\b(?:pdf|ocr)\b/i.test(question) && /searchable|extract|process|copy|text/i.test(question)));
}
