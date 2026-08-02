/**
 * Memory Mesh - Vector Memory Storage with LanceDB
 * Provides persistent semantic memory for YAMO OS using LanceDB backend
 *
 * CLI: the `memory-mesh` binary (bin/memory_mesh.js). The legacy JSON/stdin
 * handler (`run()`) was removed in v4 — consumers that need a JSON action
 * dispatcher implement it against the public MemoryMesh API (see yamo-os
 * tools/memory_mesh.js for the reference port).
 */
import fs from "fs";
import path from "path";
import { LanceDBClient, MemoryRecord } from "./adapters/client.js";
import { getConfig } from "./adapters/config.js";
import { getEmbeddingDimension, createSynthesizedSkillSchema, MemoryState, } from "./schema.js";
import EmbeddingFactory from "./embeddings/factory.js";
import { Scrubber } from "../scrubber/scrubber.js";
import { KeywordSearch } from "./search/keyword-search.js";
import { LLMClient } from "../llm/client.js";
import * as lancedb from "@lancedb/lancedb";
import * as yamoAudit from "./mesh/yamo-audit.js";
import { toEpochMs } from "./mesh/shared.js";
import * as decisionGraph from "./mesh/decision-graph.js";
import * as lessons from "./mesh/lessons.js";
import * as maintenance from "./mesh/maintenance.js";
import * as lifecycle from "./mesh/lifecycle.js";
import * as smoraMod from "./mesh/smora.js";
import * as graphRag from "./mesh/graph-rag.js";
import * as searchMod from "./mesh/search.js";
import * as skills from "./mesh/skills.js";
import * as synthesis from "./mesh/synthesis.js";
import * as write from "./mesh/write.js";
import { createLogger } from "../utils/logger.js";
const logger = createLogger("brain");


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
export class MemoryMesh {
    client: LanceDBClient | null;
    config: any;
    embeddingFactory;
    keywordSearch;
    isInitialized;
    vectorDimension;
    enableYamo;
    enableLLM;
    enableMemory;
    enableReranker;
    enableAgenticOps;
    _kernel_execute: any;
    agentId;
    yamoTable: lancedb.Table | null;
    skillTable: lancedb.Table | null;
    graphTable: lancedb.Table | null = null;
    decisionEdgeTable: lancedb.Table | null = null;
    revisionTable: lancedb.Table | null = null;
    llmClient;
    scrubber;
    queryCache: Map<string, { result: RankedMemory[]; timestamp: number }>;
    cacheConfig;
    hydeCache; // query → { text, timestamp } for LLM-generated HyDE expansions
    intentEmbedCache; // canonical intent → embedding vector (heritage rerank)
    skillDirectories; // Store skill directories for synthesis
    // Serializes the skillDirectories[0] hot-swap during staged synthesis (Phase 3b)
    // so concurrent synthesize() calls can't clobber each other's redirect.
    _stagingLock: Promise<unknown> = Promise.resolve();
    dbDir; // Store custom dbDir for in-memory databases
    semanticInjection; // Prepend V5 topics/entities before embedding (Phase 5 Step 1)
    /**
     * Create a new MemoryMesh instance
     * @param {Object} [options={}]
     */
    constructor(options: MemoryMeshOptions = {}) {
        this.client = null;
        this.config = null;
        this.embeddingFactory = new EmbeddingFactory();
        this.keywordSearch = new KeywordSearch();
        this.isInitialized = false;
        this.vectorDimension = 384; // Will be set during init()
        // YAMO and LLM support
        this.enableYamo = options.enableYamo !== false;
        this.enableLLM = options.enableLLM !== false;
        this.enableMemory = options.enableMemory !== false;
        this.semanticInjection = options.enableSemanticInjection !== false;
        this.enableReranker = options.enableReranker !== false;
        // Opt-in: when true, add() runs an LLM judge on gray-zone-similar
        // candidates and may UPDATE/MERGE/NOOP instead of plain ADD.
        this.enableAgenticOps = options.enableAgenticOps === true;
        this.agentId = options.agentId || "YAMO_AGENT";
        this.yamoTable = null;
        this.skillTable = null;
        this.llmClient = this.enableLLM ? new LLMClient() : null;
        // Store skill directories for synthesis
        if (Array.isArray(options.skill_directories)) {
            this.skillDirectories = options.skill_directories;
        }
        else if (options.skill_directories) {
            this.skillDirectories = [options.skill_directories];
        }
        else {
            this.skillDirectories = ["skills"];
        }
        // Initialize LLM client if enabled
        if (this.enableLLM) {
            this.llmClient = new LLMClient({
                provider: options.llmProvider,
                apiKey: options.llmApiKey,
                model: options.llmModel,
                maxTokens: options.llmMaxTokens,
            });
        }
        // Scrubber for Layer 0 sanitization
        this.scrubber = new Scrubber({
            enabled: true,
            chunking: {
                minTokens: 1, // Allow short memories
            }, // Type cast for partial config
            validation: {
                enforceMinLength: false, // Disable strict length validation
            },
        });
        // Simple LRU cache for search queries (5 minute TTL)
        this.queryCache = new Map();
        this.cacheConfig = {
            maxSize: 500,
            ttlMs: 5 * 60 * 1000, // 5 minutes
        };
        // HyDE expansions are LLM-expensive; cache by query string with
        // the same TTL as the query cache. Smaller cap since values are
        // longer strings, not result arrays.
        this.hydeCache = new Map();
        // Intent embeddings for heritage-aware rerank (workspace-bb4).
        // Intents are stable and low-cardinality, so cache persistently —
        // no TTL, but cap at 500 entries with LRU eviction.
        this.intentEmbedCache = new Map();
        // Store custom dbDir for test isolation
        this.dbDir = options.dbDir;
    }
    /**
     * Generate a cache key from query and options
     * @private
     */
    _generateCacheKey(query: string, options: { limit?: number; filter?: any; mode?: string; includeArchived?: boolean } = {}) {
        const normalizedOptions = {
            limit: options.limit || 10,
            filter: options.filter || null,
            includeArchived: options.includeArchived === true,
            // Normalize options that affect results
        };
        return `search:${query}:${JSON.stringify(normalizedOptions)}`;
    }
    /**
     * Get cached result if valid
     * @private
     *
     * Race condition fix: The delete-then-set pattern for LRU tracking creates a window
     * where another operation could observe the key as missing. We use a try-finally
     * pattern to ensure atomicity at the application level.
     */
    _getCachedResult(key: string): RankedMemory[] | null {
        const entry = this.queryCache.get(key);
        if (!entry) {
            return null;
        }
        // Check TTL - must be done before any mutation
        const now = Date.now();
        if (now - entry.timestamp > this.cacheConfig.ttlMs) {
            this.queryCache.delete(key);
            return null;
        }
        // Move to end (most recently used) - delete and re-add with updated timestamp
        // While not truly atomic, the key remains accessible during the operation
        // since we already have the entry reference
        this.queryCache.delete(key);
        this.queryCache.set(key, {
            ...entry,
            timestamp: now, // Update timestamp for LRU tracking
        });
        return entry.result;
    }
    /**
     * Cache a search result
     * @private
     */
    _cacheResult(key: string, result: RankedMemory[]) {
        // Evict oldest if at max size
        if (this.queryCache.size >= this.cacheConfig.maxSize) {
            const firstKey = this.queryCache.keys().next().value;
            if (firstKey !== undefined) {
                this.queryCache.delete(firstKey);
            }
        }
        this.queryCache.set(key, {
            result,
            timestamp: Date.now(),
        });
    }
    /**
     * Clear all cached results
     */
    clearCache() {
        this.queryCache.clear();
    }
    /**
     * Get cache statistics
     */
    getCacheStats() {
        return {
            size: this.queryCache.size,
            maxSize: this.cacheConfig.maxSize,
            ttlMs: this.cacheConfig.ttlMs,
        };
    }
    /** @private Validate/normalize caller metadata — see mesh/write.ts. */
    _validateMetadata(metadata: any): Record<string, any> {
        return write._validateMetadata(this, metadata);
    }
    /** @private Pre-scrub content sanitation — see mesh/write.ts. */
    _sanitizeContent(content: string) {
        return write._sanitizeContent(this, content);
    }
    /**
     * Initialize the LanceDB client
     */
    async init() {
        if (this.isInitialized) {
            return;
        }
        if (!this.enableMemory) {
            this.isInitialized = true;
            if (process.env.YAMO_DEBUG === "true") {
                logger.debug("MemoryMesh initialization skipped (enableMemory=false)");
            }
            return;
        }
        try {
            // Load configuration
            this.config = getConfig();
            // Detect vector dimension from embedding model configuration
            const modelName = process.env.EMBEDDING_MODEL_NAME || "Xenova/all-MiniLM-L6-v2";
            const envDimension = parseInt(process.env.EMBEDDING_DIMENSION || "0") || null;
            this.vectorDimension = envDimension || getEmbeddingDimension(modelName);
            // Only log in debug mode to avoid corrupting spinner/REPL display
            if (process.env.YAMO_DEBUG === "true") {
                logger.debug({ dimension: this.vectorDimension, model: modelName }, "Using vector dimension");
            }
            // Use custom dbDir if provided (for test isolation), otherwise use config
            const dbUri = this.dbDir || this.config.LANCEDB_URI;
            // Create LanceDBClient with detected dimension
            this.client = new LanceDBClient({
                uri: dbUri,
                tableName: this.config.LANCEDB_MEMORY_TABLE,
                vectorDimension: this.vectorDimension,
                maxRetries: 3,
                retryDelay: 1000,
            });
            // Connect to database
            await this.client.connect();
            // Configure embedding factory from environment
            const embeddingConfigs = this._parseEmbeddingConfig();
            this.embeddingFactory.configure(embeddingConfigs);
            await this.embeddingFactory.init();
            if (this.scrubber && this.scrubber.stages && this.scrubber.stages.chunker) {
                this.scrubber.stages.chunker.config.embedFn = async (text: string) => {
                    return this.embeddingFactory.embed(text);
                };
            }
            // Hydrate Keyword Search (In-Memory)
            if (this.client) {
                try {
                    const allRecords = await this.client.getAll({ limit: 10000 });
                    // Keyword index mirrors default-recall visibility: superseded,
                    // archived, and not-yet-due deferred rows are all excluded.
                    const nowMs = Date.now();
                    const activeRecords = allRecords.filter((r: any) => !r.superseded_at &&
                        r.state !== "archived" &&
                        (!r.defer_until || toEpochMs(r.defer_until) <= nowMs));
                    this.keywordSearch.load(activeRecords);
                }
                catch (_e) {
                    // Ignore if table doesn't exist yet
                }
            }
            // Initialize extension tables if enabled
            if (this.enableYamo && this.client && this.client.db) {
                try {
                    const corruptionMarker = (this.dbDir && this.dbDir !== ":memory:")
                        ? path.join(this.dbDir, "yamo_blocks.CORRUPT")
                        : null;
                    if (corruptionMarker && fs.existsSync(corruptionMarker)) {
                        logger.error({ marker: corruptionMarker }, "yamo_blocks is quarantined from a prior IO corruption — audit log disabled. An operator must inspect the moved-aside table and remove the marker to re-enable logging.");
                        this.yamoTable = null;
                    }
                    else {
                        const { createYamoTable } = await import("../yamo/schema.js");
                        this.yamoTable = await createYamoTable(this.client.db, "yamo_blocks");
                    }
                    // Initialize synthesized skills table (Recursive Skill Synthesis)
                    // const { createSynthesizedSkillSchema } = await import('./schema'); // Imported statically now
                    const existingTables = await this.client.db.tableNames();
                    if (existingTables.includes("synthesized_skills")) {
                        this.skillTable =
                            await this.client.db.openTable("synthesized_skills");
                    }
                    else {
                        const skillSchema = createSynthesizedSkillSchema(this.vectorDimension);
                        this.skillTable = await this.client.db.createTable("synthesized_skills", [], {
                            schema: skillSchema,
                            storageOptions: { new_table_data_storage_version: "stable" },
                        });
                    }
                    // Migrate manifest paths to V2 layout (idempotent)
                    try {
                        // Native method not surfaced in the 0.31 Table typings
                        await (this.skillTable as any).migrateManifestPathsV2();
                    }
                    catch {
                        // Already migrated or not a local table — ignore
                    }
                    if (process.env.YAMO_DEBUG === "true") {
                        logger.debug("YAMO blocks and synthesized skills tables initialized");
                    }
                }
                catch (e) {
                    logger.warn({ err: e }, "Failed to initialize extension tables");
                }
            }
            // Initialize Graph-RAG property graph table
            if (this.client && this.client.db) {
                try {
                    const { createGraphTable } = await import("./schema.js");
                    this.graphTable = await createGraphTable(this.client.db, "graph_edges");
                }
                catch (error) {
                    logger.warn({ err: error }, "Failed to initialize graph_edges table");
                }
            }
            // Initialize Decision Context Graph edge table
            if (this.client && this.client.db) {
                try {
                    const { createDecisionEdgeTable } = await import("./schema.js");
                    this.decisionEdgeTable = await createDecisionEdgeTable(this.client.db, "decision_edges");
                }
                catch (error) {
                    logger.warn({ err: error }, "Failed to initialize decision_edges table");
                }
            }
            // Initialize append-only revision history table (workspace-g9p.3)
            if (this.client && this.client.db) {
                try {
                    const { createRevisionTable } = await import("./schema.js");
                    this.revisionTable = await createRevisionTable(this.client.db, "memory_revisions");
                }
                catch (error) {
                    logger.warn({ err: error }, "Failed to initialize memory_revisions table");
                }
            }
            this.isInitialized = true;
        }
        catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            throw e;
        }
    }
    /**
     * Add a memory: scrub → semantic injection → dedup/agentic judge →
     * embed → write → belief revision → graph triples → decision edges →
     * YAMO audit block — see mesh/write.ts for the full pipeline.
     */
    async add(content: string, metadata: Record<string, any> = {}) {
        return write.add(this, content, metadata);
    }
    /**
     * Semantic alias for add().
     * @param content - The text content to store
     * @param metadata - Optional metadata
     * @returns Promise with memory record
     */
    async ingest(content: string, metadata: any = {}) {
        return this.add(content, metadata);
    }
    /** Generate reflection insights from recent memories (LLM or heuristic) — see mesh/synthesis.ts. */
    async reflect(options: { lookback?: number; topic?: string; generate?: boolean } = {}) {
        return synthesis.reflect(this, options);
    }
    /** Multi-chunk document ingest with Late Chunking — see mesh/write.ts. */
    async addDocument(
        content: string,
        metadata: Record<string, unknown> = {},
        options: { minChunkChars?: number; maxChunkChars?: number; lateChunk?: boolean } = {},
    ): Promise<{ documentId: string; chunks: number; ids: string[]; lateChunked: boolean }> {
        return write.addDocument(this, content, metadata, options);
    }
    /** @private Paragraph-based span splitter for addDocument — see mesh/write.ts. */
    _splitParagraphSpans(content: string, minChars: number, maxChars: number): Array<{ start: number; end: number }> {
        return write._splitParagraphSpans(this, content, minChars, maxChars);
    }
    /** Build a RAPTOR summary tree (requires enableLLM) — see mesh/synthesis.ts. */
    async raptor(options: {
        topic?: string;
        limit?: number;
        maxLevels?: number;
        branchingFactor?: number;
        minClusterSize?: number;
    } = {}) {
        return synthesis.raptor(this, options);
    }
    /** @private Cosine k-means over memory vectors — see mesh/synthesis.ts. */
    _kmeansClusters<T extends { vector: number[] }>(items: T[], k: number, maxIters = 50): T[][] {
        return synthesis._kmeansClusters(this, items, k, maxIters);
    }
    /** @private LLM-summarize one cluster (singletons promote as-is) — see mesh/synthesis.ts. */
    async _summarizeCluster(
        cluster: Array<{ id: string; content: string; vector?: number[] }>,
        level: number,
    ): Promise<{ id: string; content: string; vector: number[] } | null> {
        return synthesis._summarizeCluster(this, cluster, level);
    }
    /** Ingest a YAMO skill (optionally staged, AGP 3b) — see mesh/skills.ts. */
    async ingestSkill(yamoText: string, metadata: Record<string, any> = {}, sourceFilePath?: string, opts: { stage?: boolean } = {}) {
        return skills.ingestSkill(this, yamoText, metadata, sourceFilePath, opts);
    }
    /** Flush a κ-approved pending skill ingest — see mesh/skills.ts. */
    async commitPendingIngest(pending: PendingSkillIngest, opts: { finalSourceFile?: string } = {}) {
        return skills.commitPendingIngest(this, pending, opts);
    }
    /** @private Serialize the skillDirectories[0] hot-swap — see mesh/skills.ts. */
    async _acquireStagingLock(): Promise<() => void> {
        return skills._acquireStagingLock(this);
    }
    /** Synthesize a skill from memories via LLM (commit or stage) — see mesh/skills.ts. */
    async synthesize(options: { topic?: string; enrichedPrompt?: string; mode?: string; targetSkillId?: string; lookback?: number; stagingSkillDir?: string; ingest?: "commit" | "stage" } = {}) {
        return skills.synthesize(this, options);
    }
    /** Bounded reliability walk (+0.1/−0.2) + use_count/last_used — see mesh/skills.ts. */
    async updateSkillReliability(id: string, success: boolean) {
        return skills.updateSkillReliability(this, id, success);
    }
    /** Fetch a synthesized skill by id — see mesh/skills.ts. */
    async getSkill(id: string) {
        return skills.getSkill(this, id);
    }
    /** Remove low-reliability skills — see mesh/skills.ts. */
    async pruneSkills(threshold = 0.3) {
        return skills.pruneSkills(this, threshold);
    }
    /** List synthesized skills — see mesh/skills.ts. */
    async listSkills(options: { limit?: number } = {}) {
        return skills.listSkills(this, options);
    }
    /** Hybrid (vector + keyword, RRF) skill search — see mesh/skills.ts. */
    async searchSkills(query: string, options: { limit?: number } = {}) {
        return skills.searchSkills(this, query, options);
    }
    /**
     * Get recent YAMO logs for the heartbeat
     * @param {Object} options
     */
    async getYamoLog(options: { limit?: number } = {}) {
        return yamoAudit.getYamoLog(this, options);
    }
    /** @private Quarantine a corrupt yamo_blocks table — see mesh/yamo-audit.ts. */
    async _quarantineYamoTable(cause: any): Promise<void> {
        return yamoAudit._quarantineYamoTable(this, cause);
    }
    /** @private Emit a YAMO audit block (non-critical, never throws) — see mesh/yamo-audit.ts. */
    async _emitYamoBlock(operationType: string, memoryId: string | undefined, yamoText: string, heritage?: { intentChain: string[]; hypotheses: string[]; rationales: string[] }) {
        return yamoAudit._emitYamoBlock(this, operationType, memoryId, yamoText, heritage);
    }
    /**
     * Search memory using hybrid vector + keyword search with RRF fusion —
     * see mesh/search.ts for the full pipeline (modes: hybrid | vector | keyword).
     */
    async search(query: string, options: { limit?: number; filter?: any; mode?: string; useCache?: boolean; includeArchived?: boolean } = {}): Promise<RankedMemory[]> {
        return searchMod.search(this, query, options);
    }

    /** @private 1-hop/2-hop graph-edge score boosting for search() — see mesh/graph-rag.ts. */
    async _applyGraphRagBoosting(results: RankedMemory[], query: string): Promise<RankedMemory[]> {
        return graphRag._applyGraphRagBoosting(this, results, query);
    }
    /** @private Keyword (FTS/BM25) channel — see mesh/search.ts. */
    async _keywordSearch(query: string, limit: number, filter: any = null, opts: { includeArchived?: boolean } = {}): Promise<RankedMemory[]> {
        return searchMod._keywordSearch(this, query, limit, filter, opts);
    }
    /** @private Normalize scores to [0,1] — see mesh/search.ts. */
    _normalizeScores(results: RankedMemory[]): RankedMemory[] {
        return searchMod._normalizeScores(this, results);
    }
    /** @private Tokenize a query for keyword matching — see mesh/search.ts. */
    _tokenizeQuery(text: string) {
        return searchMod._tokenizeQuery(this, text);
    }
    /** Format results for LLM consumption with injection fencing — see mesh/search.ts. */
    formatResults(results: any[]) {
        return searchMod.formatResults(this, results);
    }
    async get(id: string): Promise<StoredMemory | null> {
        await this.init();
        if (!this.client) {
            throw new Error("Database client not initialized");
        }
        const record = await this.client.getById(id);
        return record
            ? {
                id: record.id,
                content: record.content,
                metadata: record.metadata,
                created_at: record.created_at,
                updated_at: record.updated_at,
            }
            : null;
    }
    /**
     * Delete a memory entry by ID.
     */
    async delete(id: string): Promise<void> {
        await this.init();
        if (!this.client) {
            throw new Error("Database client not initialized");
        }
        try {
            // Capture the row before deletion so restoreDeleted() can resurrect
            // it from the revision log (workspace-g9p.3). Best-effort: a failed
            // snapshot never blocks the delete.
            let snapshot: { content: string; metadata: Record<string, unknown> | null } | null = null;
            try {
                const record = await this.client.getById(id);
                if (record) {
                    snapshot = { content: record.content, metadata: record.metadata ?? null };
                }
            }
            catch {
                // snapshot is best-effort
            }
            await this.client.delete(id);
            if (snapshot) {
                this._recordRevision(id, [{ field: "deleted", oldValue: snapshot, newValue: null }]);
            }
            this.keywordSearch?.remove?.(id);
            // Invalidate cached search results — they may reference this id.
            this.queryCache.clear();
        } catch (error: any) {
            if (error instanceof Error && error.message.includes("not found")) return;
            throw error;
        }
    }
    /** @private SQL clause excluding archived and not-yet-due rows — see mesh/lifecycle.ts. */
    _activeStateClause(opts: { includeArchived?: boolean } = {}): string {
        return lifecycle._activeStateClause(this, opts);
    }
    /** @private Coerce a defer-until value to a Date — see mesh/lifecycle.ts. */
    _coerceDeferUntil(value: unknown): Date | null {
        return lifecycle._coerceDeferUntil(this, value);
    }
    /** Set a memory lifecycle state — see mesh/lifecycle.ts. */
    async setState(id: string, state: MemoryState): Promise<{ id: string; state: MemoryState; previous: string | null }> {
        return lifecycle.setState(this, id, state);
    }
    /** Suppress a memory from recall until a date — see mesh/lifecycle.ts. */
    async deferMemory(id: string, until: Date | string | number | null): Promise<{ id: string; defer_until: string | null }> {
        return lifecycle.deferMemory(this, id, until);
    }
    /** @private Fire-and-forget append-only revision log write — see mesh/lifecycle.ts. */
    _recordRevision(memoryId: string, changes: Array<{ field: string; oldValue: unknown; newValue: unknown }>, actor?: string): void {
        return lifecycle._recordRevision(this, memoryId, changes, actor);
    }
    /** Append-only revision history for a memory or skill id — see mesh/lifecycle.ts. */
    async history(memoryId: string): Promise<Array<{ id: string; memory_id: string; field: string; old_value: unknown; new_value: unknown; actor: string | null; created_at: string }>> {
        return lifecycle.history(this, memoryId);
    }
    /** Restore a deleted memory from its revision snapshot — see mesh/lifecycle.ts. */
    async restoreDeleted(id: string): Promise<{ id: string; content: string } | null> {
        return lifecycle.restoreDeleted(this, id);
    }
    /** @private Resolve a memory by id or stable metadata.key — see mesh/lifecycle.ts. */
    async _resolveIdOrKey(idOrKey: string): Promise<MemoryRecord | null> {
        return lifecycle._resolveIdOrKey(this, idOrKey);
    }
    /** Pin a memory so prime() always surfaces it — see mesh/lifecycle.ts. */
    async pin(idOrKey: string): Promise<{ id: string; pinned: boolean }> {
        return lifecycle.pin(this, idOrKey);
    }
    /** Unpin a memory — see mesh/lifecycle.ts. */
    async unpin(idOrKey: string): Promise<{ id: string; pinned: boolean }> {
        return lifecycle.unpin(this, idOrKey);
    }
    /** @private Shared pin/unpin write path — see mesh/lifecycle.ts. */
    async _setPinned(idOrKey: string, pinned: boolean): Promise<{ id: string; pinned: boolean }> {
        return lifecycle._setPinned(this, idOrKey, pinned);
    }
    /** Push-based curated recall: pinned verbatim + newly-due + contextual — see mesh/lifecycle.ts. */
    async prime(query?: string, opts: { limit?: number } = {}): Promise<{
        pinned: Array<{ id: string; content: string; metadata: Record<string, any> | null; created_at: string | null }>;
        due: Array<{ id: string; content: string; metadata: Record<string, any> | null; defer_until: string | null }>;
        contextual: Array<{ id: string; content: string; metadata: Record<string, any> | null; score: number }>;
    }> {
        return lifecycle.prime(this, query, opts);
    }
    /** Deterministic, vector-free JSONL export (git-committable) — see mesh/maintenance.ts. */
    async exportJsonl(filePath?: string): Promise<{ path: string | null; lines: number; text?: string }> {
        return maintenance.exportJsonl(this, filePath);
    }
    /** Import a JSONL export, re-embedding locally (idempotent by id) — see mesh/maintenance.ts. */
    async importJsonl(source: string | { text: string }): Promise<Record<string, { imported: number; skipped: number }>> {
        return maintenance.importJsonl(this, source);
    }
    /** List decision edges whose endpoints no longer resolve — see mesh/decision-graph.ts. */
    async orphanEdges(opts: { limit?: number } = {}): Promise<Array<{ id: string; source_id: string; target_id: string; relation: string; missing: string[] }>> {
        return decisionGraph.orphanEdges(this, opts);
    }
    /** Active memories untouched for N days — see mesh/maintenance.ts. */
    async staleMemoriesReport(opts: { days?: number; limit?: number } = {}): Promise<Array<{ id: string; content: string; last_touch: string | null }>> {
        return maintenance.staleMemoriesReport(this, opts);
    }
    /** Mechanical health checks (config, edges, index, state drift, skills) — see mesh/maintenance.ts. */
    async doctor(opts: { indexThreshold?: number } = {}): Promise<{ ok: boolean; checks: Array<{ name: string; ok: boolean; detail: string }> }> {
        return maintenance.doctor(this, opts);
    }
    /** @private Coerce a decision-edge id list — see mesh/decision-graph.ts. */
    _coerceIdList(value: unknown): string[] {
        return decisionGraph._coerceIdList(this, value);
    }
    /** @private Gate: does this add() carry decision semantics — see mesh/decision-graph.ts. */
    _isDecisionWrite(metadata: any, supersededIds: string[]): boolean {
        return decisionGraph._isDecisionWrite(this, metadata, supersededIds);
    }
    /** @private Fire-and-forget decision-edge write at end of add() — see mesh/decision-graph.ts. */
    async _writeDecisionEdges(sourceId: string, metadata: any, supersededIds: string[]): Promise<void> {
        return decisionGraph._writeDecisionEdges(this, sourceId, metadata, supersededIds);
    }
    /** Traverse decision lineage (ancestors or dependents) — see mesh/decision-graph.ts. */
    async decisionLineage(
        memoryId: string,
        opts: { direction?: "ancestors" | "dependents"; relations?: string[]; maxHops?: number } = {}
    ): Promise<Array<{ from: string; to: string; relation: string; rationale: string | null; weight: number; hop: number }>> {
        return decisionGraph.decisionLineage(this, memoryId, opts);
    }
    /** @private Contradiction-aware ranking penalty — see mesh/decision-graph.ts. */
    async _applyContradictionPenalty(results: RankedMemory[]): Promise<RankedMemory[]> {
        return decisionGraph._applyContradictionPenalty(this, results);
    }
    /** Memories still resting on refuted decisions — see mesh/decision-graph.ts. */
    async staleBeliefs(opts: { memoryId?: string; maxHops?: number } = {}): Promise<Array<{
        refuted: { id: string; content: string | null; note: string | null };
        dependents: Array<{ id: string; relation: string; hop: number; content: string | null; state: string | null }>;
    }>> {
        return decisionGraph.staleBeliefs(this, opts);
    }
    /** Record a decision outcome (validated/refuted/mixed) — see mesh/decision-graph.ts. */
    async recordOutcome(
        decisionId: string,
        outcome: { status: "validated" | "refuted" | "mixed"; note?: string }
    ): Promise<void> {
        return decisionGraph.recordOutcome(this, decisionId, outcome);
    }
    /** Distill a structured RFC-0011 lesson into an idempotent pattern-keyed memory — see mesh/lessons.ts. */
    async distillLesson(context: {
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
    }> {
        return lessons.distillLesson(this, context);
    }
    /** Query stored lessons (semantic or metadata scan) — see mesh/lessons.ts. */
    async queryLessons(query = "", options: { limit?: number } = {}): Promise<any[]> {
        return lessons.queryLessons(this, query, options);
    }
    /** Insert heritage (intent chain / hypotheses / rationales) for a memory — see mesh/write.ts. */
    async insertHeritage(memoryId: string, heritage: { intentChain: string[]; hypotheses: string[]; rationales: string[] }): Promise<void> {
        return write.insertHeritage(this, memoryId, heritage);
    }
    /** Fetch memories by lesson pattern id — see mesh/lessons.ts. */
    async getMemoriesByPattern(patternId: string): Promise<any[]> {
        return lessons.getMemoriesByPattern(this, patternId);
    }
    /**
     * S-MORA: Singularity Memory-Oriented Retrieval Augmentation (RFC-0012)
     * 5-layer pipeline: Scrubbing → HyDE-Lite → Multi-channel retrieval → RRF → Heritage-aware reranking
     * — see mesh/smora.ts.
     */
    async smora(query: string, options: {
        limit?: number;
        retrievalLimit?: number;
        sessionIntent?: string[];
        enableSynthesis?: boolean;
        enableHyDE?: boolean;
        useCache?: boolean;
    } = {}) {
        return smoraMod.smora(this, query, options);
    }
    /** @private Agentic-ops LLM judge for gray-zone-similar writes — see mesh/write.ts. */
    async _judgeMemoryWrite(
        newContent: string,
        neighbor: { id: string; content: string; score?: number },
    ): Promise<{ decision: 'ADD' | 'UPDATE' | 'MERGE' | 'NOOP'; mergedContent?: string; rationale?: string }> {
        return write._judgeMemoryWrite(this, newContent, neighbor);
    }
    /** @private YAMO audit block for an agentic-ops decision — see mesh/write.ts. */
    async _emitAgenticDecisionBlock(
        judgment: { decision: string; mergedContent?: string; rationale?: string },
        neighborId: string,
        newContent: string,
    ) {
        return write._emitAgenticDecisionBlock(this, judgment, neighborId, newContent);
    }
    /** @private Canonicalize an intent string for cache keys — see mesh/smora.ts. */
    _canonicalizeIntent(intent: string) {
        return smoraMod._canonicalizeIntent(this, intent);
    }
    /** @private Embed an intent with LRU caching — see mesh/smora.ts. */
    async _embedIntent(intent: string) {
        return smoraMod._embedIntent(this, intent);
    }
    /** @private Heritage bonus from cosine over intent vectors — see mesh/smora.ts. */
    _heritageBonusFromVectors(sessionVecs: any, chainVecs: any, denom: number) {
        return smoraMod._heritageBonusFromVectors(this, sessionVecs, chainVecs, denom);
    }
    /** @private LLM HyDE expansion with cache + timeout — see mesh/smora.ts. */
    async _generateHyDE(query: string): Promise<string> {
        return smoraMod._generateHyDE(this, query);
    }
    async getAll(options = {}) {
        await this.init();
        if (!this.client) {
            throw new Error("Database client not initialized");
        }
        return this.client.getAll(options);
    }
    async stats() {
        await this.init();
        if (!this.enableMemory || !this.client) {
            return {
                count: 0,
                totalMemories: 0,
                totalSkills: 0,
                tableName: "N/A",
                uri: "N/A",
                isConnected: false,
                embedding: { configured: false, primary: null as any, fallbacks: [] as any[] },
                status: "disabled",
            };
        }
        const dbStats = await this.client.getStats();
        // Enrich embedding stats with total persisted count
        const embeddingStats = this.embeddingFactory.getStats();
        if (embeddingStats.primary) {
            embeddingStats.primary.totalPersisted = dbStats.count;
        }
        // Get skill count
        let totalSkills = 0;
        if (this.skillTable) {
            try {
                const skills = await this.skillTable.query().limit(10000).toArray();
                totalSkills = skills.length;
            }
            catch (_e) {
                // Ignore errors
            }
        }
        return {
            count: dbStats.count,
            totalMemories: dbStats.count,
            totalSkills,
            tableName: dbStats.tableName,
            uri: dbStats.uri,
            isConnected: dbStats.isConnected,
            embedding: embeddingStats,
        };
    }
    _parseEmbeddingConfig() {
        const configs = [
            {
                modelType: process.env.EMBEDDING_MODEL_TYPE || "local",
                modelName: process.env.EMBEDDING_MODEL_NAME || "Xenova/all-MiniLM-L6-v2",
                dimension: parseInt(process.env.EMBEDDING_DIMENSION || "384"),
                priority: 1,
                apiKey: process.env.EMBEDDING_API_KEY ||
                    process.env.OPENAI_API_KEY ||
                    process.env.COHERE_API_KEY,
            },
        ];
        if (configs[0].modelType !== "local") {
            configs.push({
                modelType: "local",
                modelName: "Xenova/all-MiniLM-L6-v2",
                dimension: 384,
                priority: 2,
                apiKey: undefined,
            });
        }
        return configs;
    }
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
    async optimize() {
        return this.client?.optimize?.();
    }
    // eslint-disable-next-line @typescript-eslint/require-await
    async close() {
        try {
            // Close LanceDB client connection
            if (this.client) {
                this.client.disconnect();
                this.client = null;
            }
            // Clear extension table references
            this.yamoTable = null;
            this.skillTable = null;
            this.graphTable = null;
            // Reset initialization state
            this.isInitialized = false;
            logger.debug("MemoryMesh closed successfully");
        }
        catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            logger.warn({ err: e }, "Error closing MemoryMesh");
            // Don't throw - cleanup should always succeed
        }
    }

    /** @private Canonicalize an entity (lowercase, separators, plural-strip) — see mesh/graph-rag.ts. */
    _canonicalizeEntity(entity: string) {
        return graphRag._canonicalizeEntity(this, entity);
    }
    /** @private Does content mention the entity (canonical-aware) — see mesh/graph-rag.ts. */
    _contentMentions(content: string, entity: string) {
        return graphRag._contentMentions(this, content, entity);
    }
    /** @private Heuristic PascalCase triple extraction (off by default) — see mesh/graph-rag.ts. */
    _extractTriplesHeuristics(content: string) {
        return graphRag._extractTriplesHeuristics(this, content);
    }
    /** @private LLM triple extraction (recommended source) — see mesh/graph-rag.ts. */
    async _extractTriplesLLM(content: string) {
        return graphRag._extractTriplesLLM(this, content);
    }
    /** Merkle-anchor unanchored yamo_blocks rows — see mesh/yamo-audit.ts. */
    async anchor() {
        return yamoAudit.anchor(this);
    }
}
export default MemoryMesh;
