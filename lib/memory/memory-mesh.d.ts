import { LanceDBClient, MemoryRecord } from "./adapters/client.js";
import { MemoryState } from "./schema.js";
import EmbeddingFactory from "./embeddings/factory.js";
import { Scrubber } from "../scrubber/scrubber.js";
import { KeywordSearch } from "./search/keyword-search.js";
import { LLMClient } from "../llm/client.js";
import * as lancedb from "@lancedb/lancedb";
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
export interface RankedMemory {
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
    client: LanceDBClient | null;
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
    yamoTable: lancedb.Table | null;
    skillTable: lancedb.Table | null;
    graphTable: lancedb.Table | null;
    decisionEdgeTable: lancedb.Table | null;
    revisionTable: lancedb.Table | null;
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
    /** @private Validate/normalize caller metadata — see mesh/write.ts. */
    _validateMetadata(metadata: any): Record<string, any>;
    /** @private Pre-scrub content sanitation — see mesh/write.ts. */
    _sanitizeContent(content: string): string;
    /**
     * Initialize the LanceDB client
     */
    init(): Promise<void>;
    /**
     * Add a memory: scrub → semantic injection → dedup/agentic judge →
     * embed → write → belief revision → graph triples → decision edges →
     * YAMO audit block — see mesh/write.ts for the full pipeline.
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
    /** Generate reflection insights from recent memories (LLM or heuristic) — see mesh/synthesis.ts. */
    reflect(options?: {
        lookback?: number;
        topic?: string;
        generate?: boolean;
    }): Promise<{
        topic: string | undefined;
        count: number;
        context: {
            content: any;
            type: any;
            id: any;
        }[];
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
        sourceMemoryCount: number;
        yamoBlock: string | null;
        createdAt: string;
        count?: undefined;
        context?: undefined;
        prompt?: undefined;
    }>;
    /** Multi-chunk document ingest with Late Chunking — see mesh/write.ts. */
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
    /** @private Paragraph-based span splitter for addDocument — see mesh/write.ts. */
    _splitParagraphSpans(content: string, minChars: number, maxChars: number): Array<{
        start: number;
        end: number;
    }>;
    /** Build a RAPTOR summary tree (requires enableLLM) — see mesh/synthesis.ts. */
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
    /** @private Cosine k-means over memory vectors — see mesh/synthesis.ts. */
    _kmeansClusters<T extends {
        vector: number[];
    }>(items: T[], k: number, maxIters?: number): T[][];
    /** @private LLM-summarize one cluster (singletons promote as-is) — see mesh/synthesis.ts. */
    _summarizeCluster(cluster: Array<{
        id: string;
        content: string;
        vector?: number[];
    }>, level: number): Promise<{
        id: string;
        content: string;
        vector: number[];
    } | null>;
    /** Ingest a YAMO skill (optionally staged, AGP 3b) — see mesh/skills.ts. */
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
    /** Flush a κ-approved pending skill ingest — see mesh/skills.ts. */
    commitPendingIngest(pending: PendingSkillIngest, opts?: {
        finalSourceFile?: string;
    }): Promise<{
        id: any;
        name: any;
        intent: any;
    }>;
    /** @private Serialize the skillDirectories[0] hot-swap — see mesh/skills.ts. */
    _acquireStagingLock(): Promise<() => void>;
    /** Synthesize a skill from memories via LLM (commit or stage) — see mesh/skills.ts. */
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
    /** Bounded reliability walk (+0.1/−0.2) + use_count/last_used — see mesh/skills.ts. */
    updateSkillReliability(id: string, success: boolean): Promise<{
        id: string;
        reliability: any;
        use_count: any;
    }>;
    /** Fetch a synthesized skill by id — see mesh/skills.ts. */
    getSkill(id: string): Promise<any>;
    /** Remove low-reliability skills — see mesh/skills.ts. */
    pruneSkills(threshold?: number): Promise<{
        pruned_count: number;
        total_remaining: number;
    }>;
    /** List synthesized skills — see mesh/skills.ts. */
    listSkills(options?: {
        limit?: number;
    }): Promise<any[]>;
    /** Hybrid (vector + keyword, RRF) skill search — see mesh/skills.ts. */
    searchSkills(query: string, options?: {
        limit?: number;
    }): Promise<any[]>;
    /**
     * Get recent YAMO logs for the heartbeat
     * @param {Object} options
     */
    getYamoLog(options?: {
        limit?: number;
    }): Promise<{
        id: any;
        yamoText: any;
        timestamp: any;
    }[]>;
    /** @private Quarantine a corrupt yamo_blocks table — see mesh/yamo-audit.ts. */
    _quarantineYamoTable(cause: any): Promise<void>;
    /** @private Emit a YAMO audit block (non-critical, never throws) — see mesh/yamo-audit.ts. */
    _emitYamoBlock(operationType: string, memoryId: string | undefined, yamoText: string, heritage?: {
        intentChain: string[];
        hypotheses: string[];
        rationales: string[];
    }): Promise<void>;
    /**
     * Search memory using hybrid vector + keyword search with RRF fusion —
     * see mesh/search.ts for the full pipeline (modes: hybrid | vector | keyword).
     */
    search(query: string, options?: {
        limit?: number;
        filter?: any;
        mode?: string;
        useCache?: boolean;
        includeArchived?: boolean;
    }): Promise<RankedMemory[]>;
    /** @private 1-hop/2-hop graph-edge score boosting for search() — see mesh/graph-rag.ts. */
    _applyGraphRagBoosting(results: RankedMemory[], query: string): Promise<RankedMemory[]>;
    /** @private Keyword (FTS/BM25) channel — see mesh/search.ts. */
    _keywordSearch(query: string, limit: number, filter?: any, opts?: {
        includeArchived?: boolean;
    }): Promise<RankedMemory[]>;
    /** @private Normalize scores to [0,1] — see mesh/search.ts. */
    _normalizeScores(results: RankedMemory[]): RankedMemory[];
    /** @private Tokenize a query for keyword matching — see mesh/search.ts. */
    _tokenizeQuery(text: string): string[];
    /** Format results for LLM consumption with injection fencing — see mesh/search.ts. */
    formatResults(results: any[]): string;
    get(id: string): Promise<StoredMemory | null>;
    /**
     * Delete a memory entry by ID.
     */
    delete(id: string): Promise<void>;
    /** @private SQL clause excluding archived and not-yet-due rows — see mesh/lifecycle.ts. */
    _activeStateClause(opts?: {
        includeArchived?: boolean;
    }): string;
    /** @private Coerce a defer-until value to a Date — see mesh/lifecycle.ts. */
    _coerceDeferUntil(value: unknown): Date | null;
    /** Set a memory lifecycle state — see mesh/lifecycle.ts. */
    setState(id: string, state: MemoryState): Promise<{
        id: string;
        state: MemoryState;
        previous: string | null;
    }>;
    /** Suppress a memory from recall until a date — see mesh/lifecycle.ts. */
    deferMemory(id: string, until: Date | string | number | null): Promise<{
        id: string;
        defer_until: string | null;
    }>;
    /** @private Fire-and-forget append-only revision log write — see mesh/lifecycle.ts. */
    _recordRevision(memoryId: string, changes: Array<{
        field: string;
        oldValue: unknown;
        newValue: unknown;
    }>, actor?: string): void;
    /** Append-only revision history for a memory or skill id — see mesh/lifecycle.ts. */
    history(memoryId: string): Promise<Array<{
        id: string;
        memory_id: string;
        field: string;
        old_value: unknown;
        new_value: unknown;
        actor: string | null;
        created_at: string;
    }>>;
    /** Restore a deleted memory from its revision snapshot — see mesh/lifecycle.ts. */
    restoreDeleted(id: string): Promise<{
        id: string;
        content: string;
    } | null>;
    /** @private Resolve a memory by id or stable metadata.key — see mesh/lifecycle.ts. */
    _resolveIdOrKey(idOrKey: string): Promise<MemoryRecord | null>;
    /** Pin a memory so prime() always surfaces it — see mesh/lifecycle.ts. */
    pin(idOrKey: string): Promise<{
        id: string;
        pinned: boolean;
    }>;
    /** Unpin a memory — see mesh/lifecycle.ts. */
    unpin(idOrKey: string): Promise<{
        id: string;
        pinned: boolean;
    }>;
    /** @private Shared pin/unpin write path — see mesh/lifecycle.ts. */
    _setPinned(idOrKey: string, pinned: boolean): Promise<{
        id: string;
        pinned: boolean;
    }>;
    /** Push-based curated recall: pinned verbatim + newly-due + contextual — see mesh/lifecycle.ts. */
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
    /** Deterministic, vector-free JSONL export (git-committable) — see mesh/maintenance.ts. */
    exportJsonl(filePath?: string): Promise<{
        path: string | null;
        lines: number;
        text?: string;
    }>;
    /** Import a JSONL export, re-embedding locally (idempotent by id) — see mesh/maintenance.ts. */
    importJsonl(source: string | {
        text: string;
    }): Promise<Record<string, {
        imported: number;
        skipped: number;
    }>>;
    /** List decision edges whose endpoints no longer resolve — see mesh/decision-graph.ts. */
    orphanEdges(opts?: {
        limit?: number;
    }): Promise<Array<{
        id: string;
        source_id: string;
        target_id: string;
        relation: string;
        missing: string[];
    }>>;
    /** Active memories untouched for N days — see mesh/maintenance.ts. */
    staleMemoriesReport(opts?: {
        days?: number;
        limit?: number;
    }): Promise<Array<{
        id: string;
        content: string;
        last_touch: string | null;
    }>>;
    /** Mechanical health checks (config, edges, index, state drift, skills) — see mesh/maintenance.ts. */
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
    /** @private Coerce a decision-edge id list — see mesh/decision-graph.ts. */
    _coerceIdList(value: unknown): string[];
    /** @private Gate: does this add() carry decision semantics — see mesh/decision-graph.ts. */
    _isDecisionWrite(metadata: any, supersededIds: string[]): boolean;
    /** @private Fire-and-forget decision-edge write at end of add() — see mesh/decision-graph.ts. */
    _writeDecisionEdges(sourceId: string, metadata: any, supersededIds: string[]): Promise<void>;
    /** Traverse decision lineage (ancestors or dependents) — see mesh/decision-graph.ts. */
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
    /** @private Contradiction-aware ranking penalty — see mesh/decision-graph.ts. */
    _applyContradictionPenalty(results: RankedMemory[]): Promise<RankedMemory[]>;
    /** Memories still resting on refuted decisions — see mesh/decision-graph.ts. */
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
    /** Record a decision outcome (validated/refuted/mixed) — see mesh/decision-graph.ts. */
    recordOutcome(decisionId: string, outcome: {
        status: "validated" | "refuted" | "mixed";
        note?: string;
    }): Promise<void>;
    /** Distill a structured RFC-0011 lesson into an idempotent pattern-keyed memory — see mesh/lessons.ts. */
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
    /** Query stored lessons (semantic or metadata scan) — see mesh/lessons.ts. */
    queryLessons(query?: string, options?: {
        limit?: number;
    }): Promise<any[]>;
    /** Insert heritage (intent chain / hypotheses / rationales) for a memory — see mesh/write.ts. */
    insertHeritage(memoryId: string, heritage: {
        intentChain: string[];
        hypotheses: string[];
        rationales: string[];
    }): Promise<void>;
    /** Fetch memories by lesson pattern id — see mesh/lessons.ts. */
    getMemoriesByPattern(patternId: string): Promise<any[]>;
    /**
     * S-MORA: Singularity Memory-Oriented Retrieval Augmentation (RFC-0012)
     * 5-layer pipeline: Scrubbing → HyDE-Lite → Multi-channel retrieval → RRF → Heritage-aware reranking
     * — see mesh/smora.ts.
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
    /** @private Agentic-ops LLM judge for gray-zone-similar writes — see mesh/write.ts. */
    _judgeMemoryWrite(newContent: string, neighbor: {
        id: string;
        content: string;
        score?: number;
    }): Promise<{
        decision: 'ADD' | 'UPDATE' | 'MERGE' | 'NOOP';
        mergedContent?: string;
        rationale?: string;
    }>;
    /** @private YAMO audit block for an agentic-ops decision — see mesh/write.ts. */
    _emitAgenticDecisionBlock(judgment: {
        decision: string;
        mergedContent?: string;
        rationale?: string;
    }, neighborId: string, newContent: string): Promise<void>;
    /** @private Canonicalize an intent string for cache keys — see mesh/smora.ts. */
    _canonicalizeIntent(intent: string): string;
    /** @private Embed an intent with LRU caching — see mesh/smora.ts. */
    _embedIntent(intent: string): Promise<any>;
    /** @private Heritage bonus from cosine over intent vectors — see mesh/smora.ts. */
    _heritageBonusFromVectors(sessionVecs: any, chainVecs: any, denom: number): number;
    /** @private LLM HyDE expansion with cache + timeout — see mesh/smora.ts. */
    _generateHyDE(query: string): Promise<string>;
    getAll(options?: {}): Promise<MemoryRecord[]>;
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
    optimize(): Promise<void | undefined>;
    close(): Promise<void>;
    /** @private Canonicalize an entity (lowercase, separators, plural-strip) — see mesh/graph-rag.ts. */
    _canonicalizeEntity(entity: string): string;
    /** @private Does content mention the entity (canonical-aware) — see mesh/graph-rag.ts. */
    _contentMentions(content: string, entity: string): boolean;
    /** @private Heuristic PascalCase triple extraction (off by default) — see mesh/graph-rag.ts. */
    _extractTriplesHeuristics(content: string): {
        source: string;
        target: string;
        relation: string;
        weight: number;
    }[];
    /** @private LLM triple extraction (recommended source) — see mesh/graph-rag.ts. */
    _extractTriplesLLM(content: string): Promise<{
        source: string;
        target: string;
        relation: string;
        weight: any;
    }[]>;
    /** Merkle-anchor unanchored yamo_blocks rows — see mesh/yamo-audit.ts. */
    anchor(): Promise<{
        root: string;
        count: number;
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
