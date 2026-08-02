/**
 * Search subsystem — extracted from the MemoryMesh god-class (workspace-cg2).
 * Hybrid vector + keyword retrieval with shared RRF fusion (mesh/rrf.ts),
 * cross-encoder reranking, graph-RAG boosting and contradiction penalty via
 * their seam modules, plus keyword fallback, score normalization, and the
 * injection-fenced output formatter. Functions take the mesh facade as their
 * first argument; MemoryMesh delegates 1:1.
 */
import { createLogger } from "../../utils/logger.js";
import { rrfMerge } from "./rrf.js";
import { YamoEmitter } from "../../yamo/emitter.js";
import { scanForInjection, fenceUntrusted, UNTRUSTED_PREAMBLE } from "../../utils/prompt-security.js";
import type { MemoryMesh, RankedMemory } from "../memory-mesh.js";

const logger = createLogger("brain");

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
export async function search(mesh: MemoryMesh, query: string, options: { limit?: number; filter?: any; mode?: string; useCache?: boolean; includeArchived?: boolean } = {}): Promise<RankedMemory[]> {
    await mesh.init();
    try {
        const limit = options.limit || 10;
        const filter = options.filter || null;
        const mode = options.mode || "hybrid"; // "hybrid" | "vector" | "keyword"
        const useCache = options.useCache !== undefined ? options.useCache : true;
        const cacheOpts = { limit, filter, mode, includeArchived: options.includeArchived === true };
        if (useCache) {
            const cacheKey = mesh._generateCacheKey(query, cacheOpts);
            const cached = mesh._getCachedResult(cacheKey);
            if (cached) {
                return cached;
            }
        }

        // Keyword-only mode: skip embedding and vector search entirely
        if (mode === "keyword") {
            const keywordOnly = await mesh._keywordSearch(query, limit, filter, { includeArchived: options.includeArchived === true });
            const normalizedKeyword = mesh._normalizeScores(keywordOnly);
            const boosted = await mesh._applyContradictionPenalty(await mesh._applyGraphRagBoosting(normalizedKeyword, query));
            if (useCache) {
                const cacheKey = mesh._generateCacheKey(query, { limit, filter, mode });
                mesh._cacheResult(cacheKey, boosted);
            }
            if (mesh.enableYamo) {
                mesh._emitYamoBlock("recall", undefined, YamoEmitter.buildRecallBlock({
                    query,
                    resultCount: boosted.length,
                    limit,
                    agentId: mesh.agentId,
                    searchType: "keyword",
                })).catch((error) => {
                    if (process.env.YAMO_DEBUG === "true") {
                        logger.warn({ err: error }, "Failed to emit YAMO block (recall)");
                    }
                });
            }
            return boosted;
        }

        const vector = await mesh.embeddingFactory.embed(query, { isQuery: true });
        if (!mesh.client) {
            throw new Error("Database client not initialized");
        }
        const activeClause = mesh._activeStateClause({ includeArchived: options.includeArchived === true });
        const combinedFilter = filter ? `(${filter}) AND ${activeClause}` : activeClause;
        const vectorResults = await mesh.client.search(vector, {
            limit: mode === "vector" ? limit : limit * 2,
            metric: "cosine",
            filter: combinedFilter,
        });

        // Vector-only mode: skip keyword search and RRF merge
        if (mode === "vector") {
            const normalizedVector = mesh._normalizeScores(vectorResults.slice(0, limit));
            const boosted = await mesh._applyContradictionPenalty(await mesh._applyGraphRagBoosting(normalizedVector, query));
            if (useCache) {
                const cacheKey = mesh._generateCacheKey(query, { limit, filter, mode });
                mesh._cacheResult(cacheKey, boosted);
            }
            if (mesh.enableYamo) {
                mesh._emitYamoBlock("recall", undefined, YamoEmitter.buildRecallBlock({
                    query,
                    resultCount: boosted.length,
                    limit,
                    agentId: mesh.agentId,
                    searchType: "vector",
                })).catch((error) => {
                    if (process.env.YAMO_DEBUG === "true") {
                        logger.warn({ err: error }, "Failed to emit YAMO block (recall)");
                    }
                });
            }
            return boosted;
        }

        // Hybrid mode (default): vector + keyword with RRF merge
        const keywordResults = await mesh._keywordSearch(query, limit * 2, filter, { includeArchived: options.includeArchived === true });
        // Reciprocal Rank Fusion — shared implementation (mesh/rrf.ts).
        // Keyword docs are pre-mapped to the minimal RankedMemory shape; the
        // vector list goes first so its richer doc wins when both channels
        // return the same id. (Replaces a hand-rolled partial-selection-sort
        // "optimization" that produced identical ordering at worse complexity.)
        const keywordDocs: RankedMemory[] = keywordResults.map((doc) => ({
            id: doc.id,
            content: doc.content,
            metadata: doc.metadata,
            score: 0,
            created_at: new Date().toISOString(),
        }));
        const rerankLimit = mesh.enableReranker ? Math.max(20, limit * 2) : limit;
        let mergedResults: RankedMemory[] = rrfMerge([
            { items: vectorResults },
            { items: keywordDocs },
        ])
            .slice(0, rerankLimit)
            .map(({ doc, rrfScore }) => ({ ...doc, score: rrfScore }));

        // Cross-encoder rerank
        if (mesh.enableReranker && mergedResults.length > 0) {
            try {
                const docContents = mergedResults.map(d => d.content);
                const ceScores = await mesh.embeddingFactory.rerank(query, docContents);
                const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
                for (let i = 0; i < mergedResults.length; i++) {
                    mergedResults[i].score = sigmoid(ceScores[i]);
                }
                mergedResults.sort((a, b) => b.score - a.score);
            } catch (error) {
                if (process.env.YAMO_DEBUG === "true") {
                    logger.warn({ err: error }, "Cross-encoder reranking failed, falling back to RRF scores");
                }
            }
            mergedResults = mergedResults.slice(0, limit);
        }

        // Hybrid results already have meaningful RRF scores — normalize them
        // to [0, 1] instead of re-deriving from _distance (which may not
        // exist on keyword-only results, causing uniform 0.50 scores).
        const maxRRF = mergedResults.reduce((mx, r) => Math.max(mx, r.score || 0), 0) || 1;
        const normalizedResults = mergedResults.map((r) => ({
            ...r,
            score: parseFloat((r.score / maxRRF).toFixed(2)),
        }));
        
        const boosted = await mesh._applyContradictionPenalty(await mesh._applyGraphRagBoosting(normalizedResults, query));

        if (useCache) {
            const cacheKey = mesh._generateCacheKey(query, cacheOpts);
            mesh._cacheResult(cacheKey, boosted);
        }
        if (mesh.enableYamo) {
            mesh._emitYamoBlock("recall", undefined, YamoEmitter.buildRecallBlock({
                query,
                resultCount: boosted.length,
                limit,
                agentId: mesh.agentId,
                searchType: "hybrid",
            })).catch((error) => {
                // Log emission failures in debug mode but don't throw
                if (process.env.YAMO_DEBUG === "true") {
                    logger.warn({ err: error }, "Failed to emit YAMO block (recall)");
                }
            });
        }
        return boosted;
    }
    catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
    }
}

