/**
 * ColBERT MaxSim — late-interaction scoring (Khattab & Zaharia 2020,
 * Santhanam et al. 2022 ColBERTv2).
 *
 * For each query token, find its max cosine similarity against any doc
 * token; sum across query tokens. Captures token-level alignment that a
 * single pooled vector flattens away — significant recall gains on long
 * documents where the relevant span is one of many.
 *
 *   score(q, d) = sum_{i in q} max_{j in d} cos(q_i, d_j)
 *
 * Both inputs are assumed L2-normalized (so cos = dot product).
 */

export interface TokenMatrix {
  /** Flat Float32Array of length numTokens * dim. */
  data: Float32Array | number[];
  numTokens: number;
  dim: number;
}

/**
 * Pure MaxSim. Throws if dims mismatch — callers check first.
 */
export function maxSim(query: TokenMatrix, doc: TokenMatrix): number {
  // Short-circuit on empty: dim is undefined for empty matrices, so the
  // dim-mismatch check would false-positive.
  if (query.numTokens === 0 || doc.numTokens === 0) return 0;
  if (query.dim !== doc.dim) {
    throw new Error(`MaxSim dim mismatch: query=${query.dim} doc=${doc.dim}`);
  }
  const dim = query.dim;
  let total = 0;
  for (let qi = 0; qi < query.numTokens; qi++) {
    const qBase = qi * dim;
    let bestSim = -Infinity;
    for (let dj = 0; dj < doc.numTokens; dj++) {
      const dBase = dj * dim;
      let dot = 0;
      for (let d = 0; d < dim; d++) {
        dot += query.data[qBase + d] * doc.data[dBase + d];
      }
      if (dot > bestSim) bestSim = dot;
    }
    total += bestSim;
  }
  return total;
}

/**
 * Normalize a MaxSim score to a [0, 1] scale by dividing by query token
 * count (each query token's max contribution is 1.0 for unit vectors).
 * Lets callers blend ColBERT scores with single-vector similarity scores
 * that are already in [0, 1].
 */
export function normalizedMaxSim(query: TokenMatrix, doc: TokenMatrix): number {
  if (query.numTokens === 0) return 0;
  const raw = maxSim(query, doc);
  return Math.max(0, Math.min(1, raw / query.numTokens));
}
