/**
 * WP3 — simple passage retrieval for report Q&A (RAG-lite).
 * Chunking at sentence boundaries + keyword-overlap scoring.
 * In the thesis this is upgraded to multilingual embeddings (bge-m3) +
 * a vector index, with the same citation contract.
 */

const AR_STOPWORDS = new Set([
  "في", "من", "على", "عن", "إلى", "الى", "هو", "هي", "هذا", "هذه", "ذلك", "التي", "الذي",
  "ما", "هل", "كيف", "لماذا", "متى", "أين", "و", "أو", "ثم", "لا", "نعم", "مع", "كل",
  "بعد", "قبل", "بين", "حيث", "كان", "كانت", "يكون", "قد", "لقد", "ماذا",
  // generic report words — appear in nearly every passage, not discriminative
  "تقرير", "التقرير", "تقارير", "نتائج", "النتائج", "نتيجة", "النتيجة", "مستوى", "المستوى",
  "مستويات", "فحص", "الفحص", "فحوص", "تحليل", "التحليل", "قيمة", "القيمة", "قيم", "دل",
]);

const EN_STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "of", "in", "on", "at", "to",
  "for", "with", "and", "or", "but", "not", "what", "how", "why", "when", "where", "which",
  "do", "does", "did", "can", "could", "should", "would", "my", "me", "i", "you", "it",
  "this", "that", "these", "those", "about", "from", "by", "as",
  // generic report words
  "report", "reports", "result", "results", "test", "tests", "level", "levels", "value",
  "values", "analysis",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !AR_STOPWORDS.has(w) && !EN_STOPWORDS.has(w));
}

export function chunkReport(content: string, target = 420): string[] {
  const clean = content.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?؟。])\s+|\n{2,}/g).filter((s) => s.trim().length > 0);
  const chunks: string[] = [];
  let current = "";
  for (const s of sentences) {
    if ((current + " " + s).length > target && current.length > 0) {
      chunks.push(current.trim());
      current = s;
    } else {
      current = current ? `${current} ${s}` : s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function retrievePassages(
  question: string,
  passages: string[],
  topK = 3
): { index: number; passage: string }[] {
  const qTokens = new Set(tokenize(question));
  if (qTokens.size === 0) return [];
  const scored = passages.map((passage, index) => {
    const pTokens = tokenize(passage);
    const pSet = new Set(pTokens);
    let score = 0;
    for (const t of qTokens) if (pSet.has(t)) score += 1;
    return { index, passage, score };
  });
  return scored
    .filter((s) => s.score >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ index, passage }) => ({ index, passage }));
}
