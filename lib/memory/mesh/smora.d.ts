import type { MemoryMesh } from "../memory-mesh.js";
/**
 * S-MORA: Singularity Memory-Oriented Retrieval Augmentation (RFC-0012)
 * 5-layer pipeline: Scrubbing → HyDE-Lite → Multi-channel retrieval → RRF → Heritage-aware reranking
 */
export declare function smora(mesh: MemoryMesh, query: string, options?: {
    limit?: number;
    retrievalLimit?: number;
    sessionIntent?: string[];
    enableSynthesis?: boolean;
    enableHyDE?: boolean;
    useCache?: boolean;
}): Promise<{
    results: Array<{
        id: string;
        content: string;
        metadata: Record<string, unknown>;
        score: number;
        semanticScore: number;
        heritageBonus: number;
        recencyDecay: number;
        rrfRank: number;
    }>;
    synthesis?: string;
    pipeline: {
        queryExpanded: boolean;
        heritageAware: boolean;
        synthesized: boolean;
        latencyMs: number;
    };
}>;
/**
 * Canonicalize an intent string for caching + lookup. Mirrors
 * _canonicalizeEntity's lightweight normalization but preserves
 * intent vocabulary (no plural stripping — "debug" and "debugs" are
 * legitimately different verbs/states in intent chains).
 * @private
 */
export declare function _canonicalizeIntent(mesh: MemoryMesh, intent: string): string;
/**
 * Embed a single intent string with persistent caching. Intents are
 * low-cardinality (handfuls per project) and stable across queries, so
 * the cache hits hard. Cap at 500 entries with LRU eviction. Returns
 * null on any failure so callers can fall back to raw overlap.
 * @private
 */
export declare function _embedIntent(mesh: MemoryMesh, intent: string): Promise<any>;
/**
 * Heritage bonus from intent vector matrices. For each session intent,
 * take its max cosine similarity against any chain intent (MaxSim),
 * sum, divide by sessionIntent count. Vectors are assumed
 * L2-normalized (embedding service normalizes by default), so cosine =
 * dot product. Returns 0 on empty/invalid input.
 * @private
 */
export declare function _heritageBonusFromVectors(mesh: MemoryMesh, sessionVecs: any, chainVecs: any, denom: number): number;
/**
 * Generate a HyDE (Hypothetical Document Embedding) expansion for a query.
 *
 * When an LLM is available, generates a 2-3 sentence hypothetical passage
 * that would directly answer the query — typically yields stronger vector
 * matches than the original short query because the generated text mirrors
 * the distribution of stored documents. Falls back to a template wrapper
 * if the LLM is disabled, fails, or times out (HYDE_TIMEOUT_MS, default 5s).
 *
 * Results are cached per-query with the same TTL as queryCache.
 */
export declare function _generateHyDE(mesh: MemoryMesh, query: string): Promise<string>;
