import { MemoryRecord } from "./adapters/client.js";
import { MemoryState } from "./schema.js";
import EmbeddingFactory from "./embeddings/factory.js";
import { Scrubber } from "../scrubber/scrubber.js";
import { KeywordSearch } from "./search/keyword-search.js";
import { LLMClient } from "../llm/client.js";
/** RFC-0012 S-MORA types */
export interface SMORAOptions {
    limit?: number;
    retrievalLimit?: number;
    sessionIntent?: string[];
    enableSynthesis?: boolean;
    enableHyDE?: boolean;
    useCache?: boolean;
}
export interface SMORAResult {
    id: string;
    content: string;
    metadata: Record<string, unknown>;
    score: number;
    semanticScore: number;
    heritageBonus: number;
    recencyDecay: number;
    rrfRank: number;
}
export interface SMORAResponse {
    results: SMORAResult[];
    synthesis?: string;
    pipeline: {
        queryExpanded: boolean;
        heritageAware: boolean;
        synthesized: boolean;
        latencyMs: number;
    };
}
/** Public projection of a stored row returned by get() — omits vector and superseded_at. */
type StoredMemory = Pick<MemoryRecord, "id" | "content" | "metadata" | "created_at" | "updated_at">;
/**
 * A result flowing through the search() retrieval pipeline (vector + keyword + RRF
 * merge + graph-RAG boost). Shapes are heterogeneous by source — vector results carry
 * `vector`/`superseded_at`, keyword results carry `matches` and spread doc fields — so
 * only `id` and `score` are guaranteed; the rest are optional.
 */
interface RankedMemory {
    id: string;
    score: number;
    content?: string;
    metadata?: Record<string, any> | null;
    vector?: number[];
    matches?: string[];
    created_at?: any;
    updated_at?: any;
    superseded_at?: any;
    _distance?: number;
    /** Set by _applyContradictionPenalty: ids of newer validated memories that contradict this one. */
    contradicted_by?: string[];
}
interface MemoryMeshOptions {
    enableYamo?: boolean;
    enableLLM?: boolean;
    enableMemory?: boolean;
    enableSemanticInjection?: boolean;
    enableReranker?: boolean;
    enableAgenticOps?: boolean;
    agentId?: string;
    skill_directories?: string | string[];
    llmProvider?: string;
    llmApiKey?: string;
    llmModel?: string;
    llmMaxTokens?: number;
    dbDir?: string;
}
/**
 * A skill ingest whose LanceDB write has been deferred (AGP Phase 3b staging).
 * Holds the fully-built `synthesized_skills` row so a caller (e.g. the kernel's
 * CommitOperator) can flush it via {@link MemoryMesh.commitPendingIngest} after κ
 * approval, or simply discard it on rejection.
 */
export interface PendingSkillIngest {
    record: Record<string, any>;
}
/**
 * MemoryMesh class for managing vector memory storage
 */
