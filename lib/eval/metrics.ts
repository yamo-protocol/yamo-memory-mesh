/**
 * Ranking metrics for retrieval evaluation.
 * Binary relevance (gold or not). Graded relevance can be added later
 * by changing rel from boolean to number.
 */

export interface RankedResult {
  id: string;
}

/**
 * Recall@k — fraction of gold items appearing in the top-k results.
 */
export function recallAtK(results: RankedResult[], gold: Set<string>, k: number): number {
  if (gold.size === 0) return 0;
  const topK = results.slice(0, k);
  let hits = 0;
  for (const r of topK) {
    if (gold.has(r.id)) hits++;
  }
  return hits / gold.size;
}

/**
 * Reciprocal rank — 1 / rank of first gold item (1-indexed).
 * Returns 0 if no gold item is in results.
 */
export function reciprocalRank(results: RankedResult[], gold: Set<string>): number {
  for (let i = 0; i < results.length; i++) {
    if (gold.has(results[i].id)) return 1 / (i + 1);
  }
  return 0;
}

/**
 * nDCG@k with binary relevance.
 * DCG@k = sum_{i=1..k} rel_i / log2(i+1)
 * IDCG@k = sum_{i=1..min(k, |gold|)} 1 / log2(i+1)
 */
export function ndcgAtK(results: RankedResult[], gold: Set<string>, k: number): number {
  if (gold.size === 0) return 0;
  const topK = results.slice(0, k);
  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    if (gold.has(topK[i].id)) {
      dcg += 1 / Math.log2(i + 2); // i+2 because rank is 1-indexed → denom is log2(rank+1)
    }
  }
  const idealCount = Math.min(k, gold.size);
  let idcg = 0;
  for (let i = 0; i < idealCount; i++) {
    idcg += 1 / Math.log2(i + 2);
  }
  return idcg === 0 ? 0 : dcg / idcg;
}

/**
 * Aggregate per-query metrics into mean values per metric.
 */
export interface QueryMetrics {
  recall_at_5: number;
  recall_at_10: number;
  recall_at_20: number;
  mrr: number;
  ndcg_at_10: number;
}

export function evaluateQuery(results: RankedResult[], gold: Set<string>): QueryMetrics {
  return {
    recall_at_5: recallAtK(results, gold, 5),
    recall_at_10: recallAtK(results, gold, 10),
    recall_at_20: recallAtK(results, gold, 20),
    mrr: reciprocalRank(results, gold),
    ndcg_at_10: ndcgAtK(results, gold, 10),
  };
}

export function meanMetrics(perQuery: QueryMetrics[]): QueryMetrics {
  if (perQuery.length === 0) {
    return { recall_at_5: 0, recall_at_10: 0, recall_at_20: 0, mrr: 0, ndcg_at_10: 0 };
  }
  const sum = perQuery.reduce(
    (acc, m) => ({
      recall_at_5: acc.recall_at_5 + m.recall_at_5,
      recall_at_10: acc.recall_at_10 + m.recall_at_10,
      recall_at_20: acc.recall_at_20 + m.recall_at_20,
      mrr: acc.mrr + m.mrr,
      ndcg_at_10: acc.ndcg_at_10 + m.ndcg_at_10,
    }),
    { recall_at_5: 0, recall_at_10: 0, recall_at_20: 0, mrr: 0, ndcg_at_10: 0 },
  );
  const n = perQuery.length;
  return {
    recall_at_5: sum.recall_at_5 / n,
    recall_at_10: sum.recall_at_10 / n,
    recall_at_20: sum.recall_at_20 / n,
    mrr: sum.mrr / n,
    ndcg_at_10: sum.ndcg_at_10 / n,
  };
}
