const stopWords = new Set([
  "a", "an", "and", "are", "be", "by", "do", "for", "how", "in", "is", "it", "of", "or", "should", "the", "these", "this", "to", "what", "when", "with",
]);

function words(question: string) {
  return new Set(
    question
      .toLowerCase()
      .replace(/automatic\s+investment/g, "automatic-investment")
      .replace(/auto\s+bank\s+product\s+deposit/g, "auto-bank-product-deposit")
      .replace(/[^a-z0-9-]+/g, " ")
      .split(/\s+/)
      .map((word) => word.replace(/(ing|ed|s)$/i, ""))
      .filter((word) => word.length > 2 && !stopWords.has(word)),
  );
}

/** Groups obvious duplicates while leaving unrelated CFO questions separate. */
export function areRelatedReviewQuestions(left: string, right: string) {
  const a = words(left);
  const b = words(right);
  const overlap = [...a].filter((word) => b.has(word)).length;
  if (overlap < 3) return false;
  if ([...a].every((word) => b.has(word)) || [...b].every((word) => a.has(word))) return true;
  return overlap / new Set([...a, ...b]).size >= 0.3;
}

export function uniqueReviewQuestions<T extends { question: string }>(items: T[]) {
  const result: T[] = [];
  for (const item of items) {
    if (!result.some((existing) => areRelatedReviewQuestions(existing.question, item.question))) result.push(item);
  }
  return result;
}
