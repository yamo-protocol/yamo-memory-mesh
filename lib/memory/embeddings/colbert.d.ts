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
export declare function maxSim(query: TokenMatrix, doc: TokenMatrix): number;
/**
 * Normalize a MaxSim score to a [0, 1] scale by dividing by query token
 * count (each query token's max contribution is 1.0 for unit vectors).
 * Lets callers blend ColBERT scores with single-vector similarity scores
 * that are already in [0, 1].
 */
export declare function normalizedMaxSim(query: TokenMatrix, doc: TokenMatrix): number;