export declare class MemoryMesh {
    client: any;
    config: any;
    embeddingFactory: EmbeddingFactory;
    keywordSearch: KeywordSearch;
    isInitialized: boolean;
    vectorDimension: number;
    enableYamo: boolean;
    enableLLM: boolean;
    enableMemory: boolean;
    enableReranker: boolean;
    enableAgenticOps: boolean;
    _kernel_execute: any;
    agentId: string;
    yamoTable: any;
    skillTable: any;
    graphTable: any;
    decisionEdgeTable: any;
    revisionTable: any;
    llmClient: LLMClient | null;
    scrubber: Scrubber;
    queryCache: Map<string, {
        result: RankedMemory[];
        timestamp: number;
    }>;
    cacheConfig: {
        maxSize: number;
        ttlMs: number;
    };
    hydeCache: Map<any, any>;
    intentEmbedCache: Map<any, any>;
    skillDirectories: string[];
    _stagingLock: Promise<unknown>;
    dbDir: string | undefined;
    semanticInjection: boolean;
    /**
     * Create a new MemoryMesh instance
     * @param {Object} [options={}]
     */
    constructor(options?: MemoryMeshOptions);
    /**
     * Generate a cache key from query and options
     * @private
     */
    _generateCacheKey(query: string, options?: {
        limit?: number;
        filter?: any;
        mode?: string;
        includeArchived?: boolean;
    }): string;
    /**
     * Get cached result if valid
     * @private
     *
     * Race condition fix: The delete-then-set pattern for LRU tracking creates a window
     * where another operation could observe the key as missing. We use a try-finally
     * pattern to ensure atomicity at the application level.
     */
    _getCachedResult(key: string): RankedMemory[] | null;
    /**
     * Cache a search result
     * @private
     */
    _cacheResult(key: string, result: RankedMemory[]): void;
    /**
     * Clear all cached results
     */
    clearCache(): void;
    /**
     * Get cache statistics
     */
    getCacheStats(): {
        size: number;
        maxSize: number;
        ttlMs: number;
    };
    /**
     * Validate and sanitize metadata to prevent prototype pollution
     * @private
     */
    _validateMetadata(metadata: any): Record<string, any>;
    /**
     * Sanitize and validate content before storage
     * @private
     */
    _sanitizeContent(content: string): string;
    /**
     * Initialize the LanceDB client
     */
    init(): Promise<void>;
    /**
     * Add content to memory with auto-generated embedding and scrubbing.
     *
     * This is the primary method for storing information in the memory mesh.
     * The content goes through several processing steps:
     *
     * 1. **Scrubbing**: PII and sensitive data are sanitized (if enabled)
     * 2. **Validation**: Content length and metadata are validated
     * 3. **Embedding**: Content is converted to a vector representation
     * 4. **Storage**: Record is stored in LanceDB with metadata
     * 5. **Emission**: Optional YAMO block emitted for provenance tracking
     *
     * @param content - The text content to store in memory
     * @param metadata - Optional metadata (type, source, tags, etc.)
     * @returns Promise with memory record containing id, content, metadata, created_at
     *
     * @example
     * ```typescript
     * const memory = await mesh.add("User likes TypeScript", {
     *   type: "preference",
     *   source: "chat",
     *   tags: ["programming", "languages"]
     * });
     * ```
     *
     * @throws {Error} If content exceeds max length (100KB)
     * @throws {Error} If embedding generation fails
     * @throws {Error} If database client is not initialized
     */
    add(content: string, metadata?: Record<string, any>): Promise<{
        id: any;
        content: string;
        metadata: Record<string, any>;
        created_at: string;
    }>;
    /**
     * Semantic alias for add().
     * @param content - The text content to store
     * @param metadata - Optional metadata
     * @returns Promise with memory record
     */
    ingest(content: string, metadata?: any): Promise<{
        id: any;
        content: string;
        metadata: Record<string, any>;
        created_at: string;
    }>;
    /**
     * Reflect on recent memories
     */
    reflect(options?: {
        lookback?: number;
        topic?: string;
        generate?: boolean;
    }): Promise<{
        topic: string | undefined;
        count: any;
        context: any;
        prompt: string;
        id?: undefined;
        reflection?: undefined;
        confidence?: undefined;
        sourceMemoryCount?: undefined;
        yamoBlock?: undefined;
        createdAt?: undefined;
    } | {
        id: string;
        topic: string;
        reflection: string;
        confidence: number;
        sourceMemoryCount: any;
        yamoBlock: string | null;
        createdAt: string;
        count?: undefined;
        context?: undefined;
        prompt?: undefined;
    }>;
    /**
     * Multi-chunk document ingest with Late Chunking (Jina, Sep 2024).
     *
     * Splits the document into chunks (paragraph-based for now — preserves
     * char offsets cleanly), embeds them with full-document context via
     * embedLateChunked() when the underlying model supports token-level
     * extraction, falls back to per-chunk embedding otherwise. Each chunk
     * lands as its own memory with provenance metadata linking back to the
     * parent document.
     *
     * Single-shot store path mesh.add() is unchanged — call addDocument()
     * explicitly when you want chunk-level retrieval granularity.
     *
     * Options:
     *   - minChunkChars / maxChunkChars: paragraph-merging bounds
     *     (defaults: 200 / 2000)
     *   - lateChunk: force on/off (default: auto — use Late Chunking if
     *     the embedder supports it and there's more than one chunk)
     */
    addDocument(content: string, metadata?: Record<string, unknown>, options?: {
        minChunkChars?: number;
        maxChunkChars?: number;
        lateChunk?: boolean;
    }): Promise<{
        documentId: string;
        chunks: number;
        ids: string[];
        lateChunked: boolean;
    }>;
    /**
     * Split a document into paragraph-based spans of (start, end) char
     * offsets, merging short paragraphs to honor minChars and forcing breaks
     * when exceeding maxChars. Spans are non-overlapping, ordered, and cover
     * the full content.
     * @private
     */
    _splitParagraphSpans(content: string, minChars: number, maxChars: number): Array<{
        start: number;
        end: number;
    }>;
    /**
     * RAPTOR-style hierarchical summarization (Sarthi et al. 2024).
     *
     * Recursively clusters memories by embedding similarity, summarizes each
     * cluster with the LLM, ingests summaries as a new memory layer, and
     * repeats with the summary layer as input. Tree levels are tagged via
     * metadata.type=summary_l1/l2/... and metadata.source_memory_ids links
     * each summary back to the memories it covers. All summaries land in
     * the same vector index, so search() naturally returns them alongside
     * leaves — a query that matches the summary level retrieves an
     * abstracted answer; a query that matches a leaf retrieves the
     * concrete fact.
     *
     * Returns the per-level breakdown and the root summary id (if a single
     * root emerged). No-op (returns zeros) when the LLM is disabled or no
     * memories satisfy the topic/limit.
     */
    raptor(options?: {
        topic?: string;
        limit?: number;
        maxLevels?: number;
        branchingFactor?: number;
        minClusterSize?: number;
    }): Promise<{
        levelsBuilt: number;
        summariesCreated: number;
        perLevel: Array<{
            level: number;
            clusters: number;
            summaries: number;
        }>;
        treeRootId?: string;
    }>;
    /**
     * K-means clustering with cosine distance. Vectors are assumed L2-normalized
     * (which they are — embedding service normalizes on output), so cosine
     * similarity is the dot product and centroids stay on the unit hypersphere
     * after mean + renormalize. Random-init centroids; k-means++ would be
     * better for stability but is overkill for this use case.
     * @private
     */
    _kmeansClusters<T extends {
        vector: number[];
    }>(items: T[], k: number, maxIters?: number): T[][];
    /**
     * LLM-summarize a cluster of memories and store the summary as a memory
     * with type=summary_l{level} and source_memory_ids linking back to leaves.
     * skipDedup is set so the summary doesn't get collapsed against the very
     * memories it summarizes.
     * @private
     */
    _summarizeCluster(cluster: Array<{
        id: string;
        content: string;
        vector?: number[];
    }>, level: number): Promise<{
        id: string;
        content: string;
        vector: number[];
    } | null>;
    /**
     * Ingest synthesized skill
     * @param sourceFilePath - If provided, skip file write (file already exists)
     */
    ingestSkill(yamoText: string, metadata?: Record<string, any>, sourceFilePath?: string, opts?: {
        stage?: boolean;
    }): Promise<{
        id: string;
        name: any;
        intent: any;
        pendingIngest: {
            record: {
                id: string;
                name: any;
                intent: any;
                yamo_text: string;
                vector: any;
                metadata: string;
                created_at: Date;
            };
        };
    } | {
        id: string;
        name: any;
        intent: any;
        pendingIngest?: undefined;
    }>;
    /**
     * Flush a {@link PendingSkillIngest} produced by `synthesize({ ingest: "stage" })`
     * into the `synthesized_skills` table (AGP Phase 3b κ-commit). Pass `finalSourceFile`
     * when the staged skill file has been moved to its live location so the indexed
     * row's `source_file` points at the committed path rather than the staging path.
     */
    commitPendingIngest(pending: PendingSkillIngest, opts?: {
        finalSourceFile?: string;
    }): Promise<{
        id: any;
        name: any;
        intent: any;
    }>;
    /**
     * Serialize the skillDirectories[0] hot-swap window for staged synthesis so two
     * concurrent staged synthesize() calls can't read each other's redirected path.
     * Returns a release function the caller MUST invoke in a `finally`.
     */
    _acquireStagingLock(): Promise<() => void>;
    /**
     * Recursive Skill Synthesis
     */
    synthesize(options?: {
        topic?: string;
        enrichedPrompt?: string;
        mode?: string;
        targetSkillId?: string;
        lookback?: number;
        stagingSkillDir?: string;
        ingest?: "commit" | "stage";
    }): Promise<{
        status: string;
        analysis: string;
        skill_id: string;
        skill_name: any;
        yamo_text: string;
        stagingPath: never;
        pendingIngest: {
            record: {
                id: string;
                name: any;
                intent: any;
                yamo_text: string;
                vector: any;
                metadata: string;
                created_at: Date;
            };
        } | undefined;
        error?: undefined;
    } | {
        status: string;
        analysis: string;
        skill_id: string;
        skill_name: any;
        yamo_text: string;
        stagingPath?: undefined;
        pendingIngest?: undefined;
        error?: undefined;
    } | {
        status: string;
        analysis: string;
        skill_name: string;
        skill_id?: undefined;
        yamo_text?: undefined;
        stagingPath?: undefined;
        pendingIngest?: undefined;
        error?: undefined;
    } | {
        status: string;
        error: string;
        analysis: string;
        skill_id?: undefined;
        skill_name?: undefined;
        yamo_text?: undefined;
        stagingPath?: undefined;
        pendingIngest?: undefined;
    } | {
        status: string;
        analysis: string;
        skill_id?: undefined;
        skill_name?: undefined;
        yamo_text?: undefined;
        stagingPath?: undefined;
        pendingIngest?: undefined;
        error?: undefined;
    }>;
    /**
     * Update reliability
     */
    updateSkillReliability(id: string, success: boolean): Promise<{
        id: string;
        reliability: any;
        use_count: any;
    }>;
    /**
     * Get a single synthesized skill by ID
     * @param {string} id - Skill ID
     * @returns {Promise<Object|null>} Skill data or null if not found
     */
    getSkill(id: string): Promise<any>;
    /**
     * Prune skills
     */
    pruneSkills(threshold?: number): Promise<{
        pruned_count: number;
        total_remaining: number;
    }>;
    /**
     * List all synthesized skills
     * @param {Object} [options={}] - Search options
     * @returns {Promise<Array>} Normalized skill results
     */
    listSkills(options?: {
        limit?: number;
    }): Promise<any>;
    /**
     * Search for synthesized skills by semantic intent
     * @param {string} query - Search query (intent description)
     * @param {Object} [options={}] - Search options
     * @returns {Promise<Array>} Normalized skill results
     */
    searchSkills(query: string, options?: {
        limit?: number;
    }): Promise<any>;
    /**
     * Get recent YAMO logs for the heartbeat
     * @param {Object} options
     */
    getYamoLog(options?: {
        limit?: number;
    }): Promise<any>;
    /** @private Quarantine a corrupt yamo_blocks table — see mesh/yamo-audit.ts. */
    _quarantineYamoTable(cause: any): Promise<void>;
    /** @private Emit a YAMO audit block (non-critical, never throws) — see mesh/yamo-audit.ts. */
    _emitYamoBlock(operationType: string, memoryId: string | undefined, yamoText: string, heritage?: {
        intentChain: string[];
        hypotheses: string[];
        rationales: string[];
    }): Promise<void>;
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
    search(query: string, options?: {
        limit?: number;
        filter?: any;
        mode?: string;
        useCache?: boolean;
        includeArchived?: boolean;
    }): Promise<RankedMemory[]>;
    _applyGraphRagBoosting(results: RankedMemory[], query: string): Promise<RankedMemory[]>;
    _keywordSearch(query: string, limit: number, filter?: any, opts?: {
        includeArchived?: boolean;
    }): Promise<RankedMemory[]>;
    _normalizeScores(results: RankedMemory[]): RankedMemory[];
    /**
     * Tokenize query for keyword matching (private helper for searchSkills)
     * Converts text to lowercase tokens, filtering out short tokens and punctuation.
     * Handles camelCase/PascalCase by splitting on uppercase letters.
     */
    _tokenizeQuery(text: string): string[];
    formatResults(results: any[]): string;
    get(id: string): Promise<StoredMemory | null>;
    /**
     * Delete a memory entry by ID.
     */
    delete(id: string): Promise<void>;
    /**
     * SQL clause selecting rows visible to default recall (workspace-g9p.5):
     * not superseded, not archived (unless opted in), and not deferred to a
     * future date. Legacy rows with NULL state read as 'active'.
     */
    _activeStateClause(opts?: {
        includeArchived?: boolean;
    }): string;
    /**
     * Coerce a caller-supplied defer_until (Date | ISO string | epoch ms) to a
     * Date, or null when absent/invalid.
     */
    _coerceDeferUntil(value: unknown): Date | null;
    /**
     * Set a memory's lifecycle state (workspace-g9p.5). Vocabulary is
     * MEMORY_STATES: active | superseded | deprecated | archived.
     *
     * Archiving removes the row from the in-memory keyword index (it stays in
     * the DB and remains reachable via search({ includeArchived: true }));
     * re-activating restores it. Returns { id, state, previous }.
     */
    setState(id: string, state: MemoryState): Promise<{
        id: string;
        state: MemoryState;
        previous: string | null;
    }>;
    /**
     * Defer a memory until a future date (workspace-g9p.5) — the bd defer
     * analog. The row is suppressed from default recall until `until`, then
     * resurfaces automatically (prime() lists newly-due rows under `due`).
     * Pass null to clear an existing deferral.
     */
    deferMemory(id: string, until: Date | string | number | null): Promise<{
        id: string;
        defer_until: string | null;
    }>;
    /**
     * Append revision rows for an in-place mutation (workspace-g9p.3).
     *
     * Fire-and-forget by design — history must never add latency or failure
     * modes to the mutation hot path (same contract as _writeDecisionEdges).
     * Values are JSON-encoded; null means "absent".
     */
    _recordRevision(memoryId: string, changes: Array<{
        field: string;
        oldValue: unknown;
        newValue: unknown;
    }>, actor?: string): void;
    /**
     * Ordered mutation history for a memory or skill id (workspace-g9p.3) —
     * the bd history analog. Returns oldest-first revision rows with decoded
     * old/new values.
     */
    history(memoryId: string): Promise<Array<{
        id: string;
        memory_id: string;
        field: string;
        old_value: unknown;
        new_value: unknown;
        actor: string | null;
        created_at: string;
    }>>;
    /**
     * Restore a deleted memory from its 'deleted' revision (workspace-g9p.3) —
     * the bd restore analog. Re-embeds the captured content and re-inserts the
     * row under its original id.
     */
    restoreDeleted(id: string): Promise<{
        id: string;
        content: string;
    } | null>;
    /**
     * Resolve a memory by id, falling back to newest active row carrying
     * metadata.key == idOrKey. Used by pin()/unpin() so curated memories can
     * be addressed by their stable key (the bd remember --key analog).
     */
    _resolveIdOrKey(idOrKey: string): Promise<MemoryRecord | null>;
    /**
     * Pin a memory so prime() always surfaces it verbatim (workspace-g9p.1).
     * Accepts a memory id or a stable metadata.key.
     */
    pin(idOrKey: string): Promise<{
        id: string;
        pinned: boolean;
    }>;
    /**
     * Unpin a memory (workspace-g9p.1). Accepts a memory id or metadata.key.
     */
    unpin(idOrKey: string): Promise<{
        id: string;
        pinned: boolean;
    }>;
    _setPinned(idOrKey: string, pinned: boolean): Promise<{
        id: string;
        pinned: boolean;
    }>;
    /**
     * Push-based curated recall (workspace-g9p.1) — the bd prime analog.
     *
     * Returns three sections:
     *   pinned     — ALL pinned, non-superseded, non-archived memories,
     *                verbatim, regardless of any query similarity. Guaranteed
     *                surfacing is the whole point: probabilistic recall is the
     *                wrong tool for "never do X again" facts.
     *   due        — deferred memories whose defer_until has passed (bd defer
     *                resurfacing). Excludes rows already in pinned.
     *   contextual — top-N relevant unpinned memories for `query` via the
     *                normal search ranking; recent-important actives when no
     *                query is given.
     */
    prime(query?: string, opts?: {
        limit?: number;
    }): Promise<{
        pinned: Array<{
            id: string;
            content: string;
            metadata: Record<string, any> | null;
            created_at: string | null;
        }>;
        due: Array<{
            id: string;
            content: string;
            metadata: Record<string, any> | null;
            defer_until: string | null;
        }>;
        contextual: Array<{
            id: string;
            content: string;
            metadata: Record<string, any> | null;
            score: number;
        }>;
    }>;
    /**
     * Passive human-readable JSONL export (workspace-g9p.2) — the issues.jsonl
     * principle. Vectors are derived data (re-embeddable from content), so the
     * export carries content + metadata only: git-committable, PR-diffable,
     * and sufficient for a full rebuild via importJsonl().
     *
     * Determinism contract: rows are sorted by (table, id), field order is
     * fixed, and no volatile values (export timestamps, floats re-derived at
     * export time) are included — consecutive exports of an unchanged DB are
     * byte-identical.
     */
    exportJsonl(filePath?: string): Promise<{
        path: string | null;
        lines: number;
        text?: string;
    }>;
    /**
     * Import a JSONL export (workspace-g9p.2), re-embedding content locally.
     * Idempotent: rows whose id already exists in the target table are
     * skipped, so import-into-nonempty is safe.
     */
    importJsonl(source: string | {
        text: string;
    }): Promise<Record<string, {
        imported: number;
        skipped: number;
    }>>;
    /**
     * Decision edges whose endpoints resolve to no known memory or skill row
     * (workspace-g9p.6). The DCG direction invariant says targets pre-exist at
     * write time — a dangling endpoint means a deletion broke lineage.
     */
    orphanEdges(opts?: {
        limit?: number;
    }): Promise<Array<{
        id: string;
        source_id: string;
        target_id: string;
        relation: string;
        missing: string[];
    }>>;
    /**
     * Non-mutating stale-memory report (workspace-g9p.6) — the bd stale
     * analog: active rows untouched (no access, no update) for `days`.
     */
    staleMemoriesReport(opts?: {
        days?: number;
        limit?: number;
    }): Promise<Array<{
        id: string;
        content: string;
        last_touch: string | null;
    }>>;
    /**
     * Hygiene self-diagnosis (workspace-g9p.6) — the bd doctor analog. Runs
     * mechanical checks for every known mesh footgun; never mutates. Overall
     * ok is the AND of all non-informational checks.
     */
    doctor(opts?: {
        indexThreshold?: number;
    }): Promise<{
        ok: boolean;
        checks: Array<{
            name: string;
            ok: boolean;
            detail: string;
        }>;
    }>;
    /**
     * Coerce a metadata edge field (string | string[] | undefined) into a
     * clean array of target memory IDs.
     */
    _coerceIdList(value: unknown): string[];
    /**
     * Decide whether a write should emit Decision Context Graph edges. Gated so
     * the common (non-decision) write path does no edge work at all.
     */
    _isDecisionWrite(metadata: any, supersededIds: string[]): boolean;
    /**
     * Write Decision Context Graph edges for a freshly stored memory.
     *
     * source_id is always the new memory; target_id always pre-exists. Edges:
     *   - supersedes   from the belief-revision step (supersededIds)
     *   - depends-on   from metadata.depends_on
     *   - justified-by from metadata.justified_by
     *   - contradicts  from metadata.contradicts
     */
    _writeDecisionEdges(sourceId: string, metadata: any, supersededIds: string[]): Promise<void>;
    /**
     * Traverse the Decision Context Graph from a memory.
     *
     * Distinct from the Graph-RAG boost traversal — this answers reasoning-audit
     * questions over decision_edges, not retrieval scoring.
     *
     *   direction 'ancestors'  (default): follow outgoing edges (source_id ==
     *     node) — "what this decision supersedes / depends on / is justified by".
     *   direction 'dependents': follow incoming edges (target_id == node) —
     *     "this decision was reversed; what still-active decisions rested on it?"
     */
    decisionLineage(memoryId: string, opts?: {
        direction?: "ancestors" | "dependents";
        relations?: string[];
        maxHops?: number;
    }): Promise<Array<{
        from: string;
        to: string;
        relation: string;
        rationale: string | null;
        weight: number;
        hop: number;
    }>>;
    /**
     * Contradiction-aware ranking (workspace-g9p.4) — the retrieval-time
     * analog of bd's "blocked". A result with a `contradicts` edge from a
     * NEWER memory whose outcome is `validated` is down-ranked (score × 0.5)
     * and flagged via `contradicted_by`, so stale beliefs lose ranking
     * contests against what actually replaced them. No-op when the Decision
     * Context Graph is empty; failures never break search.
     */
    _applyContradictionPenalty(results: RankedMemory[]): Promise<RankedMemory[]>;
    /**
     * Stale-beliefs report (workspace-g9p.4) — bd blocked pointed backward at
     * beliefs. For each refuted decision (or the given memoryId), walks
     * decisionLineage(dependents) and surfaces every memory still resting on
     * it, with hop counts.
     */
    staleBeliefs(opts?: {
        memoryId?: string;
        maxHops?: number;
    }): Promise<Array<{
        refuted: {
            id: string;
            content: string | null;
            note: string | null;
        };
        dependents: Array<{
            id: string;
            relation: string;
            hop: number;
            content: string | null;
            state: string | null;
        }>;
    }>>;
    /**
     * Record the observed outcome of a decision, closing the feedback loop.
     *
     * Stores `outcome` in the decision's metadata and resets importance_score by
     * status so retrieval ranking reflects whether the decision actually worked
     * (not merely how often it was read): validated 0.9, mixed 0.5, refuted 0.2.
     */
    recordOutcome(decisionId: string, outcome: {
        status: "validated" | "refuted" | "mixed";
        note?: string;
    }): Promise<void>;
    /**
     * Distill a LessonLearned block (RFC-0011 §3.5).
     * Idempotent: same patternId + equal/higher confidence returns existing.
     */
    distillLesson(context: {
        situation: string;
        errorPattern: string;
        oversight: string;
        fix: string;
        preventativeRule: string;
        severity?: string;
        applicableScope: string;
        inverseLesson?: string;
        confidence?: number;
    }): Promise<{
        lessonId: string;
        patternId: string;
        severity: string;
        preventativeRule: string;
        ruleConfidence: number;
        applicableScope: string;
        wireFormat: string;
        memoryId: string;
    }>;
    /**
     * Query lessons from memory (RFC-0011 §4.1).
     */
    queryLessons(query?: string, options?: {
        limit?: number;
    }): Promise<any[]>;
    /**
     * Update a memory entry's heritage_chain (RFC-0011 §8).
     */
    insertHeritage(memoryId: string, heritage: {
        intentChain: string[];
        hypotheses: string[];
        rationales: string[];
    }): Promise<void>;
    /**
     * Return all memories whose lesson_pattern_id matches patternId (RFC-0011 §4.1).
     */
    getMemoriesByPattern(patternId: string): Promise<any[]>;
    /**
     * S-MORA: Singularity Memory-Oriented Retrieval Augmentation (RFC-0012)
     * 5-layer pipeline: Scrubbing → HyDE-Lite → Multi-channel retrieval → RRF → Heritage-aware reranking
     */
    smora(query: string, options?: {
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
     * Agentic memory write judge (Mem0 / A-MEM / Letta pattern).
     *
     * Called from add() when a candidate memory falls in the gray zone of
     * similarity to an existing neighbor (similar but not a duplicate).
     * The LLM decides one of:
     *   - ADD:    new memory is genuinely new info → store alongside
     *   - UPDATE: new memory supersedes existing one → mark existing as
     *             superseded via metadata.replaces_memory_id
     *   - MERGE:  combine the two into a single richer memory → rewrite
     *             content and supersede the existing
     *   - NOOP:   new memory adds nothing the existing one doesn't cover
     *
     * Falls back to ADD on any failure (LLM disabled, throws, times out,
     * returns malformed JSON, returns an unknown decision). Latency bounded
     * by AGENTIC_OPS_TIMEOUT_MS (default 5000ms).
     */
    _judgeMemoryWrite(newContent: string, neighbor: {
        id: string;
        content: string;
        score?: number;
    }): Promise<{
        decision: 'ADD' | 'UPDATE' | 'MERGE' | 'NOOP';
        mergedContent?: string;
        rationale?: string;
    }>;
    /**
     * Emit a YAMO block recording an agentic ops decision for provenance.
     * Non-critical — failures are swallowed (caller wraps in .catch).
     */
    _emitAgenticDecisionBlock(judgment: {
        decision: string;
        mergedContent?: string;
        rationale?: string;
    }, neighborId: string, newContent: string): Promise<void>;
    /**
     * Canonicalize an intent string for caching + lookup. Mirrors
     * _canonicalizeEntity's lightweight normalization but preserves
     * intent vocabulary (no plural stripping — "debug" and "debugs" are
     * legitimately different verbs/states in intent chains).
     * @private
     */
    _canonicalizeIntent(intent: string): string;
    /**
     * Embed a single intent string with persistent caching. Intents are
     * low-cardinality (handfuls per project) and stable across queries, so
     * the cache hits hard. Cap at 500 entries with LRU eviction. Returns
     * null on any failure so callers can fall back to raw overlap.
     * @private
     */
    _embedIntent(intent: string): Promise<any>;
    /**
     * Heritage bonus from intent vector matrices. For each session intent,
     * take its max cosine similarity against any chain intent (MaxSim),
     * sum, divide by sessionIntent count. Vectors are assumed
     * L2-normalized (embedding service normalizes by default), so cosine =
     * dot product. Returns 0 on empty/invalid input.
     * @private
     */
    _heritageBonusFromVectors(sessionVecs: any, chainVecs: any, denom: number): number;
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
    _generateHyDE(query: string): Promise<string>;
    getAll(options?: {}): Promise<any>;
    stats(): Promise<{
        count: number;
        totalMemories: number;
        totalSkills: number;
        tableName: string;
        uri: string;
        isConnected: boolean;
        embedding: {
            configured: boolean;
            primary: any;
            fallbacks: any[];
        };
        status: string;
    } | {
        count: any;
        totalMemories: any;
        totalSkills: number;
        tableName: any;
        uri: any;
        isConnected: any;
        embedding: {
            configured: boolean;
            primary: any;
            fallbacks: any[];
        };
        status?: undefined;
    }>;
    _parseEmbeddingConfig(): {
        modelType: string;
        modelName: string;
        dimension: number;
        priority: number;
        apiKey: string | undefined;
    }[];
    /**
     * Close database connections and release resources
     *
     * This should be called when done with the MemoryMesh to properly:
     * - Close LanceDB connections
     * - Release file handles
     * - Clean up resources
     *
     * Important for tests and cleanup to prevent connection leaks.
     *
     * @returns {Promise<void>}
     *
     * @example
     * ```typescript
     * const mesh = new MemoryMesh();
     * await mesh.init();
     * // ... use mesh ...
     * await mesh.close(); // Clean up
     * ```
     */
    /**
     * Compact old data files and prune versions older than 7 days.
     * Best-effort — delegates to LanceDBClient.optimize().
     */
    optimize(): Promise<any>;
    close(): Promise<void>;
    /**
     * Canonicalize an entity string for graph storage and matching.
     * Lowercase, leading '#' stripped, hyphens/underscores → spaces,
     * trailing plural 's' stripped, whitespace collapsed. Lets the graph
     * unify "JWT", "jwt", "JWTs", "JWT-Token" / "jwt-tokens" etc.
     * @private
     */
    _canonicalizeEntity(entity: string): string;
    /**
     * Check if a content string mentions an entity using a case-insensitive
     * word-boundary regex with simple plural tolerance. Fixes the substring
     * false positives of the old `content.includes(entity)` check (where
     * "Auth" matched "AuthService" or "auth-token" matched "authorization").
     * @private
     */
    _contentMentions(content: string, entity: string): boolean;
    /**
     * Heuristic triple extractor — pairs consecutive PascalCase tokens with
     * a between-window verb guess. Produces low-precision edges that pollute
     * the Graph-RAG boost step. Disabled by default — return [] so no graph
     * noise from non-LLM writes.
     *
     * Opt in via GRAPH_RAG_HEURISTIC_TRIPLES=on env when running against a
     * corpus where you actually want PascalCase-pairing as a backstop. The
     * LLM path (_extractTriplesLLM) is the recommended graph source.
     */
    _extractTriplesHeuristics(content: string): {
        source: string;
        target: string;
        relation: string;
        weight: number;
    }[];
    _extractTriplesLLM(content: string): Promise<{
        source: string;
        target: string;
        relation: string;
        weight: any;
    }[]>;
    /** Merkle-anchor unanchored yamo_blocks rows — see mesh/yamo-audit.ts. */
    anchor(): Promise<{
        root: string;
        count: any;
        updates: any[];
    } | null>;
}
/**
 * Main CLI handler
 *
 * @deprecated Scheduled for removal in v4. Legacy JSON/stdin entry point that
 * predates and duplicates the commander CLI — use `bin/memory_mesh.js` (the
 * `memory-mesh` binary) instead.
 */
export declare function run(): Promise<void>;
export default MemoryMesh;
