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
/**
 * MemoryMesh class for managing vector memory storage
 */
export declare class MemoryMesh {
    client: any;
    config: any;
    embeddingFactory: any;
    keywordSearch: any;
    isInitialized: any;
    vectorDimension: any;
    enableYamo: any;
    enableLLM: any;
    enableMemory: any;
    agentId: any;
    yamoTable: any;
    skillTable: any;
    graphTable: any;
    llmClient: any;
    scrubber: any;
    queryCache: any;
    cacheConfig: any;
    hydeCache: any;
    skillDirectories: any;
    dbDir: any;
    semanticInjection: any;
    /**
     * Create a new MemoryMesh instance
     * @param {Object} [options={}]
     */
    constructor(options?: {});
    /**
     * Generate a cache key from query and options
     * @private
     */
    _generateCacheKey(query: any, options?: {}): string;
    /**
     * Get cached result if valid
     * @private
     *
     * Race condition fix: The delete-then-set pattern for LRU tracking creates a window
     * where another operation could observe the key as missing. We use a try-finally
     * pattern to ensure atomicity at the application level.
     */
    _getCachedResult(key: any): any;
    /**
     * Cache a search result
     * @private
     */
    _cacheResult(key: any, result: any): void;
    /**
     * Clear all cached results
     */
    clearCache(): void;
    /**
     * Get cache statistics
     */
    getCacheStats(): {
        size: any;
        maxSize: any;
        ttlMs: any;
    };
    /**
     * Validate and sanitize metadata to prevent prototype pollution
     * @private
     */
    _validateMetadata(metadata: any): {};
    /**
     * Sanitize and validate content before storage
     * @private
     */
    _sanitizeContent(content: any): string;
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
    add(content: any, metadata?: {}): Promise<{
        id: any;
        content: string;
        metadata: {};
        created_at: string;
    }>;
    /**
     * Semantic alias for add().
     * @param content - The text content to store
     * @param metadata - Optional metadata
     * @returns Promise with memory record
     */
    ingest(content: any, metadata?: {}): Promise<{
        id: any;
        content: string;
        metadata: {};
        created_at: string;
    }>;
    /**
     * Reflect on recent memories
     */
    reflect(options?: {}): Promise<{
        topic: any;
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
        topic: any;
        reflection: string;
        confidence: number;
        sourceMemoryCount: number;
        yamoBlock: any;
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
    ingestSkill(yamoText: any, metadata: {}, sourceFilePath: any): Promise<{
        id: string;
        name: any;
        intent: any;
    }>;
    /**
     * Recursive Skill Synthesis
     */
    synthesize(options?: {}): Promise<{
        status: string;
        analysis: string;
        skill_id: string;
        skill_name: any;
        yamo_text: string;
        error?: undefined;
    } | {
        status: string;
        analysis: string;
        skill_name: any;
        skill_id?: undefined;
        yamo_text?: undefined;
        error?: undefined;
    } | {
        status: string;
        error: any;
        analysis: string;
        skill_id?: undefined;
        skill_name?: undefined;
        yamo_text?: undefined;
    } | {
        status: string;
        analysis: string;
        skill_id?: undefined;
        skill_name?: undefined;
        yamo_text?: undefined;
        error?: undefined;
    }>;
    /**
     * Update reliability
     */
    updateSkillReliability(id: any, success: any): Promise<{
        id: any;
        reliability: any;
        use_count: any;
    }>;
    /**
     * Get a single synthesized skill by ID
     * @param {string} id - Skill ID
     * @returns {Promise<Object|null>} Skill data or null if not found
     */
    getSkill(id: any): Promise<any>;
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
    listSkills(options?: {}): Promise<any>;
    /**
     * Search for synthesized skills by semantic intent
     * @param {string} query - Search query (intent description)
     * @param {Object} [options={}] - Search options
     * @returns {Promise<Array>} Normalized skill results
     */
    searchSkills(query: any, options?: {}): Promise<any>;
    /**
     * Get recent YAMO logs for the heartbeat
     * @param {Object} options
     */
    getYamoLog(options?: {}): Promise<any>;
    /**
     * Emit a YAMO block to the YAMO blocks table
     * @private
     *
     * Note: YAMO emission is non-critical - failures are logged but don't throw
     * to prevent disrupting the main operation.
     */
    _emitYamoBlock(operationType: any, memoryId: any, yamoText: any, heritage?: {
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
    search(query: any, options?: {}): Promise<any>;
    _applyGraphRagBoosting(results: any, query: any): Promise<any>;
    _keywordSearch(query: any, limit: any, filter?: any): Promise<any>;
    _normalizeScores(results: any): any;
    /**
     * Tokenize query for keyword matching (private helper for searchSkills)
     * Converts text to lowercase tokens, filtering out short tokens and punctuation.
     * Handles camelCase/PascalCase by splitting on uppercase letters.
     */
    _tokenizeQuery(text: any): any;
    formatResults(results: any): string;
    get(id: any): Promise<{
        id: any;
        content: any;
        metadata: any;
        created_at: any;
        updated_at: any;
    }>;
    /**
     * Delete a memory entry by ID.
     */
    delete(id: string): Promise<void>;
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
        embedding: any;
        status?: undefined;
    }>;
    _parseEmbeddingConfig(): {
        modelType: string;
        modelName: string;
        dimension: number;
        priority: number;
        apiKey: string;
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
    _canonicalizeEntity(entity: any): string;
    /**
     * Check if a content string mentions an entity using a case-insensitive
     * word-boundary regex with simple plural tolerance. Fixes the substring
     * false positives of the old `content.includes(entity)` check (where
     * "Auth" matched "AuthService" or "auth-token" matched "authorization").
     * @private
     */
    _contentMentions(content: any, entity: any): boolean;
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
    _extractTriplesHeuristics(content: any): any[];
    _extractTriplesLLM(content: any): Promise<{
        source: string;
        target: string;
        relation: string;
        weight: any;
    }[]>;
    anchor(): Promise<{
        root: string;
        count: any;
        updates: any[];
    }>;
}
/**
 * Main CLI handler
 */
export declare function run(): Promise<void>;
export default MemoryMesh;
