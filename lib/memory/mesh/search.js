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
export async function search(mesh, query, options = {}) {
    await mesh.init();
    try {
        const limit = options.limit || 10;
        const filter = options.filter || null;
        const mode = options.mode || "hybrid"; // "hybrid" | "vector" | "keyword"
        const useCache = options.useCache !== undefined ? options.useCache : true;
        const includeArchived = options.includeArchived === true;
        const groundingFactor = _parseGroundingFactor(process.env.UNGROUNDED_SCORE_FACTOR, DEFAULT_UNGROUNDED_SCORE_FACTOR);
        // One key shape for lookup AND store in every mode — the store side
        // used to drop includeArchived, which let an includeArchived:true
        // result be served to a default search (and would have dropped the
        // grounding factor the same way).
        const cacheOpts = { limit, filter, mode, includeArchived, groundingFactor };
        if (useCache) {
            const cacheKey = mesh._generateCacheKey(query, cacheOpts);
            const cached = mesh._getCachedResult(cacheKey);
            if (cached) {
                return cached;
            }
        }
        // Post-retrieval ranking joins, in order: graph-RAG boost →
        // contradiction penalty → grounding join. The grounding join runs
        // LAST (workspace-u2r): the cross-encoder rerank happens before any
        // of these, so a derived summary whose sources are all gone could
        // otherwise still win on CE score.
        const rankJoins = async (rows) => mesh._applyGroundingJoin(await mesh._applyContradictionPenalty(await mesh._applyGraphRagBoosting(rows, query)), { includeArchived });
        // Keyword-only mode: skip embedding and vector search entirely
        if (mode === "keyword") {
            const keywordOnly = await mesh._keywordSearch(query, limit, filter, { includeArchived });
            const normalizedKeyword = mesh._normalizeScores(keywordOnly);
            const boosted = await rankJoins(normalizedKeyword);
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
        const activeClause = mesh._activeStateClause({ includeArchived });
        const combinedFilter = filter ? `(${filter}) AND ${activeClause}` : activeClause;
        // NOTE: a dead `metric: "cosine"` option was silently passed here for
        // years — the adapter never consumed it (the index config owns the
        // distance metric). Surfaced by typing the client (workspace-cg2).
        const vectorResults = await mesh.client.search(vector, {
            limit: mode === "vector" ? limit : limit * 2,
            filter: combinedFilter,
        });
        // Vector-only mode: skip keyword search and RRF merge
        if (mode === "vector") {
            const normalizedVector = mesh._normalizeScores(vectorResults.slice(0, limit));
            const boosted = await rankJoins(normalizedVector);
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
        const keywordResults = await mesh._keywordSearch(query, limit * 2, filter, { includeArchived });
        // Reciprocal Rank Fusion — shared implementation (mesh/rrf.ts).
        // Keyword docs are pre-mapped to the minimal RankedMemory shape; the
        // vector list goes first so its richer doc wins when both channels
        // return the same id. (Replaces a hand-rolled partial-selection-sort
        // "optimization" that produced identical ordering at worse complexity.)
        const keywordDocs = keywordResults.map((doc) => ({
            id: doc.id,
            content: doc.content,
            metadata: doc.metadata,
            score: 0,
            created_at: new Date().toISOString(),
        }));
        const rerankLimit = mesh.enableReranker ? Math.max(20, limit * 2) : limit;
        // Channel weights for the hybrid RRF merge (workspace-2cx). Defaults
        // chosen by paired replicate eval (5 runs/config, hybrid−vector within
        // the same seeded mesh): equal weights cost −0.155 MRR vs pure vector
        // on paraphrase-heavy queries and hurt more vector-imperfect queries
        // than they helped (2/5); keyword 0.4 halves the penalty (−0.072
        // ±0.034), flips the rescue record to 6 helped / 1 hurt, and keeps
        // R@5 at 1.0 — the keyword channel stays as the exact-identifier
        // rescue without drowning the semantic signal. Read per call so
        // operators (and the eval harness) can tune without a rebuild.
        const vectorWeight = _parseChannelWeight(process.env.HYBRID_VECTOR_WEIGHT, 1.0);
        const keywordWeight = _parseChannelWeight(process.env.HYBRID_KEYWORD_WEIGHT, 0.4);
        let mergedResults = rrfMerge([
            { items: vectorResults, weight: vectorWeight },
            { items: keywordDocs, weight: keywordWeight },
        ])
            .slice(0, rerankLimit)
            .map(({ doc, rrfScore }) => ({ ...doc, score: rrfScore }));
        // Cross-encoder rerank
        if (mesh.enableReranker && mergedResults.length > 0) {
            try {
                const docContents = mergedResults.map(d => d.content);
                const ceScores = await mesh.embeddingFactory.rerank(query, docContents);
                const sigmoid = (x) => 1 / (1 + Math.exp(-x));
                for (let i = 0; i < mergedResults.length; i++) {
                    mergedResults[i].score = sigmoid(ceScores[i]);
                }
                mergedResults.sort((a, b) => b.score - a.score);
            }
            catch (error) {
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
        const boosted = await rankJoins(normalizedResults);
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
export async function _keywordSearch(mesh, query, limit, filter = null, opts = {}) {
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
    // In-memory BM25 fallback. The index mirrors default-recall visibility
    // for mutations made in THIS process, but it cannot see a supersession,
    // archival or deferral performed by another process (yamo-os daemon vs.
    // CLI), so a fenced row could re-enter recall through here — the gap
    // closed by workspace-u2r. Re-check every hit against the same combined
    // filter the FTS path applies: hits the table knows and rejects are
    // dropped; ids the table has never seen pass through (the index is the
    // only witness for them). Fail closed — if the check itself fails, the
    // keyword channel returns nothing rather than leaking.
    const hits = mesh.keywordSearch.search(query, { limit });
    if (!mesh.client || hits.length === 0) {
        return hits;
    }
    try {
        const ids = hits.map((h) => h.id);
        const activeClause = mesh._activeStateClause(opts);
        const combinedFilter = filter ? `(${filter}) AND ${activeClause}` : activeClause;
        const known = await _idSubsetWhere(mesh, ids, null);
        const visible = await _idSubsetWhere(mesh, ids, combinedFilter);
        return hits.filter((h) => !known.has(h.id) || visible.has(h.id));
    }
    catch (error) {
        if (process.env.YAMO_DEBUG === "true") {
            logger.warn({ err: error }, "Keyword fallback visibility check failed — dropping keyword hits rather than leaking fenced rows");
        }
        return [];
    }
}
/**
 * Subset of `ids` whose memory row matches `id IN (...)` plus an optional
 * extra clause (workspace-u2r). Chunked so the IN-list stays bounded; ids are
 * single-quote-escaped like every other interpolated id in this codebase.
 * Projects only the id column when the table supports select(), falling back
 * to the client's full-row read otherwise (same pattern as orphanEdges).
 */
export async function _idSubsetWhere(mesh, ids, clause) {
    const out = new Set();
    if (!mesh.client || ids.length === 0) {
        return out;
    }
    const CHUNK = 500;
    for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const inList = chunk.map((id) => `'${id.replace(/'/g, "''")}'`).join(", ");
        const where = clause ? `id IN (${inList}) AND (${clause})` : `id IN (${inList})`;
        let rows = null;
        const table = mesh.client.table;
        if (table) {
            try {
                rows = await table.query().where(where).select(["id"]).limit(chunk.length).toArray();
            }
            catch {
                rows = null;
            }
        }
        if (rows === null) {
            rows = await mesh.client.getWhere(where, { limit: chunk.length });
        }
        for (const r of rows) {
            out.add(r.id);
        }
    }
    return out;
}
/** Default multiplier applied to the score of an ungrounded derived row. */
export const DEFAULT_UNGROUNDED_SCORE_FACTOR = 0.25;
/**
 * Derived (synthesized) memory types subject to the read-time grounding join
 * (workspace-u2r): consolidations, reflections, RAPTOR summary levels
 * (summary_l1, summary_l2, …) and distilled lessons. Everything else is a
 * primary observation and is never grounding-checked.
 */
export function _isDerivedType(type) {
    if (typeof type !== "string") {
        return false;
    }
    return type === "consolidation" || type === "reflection" || type === "lesson" || type.startsWith("summary_l");
}
/** Decision-edge relations that count as a citation of a premise. */
const PREMISE_RELATIONS = ["depends-on", "justified-by"];
/**
 * Metadata fields consulted, in order, when a derived row has no premise
 * edges: `cited_ids` is the LLM-cited premise list yamo-os writes on
 * consolidations (workspace-5bo); `source_memory_ids` is what reflect() and
 * raptor() record; `source_ids` is batch membership — noise as a grounding
 * signal, kept only as the last resort.
 */
const CITED_METADATA_FIELDS = ["cited_ids", "source_memory_ids", "source_ids"];
function _metadataOf(row) {
    const m = row.metadata;
    if (m && typeof m === "object") {
        return m;
    }
    if (typeof m === "string") {
        try {
            const parsed = JSON.parse(m);
            return parsed && typeof parsed === "object" ? parsed : null;
        }
        catch {
            return null;
        }
    }
    return null;
}
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
export async function _applyGroundingJoin(mesh, results, opts = {}) {
    if (!mesh.client || results.length === 0) {
        return results;
    }
    const derived = results.filter((r) => _isDerivedType(_metadataOf(r)?.type));
    if (derived.length === 0) {
        return results;
    }
    try {
        // 1. Cited sources per derived hit — premise edges win over metadata.
        const cited = new Map();
        if (mesh.decisionEdgeTable) {
            const inList = derived.map((r) => `'${r.id.replace(/'/g, "''")}'`).join(", ");
            const relList = PREMISE_RELATIONS.map((r) => `'${r}'`).join(", ");
            const edges = await mesh.decisionEdgeTable
                .query()
                .where(`source_id IN (${inList}) AND relation IN (${relList})`)
                .toArray();
            for (const e of edges) {
                if (typeof e.target_id !== "string" || e.target_id === e.source_id)
                    continue;
                const set = cited.get(e.source_id) ?? new Set();
                set.add(e.target_id);
                cited.set(e.source_id, set);
            }
        }
        for (const r of derived) {
            if (cited.has(r.id))
                continue;
            const meta = _metadataOf(r);
            for (const field of CITED_METADATA_FIELDS) {
                const ids = mesh._coerceIdList(meta?.[field]).filter((id) => id !== r.id);
                if (ids.length > 0) {
                    cited.set(r.id, new Set(ids));
                    break;
                }
            }
        }
        // 2. Which cited ids are visible to this query right now?
        const allCited = new Set();
        for (const set of cited.values()) {
            for (const id of set)
                allCited.add(id);
        }
        const live = await _idSubsetWhere(mesh, [...allCited], mesh._activeStateClause(opts));
        // 3. Annotate; down-rank the ungrounded.
        const factor = _parseGroundingFactor(process.env.UNGROUNDED_SCORE_FACTOR, DEFAULT_UNGROUNDED_SCORE_FACTOR);
        let changed = false;
        const out = results.map((r) => {
            if (!_isDerivedType(_metadataOf(r)?.type))
                return r;
            const ids = cited.get(r.id) ?? new Set();
            const total = ids.size;
            let liveCount = 0;
            for (const id of ids) {
                if (live.has(id))
                    liveCount++;
            }
            if (total > 0 && liveCount === 0) {
                changed = true;
                return { ...r, grounding_live: 0, grounding_total: total, ungrounded: true, score: (r.score ?? 0) * factor };
            }
            return { ...r, grounding_live: liveCount, grounding_total: total };
        });
        if (changed) {
            out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        }
        return out;
    }
    catch (error) {
        // Fail LOUD and representable: a derived row the join could not check
        // must not look identical to a grounded one (third-state principle),
        // and the failure must not be gated behind a debug flag.
        logger.warn({ err: error }, "Grounding join failed — derived rows returned UNCHECKED (grounding_error)");
        return results.map((r) => (_isDerivedType(_metadataOf(r)?.type) ? { ...r, grounding_error: true } : r));
    }
}
/**
 * Parse UNGROUNDED_SCORE_FACTOR (workspace-u2r), the single grounding tunable.
 * It multiplies the score of a derived row whose every cited source is gone,
 * so it must be finite and in (0, 1]: 1 keeps the ranking (the [UNGROUNDED]
 * fence still renders), anything else — unset, empty, NaN, zero, negative,
 * > 1 — falls back to the default so a typo can neither erase nor boost
 * ungrounded rows. Mirrors _parseChannelWeight.
 */
export function _parseGroundingFactor(value, dflt) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 && n <= 1 ? n : dflt;
}
/** Wrap a derived memory whose cited sources are all gone (workspace-u2r). */
export function fenceUngrounded(content) {
    return `[UNGROUNDED BEGIN]\n${content}\n[UNGROUNDED END]`;
}
/** Attention-directive line added when at least one rendered memory is ungrounded. */
export const UNGROUNDED_DIRECTIVE = "- DO NOT assert entries marked [UNGROUNDED] as fact: every source they were derived from has since been superseded, archived, deferred, or deleted. At most report them as a past belief whose basis is gone.";
export function _normalizeScores(_mesh, results) {
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
export function _tokenizeQuery(_mesh, text) {
    return text
        .replace(/([a-z])([A-Z])/g, "$1 $2") // Split camelCase: "targetSkill" → "target Skill"
        .toLowerCase()
        .replace(/[^\w\s]/g, "")
        .split(/\s+/)
        .filter((t) => t.length > 2); // Filter out very short tokens
}
export function formatResults(_mesh, results) {
    if (results.length === 0) {
        return "No relevant memories found.";
    }
    // First pass: classify each memory's risk so we know whether to
    // prepend the [SECURITY NOTICE] preamble. We trust metadata.injection_risk
    // (set at write time) AND re-scan live for defense in depth — a memory
    // may have been written before the scanner existed, or by a different
    // ingest path that bypassed it.
    const renderable = results.map((res) => {
        const metadata = typeof res.metadata === "string"
            ? JSON.parse(res.metadata)
            : res.metadata;
        const writeTimeRisk = metadata?.injection_risk;
        const liveScan = scanForInjection(res.content || '');
        const flagged = writeTimeRisk === 'high' || writeTimeRisk === 'low' || liveScan.score > 0;
        // Grounding fence (workspace-u2r): set by _applyGroundingJoin on a
        // derived row whose every cited source is gone.
        const ungrounded = res.ungrounded === true;
        return { res, metadata, flagged, ungrounded };
    });
    const anyFlagged = renderable.some((r) => r.flagged);
    const anyUngrounded = renderable.some((r) => r.ungrounded);
    let output = '';
    if (anyFlagged) {
        output += UNTRUSTED_PREAMBLE + '\n';
    }
    output += `[ATTENTION DIRECTIVE]\nThe following [MEMORY CONTEXT] is weighted by relevance.
- ALIGN attention to entries with [IMPORTANCE >= 0.8].
- TREAT entries with [IMPORTANCE <= 0.4] as auxiliary background info.`;
    if (anyUngrounded) {
        output += `\n${UNGROUNDED_DIRECTIVE}`;
    }
    output += `\n\n[MEMORY CONTEXT]`;
    renderable.forEach(({ res, metadata, flagged, ungrounded }, i) => {
        let body = flagged ? fenceUntrusted(res.content) : res.content;
        if (ungrounded) {
            body = fenceUngrounded(body);
        }
        const groundingNote = res.grounding_error === true
            ? ' | Grounding: UNCHECKED (join failed)'
            : typeof res.grounding_total === 'number' && res.grounding_total > 0
                ? ` | Grounding: ${res.grounding_live ?? 0}/${res.grounding_total} cited sources live`
                : '';
        const marker = ungrounded ? ' [UNGROUNDED]' : '';
        output += `\n\n--- MEMORY ${i + 1}: ${res.id} [IMPORTANCE: ${res.score}]${marker} ---\nType: ${metadata.type || "event"} | Source: ${metadata.source || "unknown"}${groundingNote}\n${body}`;
    });
    return output;
}
/**
 * Parse an RRF channel-weight env value (workspace-2cx). Weights must be
 * finite and strictly positive — anything else (unset, empty, NaN, zero,
 * negative) falls back to the default so a typo can never silence a channel.
 */
export function _parseChannelWeight(value, dflt) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : dflt;
}
