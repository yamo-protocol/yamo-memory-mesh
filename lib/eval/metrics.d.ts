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
export declare function recallAtK(results: RankedResult[], gold: Set<string>, k: number): number;
/**
 * Reciprocal rank — 1 / rank of first gold item (1-indexed).
 * Returns 0 if no gold item is in results.
 */
export declare function reciprocalRank(results: RankedResult[], gold: Set<string>): number;
/**
 * nDCG@k with binary relevance.
 * DCG@k = sum_{i=1..k} rel_i / log2(i+1)
 * IDCG@k = sum_{i=1..min(k, |gold|)} 1 / log2(i+1)
 */
export declare function ndcgAtK(results: RankedResult[], gold: Set<string>, k: number): number;
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
export declare function evaluateQuery(results: RankedResult[], gold: Set<string>): QueryMetrics;
export declare function meanMetrics(perQuery: QueryMetrics[]): QueryMetrics;