export async function _keywordSearch(mesh: MemoryMesh, query: string, limit: number, filter: any = null, opts: { includeArchived?: boolean } = {}): Promise<RankedMemory[]> {
    if (mesh.client) {
        try {
            const activeClause = mesh._activeStateClause(opts);
            const combinedFilter = filter ? `(${filter}) AND ${activeClause}` : activeClause;
            const results = await mesh.client.searchFts(query, {
                limit,
                filter: combinedFilter,
            });
            return results;
        }
        catch (error) {
            if (process.env.YAMO_DEBUG === "true") {
                logger.warn({ err: error }, "LanceDB Native FTS search failed, falling back to in-memory TF-IDF");
            }
        }
    }
    return mesh.keywordSearch.search(query, { limit });
}

export function _normalizeScores(mesh: MemoryMesh, results: RankedMemory[]): RankedMemory[] {
    if (results.length === 0) {
        return [];
    }
    const hasDistance = results.some((r) => r._distance !== undefined);
    if (!hasDistance) {
        const maxScore = results.reduce((mx, r) => Math.max(mx, r.score || 0), 0) || 1;
        return results.map((r) => ({
            ...r,
            score: parseFloat(((r.score || 0) / maxScore).toFixed(2)),
        }));
    }
    return results.map((r) => {
        // LanceDB _distance is squared L2 or cosine distance
        // For cosine distance in MiniLM, it ranges from 0 to 2
        const rawDistance = r._distance !== undefined ? r._distance : 1.0;
        // Convert to similarity score [0, 1]
        const score = Math.max(0, Math.min(1.0, 1 - rawDistance / 2));
        return {
            ...r,
            score: parseFloat(score.toFixed(2)),
        };
    });
}
/**
 * Tokenize query for keyword matching (private helper for searchSkills)
 * Converts text to lowercase tokens, filtering out short tokens and punctuation.
 * Handles camelCase/PascalCase by splitting on uppercase letters.
 */

export function _tokenizeQuery(mesh: MemoryMesh, text: string) {
    return text
        .replace(/([a-z])([A-Z])/g, "$1 $2") // Split camelCase: "targetSkill" → "target Skill"
        .toLowerCase()
        .replace(/[^\w\s]/g, "")
        .split(/\s+/)
        .filter((t) => t.length > 2); // Filter out very short tokens
}

export function formatResults(mesh: MemoryMesh, results: any[]) {
    if (results.length === 0) {
        return "No relevant memories found.";
    }
    // First pass: classify each memory's risk so we know whether to
    // prepend the [SECURITY NOTICE] preamble. We trust metadata.injection_risk
    // (set at write time) AND re-scan live for defense in depth — a memory
    // may have been written before the scanner existed, or by a different
    // ingest path that bypassed it.
    const renderable = results.map((res: any) => {
        const metadata = typeof res.metadata === "string"
            ? JSON.parse(res.metadata)
            : res.metadata;
        const writeTimeRisk = metadata?.injection_risk;
        const liveScan = scanForInjection(res.content || '');
        const flagged = writeTimeRisk === 'high' || writeTimeRisk === 'low' || liveScan.score > 0;
        return { res, metadata, flagged };
    });
    const anyFlagged = renderable.some((r) => r.flagged);
    let output = '';
    if (anyFlagged) {
        output += UNTRUSTED_PREAMBLE + '\n';
    }
    output += `[ATTENTION DIRECTIVE]\nThe following [MEMORY CONTEXT] is weighted by relevance.
- ALIGN attention to entries with [IMPORTANCE >= 0.8].
- TREAT entries with [IMPORTANCE <= 0.4] as auxiliary background info.

[MEMORY CONTEXT]`;
    renderable.forEach(({ res, metadata, flagged }: any, i: number) => {
        const body = flagged ? fenceUntrusted(res.content) : res.content;
        output += `\n\n--- MEMORY ${i + 1}: ${res.id} [IMPORTANCE: ${res.score}] ---\nType: ${metadata.type || "event"} | Source: ${metadata.source || "unknown"}\n${body}`;
    });
    return output;
}
