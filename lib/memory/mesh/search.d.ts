import type { MemoryMesh, RankedMemory } from "../memory-mesh.js";
/**
 * Search memory using hybrid vector + keyword search with Reciprocal Rank Fusion (RRF).
 *
 * This method performs semantic search by combining:
 * 1. **Vector Search**: Uses embeddings to find semantically similar content
 * 2. **Keyword Search**: Uses BM25-style keyword matching
 * 3. **RRF Fusion**: Combines both result sets using Reciprocal Rank Fusion
 *
 * The RRF algorithm scores each document as: `sum(1 / (k + rank))` where k=60.
 * This gives higher scores to documents that rank well in BOTH searches.
 *
 * **Performance**: Uses adaptive sorting strategy
 * - Small datasets (≤ 2× limit): Full sort O(n log n)
 * - Large datasets: Partial selection sort O(n×k) where k=limit
 *
 * **Caching**: Results are cached for 5 minutes by default (configurable via options)
 *
 * @param query - The search query text
 * @param options - Search options
 * @param options.limit - Maximum results to return (default: 10)
 * @param options.filter - LanceDB filter expression (e.g., "type == 'preference'")
 * @param options.useCache - Enable/disable result caching (default: true)
 * @returns Promise with array of search results, sorted by relevance score
 *
 * @example
 * ```typescript
 * // Simple search
 * const results = await mesh.search("TypeScript preferences");
 *
 * // Search with filter
 * const code = await mesh.search("bug fix", { filter: "type == 'error'" });
 *
 * // Search with limit
 * const top3 = await mesh.search("security issues", { limit: 3 });
 * ```
 *
 * @throws {Error} If embedding generation fails
 * @throws {Error} If database client is not initialized
 */
export declare function search(mesh: MemoryMesh, query: string, options?: {
    limit?: number;
    filter?: any;
    mode?: string;
    useCache?: boolean;
    includeArchived?: boolean;
}): Promise<RankedMemory[]>;
export declare function _keywordSearch(mesh: MemoryMesh, query: string, limit: number, filter?: any, opts?: {
    includeArchived?: boolean;
}): Promise<RankedMemory[]>;
/**
 * Subset of `ids` whose memory row matches `id IN (...)` plus an optional
 * extra clause (workspace-u2r). Chunked so the IN-list stays bounded; ids are
 * single-quote-escaped like every other interpolated id in this codebase.
 * Projects only the id column when the table supports select(), falling back
 * to the client's full-row read otherwise (same pattern as orphanEdges).
 */
export declare function _idSubsetWhere(mesh: MemoryMesh, ids: string[], clause: string | null): Promise<Set<string>>;
/** Default multiplier applied to the score of an ungrounded derived row. */
export declare const DEFAULT_UNGROUNDED_SCORE_FACTOR = 0.25;
/**
 * Derived (synthesized) memory types subject to the read-time grounding join
 * (workspace-u2r): consolidations, reflections, RAPTOR summary levels
 * (summary_l1, summary_l2, …) and distilled lessons. Everything else is a
 * primary observation and is never grounding-checked.
 */
export declare function _isDerivedType(type: unknown): boolean;
/**
 * Read-time grounding join (workspace-u2r) — provenance-grounded refusal
 * without persisted TMS state.
 *
 * For each derived hit (see _isDerivedType), collect the sources it cites —
 * `depends-on` / `justified-by` edges out of decision_edges first, then the
 * metadata fallbacks in CITED_METADATA_FIELDS — and count how many of them
 * currently pass _activeStateClause. Attaches grounding_live / grounding_total
 * to every derived row. A row that cites at least one source and has ZERO live
 * ones is marked `ungrounded`, its score is multiplied by
 * UNGROUNDED_SCORE_FACTOR, and the list is re-sorted; formatResults then
 * renders it inside an [UNGROUNDED] fence. A derived row with no recorded
 * provenance at all (grounding_total 0) is left alone — absence of evidence is
 * not evidence of invalidation, and penalizing it would fence every legacy
 * reflection and every lesson.
 *
 * Soft and recomputed per query, so defer/restore/re-activate correctness is
 * free. Never touches non-derived rows; never breaks search — failures return
 * the input unchanged.
 */
export declare function _applyGroundingJoin(mesh: MemoryMesh, results: RankedMemory[], opts?: {
    includeArchived?: boolean;
}): Promise<RankedMemory[]>;
/**
 * Parse UNGROUNDED_SCORE_FACTOR (workspace-u2r), the single grounding tunable.
 * It multiplies the score of a derived row whose every cited source is gone,
 * so it must be finite and in (0, 1]: 1 keeps the ranking (the [UNGROUNDED]
 * fence still renders), anything else — unset, empty, NaN, zero, negative,
 * > 1 — falls back to the default so a typo can neither erase nor boost
 * ungrounded rows. Mirrors _parseChannelWeight.
 */
export declare function _parseGroundingFactor(value: string | undefined, dflt: number): number;
/** Wrap a derived memory whose cited sources are all gone (workspace-u2r). */
export declare function fenceUngrounded(content: string): string;
/** Attention-directive line added when at least one rendered memory is ungrounded. */
export declare const UNGROUNDED_DIRECTIVE = "- DO NOT assert entries marked [UNGROUNDED] as fact: every source they were derived from has since been superseded, archived, deferred, or deleted. At most report them as a past belief whose basis is gone.";
export declare function _normalizeScores(_mesh: MemoryMesh, results: RankedMemory[]): RankedMemory[];
/**
 * Tokenize query for keyword matching (private helper for searchSkills)
 * Converts text to lowercase tokens, filtering out short tokens and punctuation.
 * Handles camelCase/PascalCase by splitting on uppercase letters.
 */
export declare function _tokenizeQuery(_mesh: MemoryMesh, text: string): string[];
export declare function formatResults(_mesh: MemoryMesh, results: any[]): string;
/**
 * Parse an RRF channel-weight env value (workspace-2cx). Weights must be
 * finite and strictly positive — anything else (unset, empty, NaN, zero,
 * negative) falls back to the default so a typo can never silence a channel.
 */
export declare function _parseChannelWeight(value: string | undefined, dflt: number): number;
