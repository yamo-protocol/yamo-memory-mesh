// @ts-nocheck
/**
 * Memory Mesh - Vector Memory Storage with LanceDB
 * Provides persistent semantic memory for YAMO OS using LanceDB backend
 *
 * CLI Interface:
 *   node tools/memory_mesh.js ingest '{"content": "...", "metadata": {...}}'
 *   node tools/memory_mesh.js search '{"query": "...", "limit": 10}'
 *   node tools/memory_mesh.js get '{"id": "..."}'
 *   node tools/memory_mesh.js delete '{"id": "..."}'
 *   node tools/memory_mesh.js stats '{}'
 *
 * Also supports STDIN input for YAMO skill compatibility:
 *   echo '{"action": "ingest", "content": "..."}' | node tools/memory_mesh.js
 */
import { fileURLToPath } from "url";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { LanceDBClient } from "./adapters/client.js";
import { getConfig } from "./adapters/config.js";
import { getEmbeddingDimension, createSynthesizedSkillSchema, } from "./schema.js";
import { handleError } from "./adapters/errors.js";
import EmbeddingFactory from "./embeddings/factory.js";
import { Scrubber } from "../scrubber/scrubber.js";
import { extractSkillIdentity, extractSkillTags, } from "../utils/skill-metadata.js";
import { KeywordSearch } from "./search/keyword-search.js";
import { YamoEmitter } from "../yamo/emitter.js";
import { LLMClient } from "../llm/client.js";
import * as lancedb from "@lancedb/lancedb";
import { createLogger } from "../utils/logger.js";
const logger = createLogger("brain");
/**
 * MemoryMesh class for managing vector memory storage
 */
export class MemoryMesh {
    client;
    config;
    embeddingFactory;
    keywordSearch;
    isInitialized;
    vectorDimension;
    enableYamo;
    enableLLM;
    enableMemory;
    agentId;
    yamoTable;
    skillTable;
    graphTable;
    llmClient;
    scrubber;
    queryCache;
    cacheConfig;
    hydeCache; // query → { text, timestamp } for LLM-generated HyDE expansions
    skillDirectories; // Store skill directories for synthesis
    dbDir; // Store custom dbDir for in-memory databases
    semanticInjection; // Prepend V5 topics/entities before embedding (Phase 5 Step 1)
    /**
     * Create a new MemoryMesh instance
     * @param {Object} [options={}]
     */
    constructor(options = {}) {
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
        // Store custom dbDir for test isolation
        this.dbDir = options.dbDir;
    }
    /**
     * Generate a cache key from query and options
     * @private
     */
    _generateCacheKey(query, options = {}) {
        const normalizedOptions = {
            limit: options.limit || 10,
            filter: options.filter || null,
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
    _getCachedResult(key) {
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
    _cacheResult(key, result) {
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
    /**
     * Validate and sanitize metadata to prevent prototype pollution
     * @private
     */
    _validateMetadata(metadata) {
        if (typeof metadata !== "object" || metadata === null) {
            throw new Error("Metadata must be a non-null object");
        }
        // Sanitize keys to prevent prototype pollution
        const sanitized = {};
        for (const [key, value] of Object.entries(metadata)) {
            // Skip dangerous keys that could pollute prototype
            if (key === "__proto__" || key === "constructor" || key === "prototype") {
                continue;
            }
            // Skip inherited properties
            if (!Object.prototype.hasOwnProperty.call(metadata, key)) {
                continue;
            }
            sanitized[key] = value;
        }
        return sanitized;
    }
    /**
     * Sanitize and validate content before storage
     * @private
     */
    _sanitizeContent(content) {
        if (typeof content !== "string") {
            throw new Error("Content must be a string");
        }
        // Limit content length
        const MAX_CONTENT_LENGTH = 100000; // 100KB limit
        if (content.length > MAX_CONTENT_LENGTH) {
            throw new Error(`Content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters`);
        }
        return content.trim();
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
                this.scrubber.stages.chunker.config.embedFn = async (text) => {
                    return this.embeddingFactory.embed(text);
                };
            }
            // Hydrate Keyword Search (In-Memory)
            if (this.client) {
                try {
                    const allRecords = await this.client.getAll({ limit: 10000 });
                    const activeRecords = allRecords.filter((r) => !r.superseded_at);
                    this.keywordSearch.load(activeRecords);
                }
                catch (_e) {
                    // Ignore if table doesn't exist yet
                }
            }
            // Initialize extension tables if enabled
            if (this.enableYamo && this.client && this.client.db) {
                try {
                    const { createYamoTable } = await import("../yamo/schema.js");
                    this.yamoTable = await createYamoTable(this.client.db, "yamo_blocks");
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
                        await this.skillTable.migrateManifestPathsV2();
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
            this.isInitialized = true;
        }
        catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            throw e;
        }
    }
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
    async add(content, metadata = {}) {
        await this.init();
        const type = metadata.type || "event";
        const enrichedMetadata = { ...metadata, type };
        try {
            let documentContext = metadata.documentContext || metadata.situatedContext || null;
            if (!documentContext && content && content.length > 0) {
                const title = metadata.title || metadata.source || metadata.sourceFilePath || null;
                if (title) {
                    documentContext = `From document/source: ${title}`;
                }
                else {
                    const firstLine = content.split('\n')[0].trim();
                    if (firstLine.startsWith('#')) {
                        documentContext = `From section: ${firstLine.replace(/^#+\s+/, '')}`;
                    }
                }
            }
            let processedContent = content;
            let scrubbedMetadata = {};
            try {
                const scrubbedResult = await this.scrubber.process({
                    content: content,
                    source: "memory-api",
                    type: "txt",
                    documentContext: documentContext,
                });
                if (scrubbedResult.success && scrubbedResult.chunks.length > 0) {
                    processedContent = scrubbedResult.chunks
                        .map((c) => c.text)
                        .join("\n\n");
                    if (scrubbedResult.metadata) {
                        scrubbedMetadata = {
                            ...scrubbedResult.metadata,
                            scrubber_telemetry: JSON.stringify(scrubbedResult.telemetry),
                        };
                    }
                }
            }
            catch (scrubError) {
                if (process.env.YAMO_DEBUG === "true") {
                    logger.error({ err: scrubError }, "Scrubber failed");
                }
            }
            // Mutable: agentic MERGE may rewrite sanitizedContent and re-embed.
            let sanitizedContent = this._sanitizeContent(processedContent);
            const sanitizedMetadata = this._validateMetadata({
                ...scrubbedMetadata,
                ...enrichedMetadata,
            });
            if (process.env.YAMO_DEBUG === "true") {
                console.error("[DEBUG] brain.add() scrubbedMetadata.type:", scrubbedMetadata.type);
                console.error("[DEBUG] brain.add() enrichedMetadata.type:", enrichedMetadata.type);
                console.error("[DEBUG] brain.add() sanitizedMetadata.type:", sanitizedMetadata.type);
            }
            // Semantic injection: prepend V5 fields before embedding so the vector
            // space clusters around explicit topics/entities (Phase 5 Step 1).
            let embeddingText = sanitizedContent;
            if (this.semanticInjection) {
                const topics = sanitizedMetadata.topics;
                const entities = sanitizedMetadata.entities;
                const parts = [];
                if (Array.isArray(topics) && topics.length > 0) {
                    parts.push(`[TOPICS: ${topics.join(", ")}]`);
                }
                if (Array.isArray(entities) && entities.length > 0) {
                    parts.push(`[ENTITIES: ${entities.join(", ")}]`);
                }
                if (parts.length > 0) {
                    embeddingText = `${parts.join(" ")} ${sanitizedContent}`;
                }
            }
            // Mutable: agentic MERGE may re-embed after rewriting content.
            let vector = await this.embeddingFactory.embed(embeddingText);
            // Three-zone routing against the nearest neighbor:
            //   similarity ≥ DEDUP_SIMILARITY_THRESHOLD (0.95)  → dedup short-circuit
            //   similarity ∈ [AGENTIC_OPS_GRAY_ZONE_MIN, threshold) → LLM judge
            //                                                        (only if enableAgenticOps)
            //   similarity < gray-zone min                     → plain ADD (fall through)
            //
            // Bypassed entirely when a higher-level idempotency mechanism owns it:
            //   - metadata.key            → belief-revision supersedes-by-key
            //   - metadata.replaces_memory_id → explicit replacement
            //   - metadata.lesson_pattern_id  → RFC-0011 lesson idempotency
            //   - metadata.skipDedup === true → caller opt-out
            const explicitVersioning = !!sanitizedMetadata.key ||
                !!sanitizedMetadata.replaces_memory_id ||
                !!sanitizedMetadata.lesson_pattern_id ||
                sanitizedMetadata.skipDedup === true;
            if (this.client && !explicitVersioning) {
                const nearest = await this.client.search(vector, { limit: 1 });
                if (nearest.length > 0) {
                    const threshold = parseFloat(process.env.DEDUP_SIMILARITY_THRESHOLD || '0.95');
                    const grayZoneMin = parseFloat(process.env.AGENTIC_OPS_GRAY_ZONE_MIN || '0.70');
                    // Adapter returns LanceDB cosine _distance in `score` (range [0, 2]
                    // for normalized embeddings). Convert to [0, 1] similarity.
                    const rawDistance = typeof nearest[0].score === 'number' ? nearest[0].score : 1.0;
                    const similarity = Math.max(0, Math.min(1, 1 - rawDistance / 2));
                    const isExactMatch = nearest[0].content === sanitizedContent;
                    if (isExactMatch || similarity >= threshold) {
                        // Zone 1: dedup
                        return {
                            id: nearest[0].id,
                            content: sanitizedContent,
                            metadata: sanitizedMetadata,
                            created_at: new Date().toISOString(),
                        };
                    }
                    if (this.enableAgenticOps && similarity >= grayZoneMin) {
                        // Zone 2: LLM judge — may rewrite sanitizedContent / vector
                        // and set sanitizedMetadata.replaces_memory_id.
                        const judgment = await this._judgeMemoryWrite(sanitizedContent, nearest[0]);
                        if (this.enableYamo) {
                            this._emitAgenticDecisionBlock(judgment, nearest[0].id, sanitizedContent).catch(() => { });
                        }
                        if (judgment.decision === 'NOOP') {
                            return {
                                id: nearest[0].id,
                                content: sanitizedContent,
                                metadata: sanitizedMetadata,
                                created_at: new Date().toISOString(),
                            };
                        }
                        if (judgment.decision === 'UPDATE') {
                            sanitizedMetadata.replaces_memory_id = nearest[0].id;
                        }
                        if (judgment.decision === 'MERGE' && judgment.mergedContent) {
                            sanitizedContent = this._sanitizeContent(judgment.mergedContent);
                            vector = await this.embeddingFactory.embed(sanitizedContent);
                            sanitizedMetadata.replaces_memory_id = nearest[0].id;
                        }
                        // ADD: fall through to insert path
                    }
                }
            }
            const id = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const record = {
                id,
                vector,
                content: sanitizedContent,
                metadata: JSON.stringify(sanitizedMetadata),
            };
            if (process.env.YAMO_DEBUG === "true") {
                console.error("[DEBUG] record.metadata.type:", JSON.parse(record.metadata).type);
            }
            if (!this.client) {
                throw new Error("Database client not initialized");
            }
            const result = await this.client.add(record);
            if (process.env.YAMO_DEBUG === "true") {
                try {
                    console.error("[DEBUG] result.metadata.type:", JSON.parse(result.metadata).type);
                }
                catch {
                    console.error("[DEBUG] result.metadata:", result.metadata);
                }
            }
            this.keywordSearch.add(record.id, record.content, sanitizedMetadata);
            // Invalidate cached search results — they predate this write.
            this.queryCache.clear();
            if (this.graphTable) {
                try {
                    let triples = [];
                    if (this.enableLLM && this.llmClient) {
                        triples = await this._extractTriplesLLM(sanitizedContent);
                    }
                    if (triples.length === 0) {
                        triples = this._extractTriplesHeuristics(sanitizedContent);
                    }
                    if (triples.length > 0) {
                        const edgeRecords = triples.map((t) => ({
                            id: `edge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                            source: t.source,
                            target: t.target,
                            relation: t.relation,
                            weight: t.weight,
                            created_at: new Date(),
                        }));
                        await this.graphTable.add(edgeRecords);
                    }
                }
                catch (graphError) {
                    if (process.env.YAMO_DEBUG === "true") {
                        logger.error({ err: graphError }, "Failed to extract or store Graph-RAG triples");
                    }
                }
            }
            // Epistemic Belief Revision
            if (this.client) {
                // 1. Direct replacement by replaces_memory_id
                if (sanitizedMetadata.replaces_memory_id) {
                    try {
                        const targetId = sanitizedMetadata.replaces_memory_id;
                        await this.client.update(targetId, {
                            superseded_at: new Date(),
                        });
                        this.keywordSearch.remove(targetId);
                    }
                    catch (e) {
                        if (process.env.YAMO_DEBUG === "true") {
                            logger.warn({ err: e, id: sanitizedMetadata.replaces_memory_id }, "Failed to mark memory as superseded by ID");
                        }
                    }
                }
                // 2. Semantic replacement by conflict tags (e.g. key)
                if (sanitizedMetadata.key) {
                    try {
                        const escapedKey = sanitizedMetadata.key.replace(/'/g, "''");
                        const activeRecords = await this.client.getWhere(`metadata LIKE '%"key":"${escapedKey}"%' AND superseded_at IS NULL`);
                        for (const r of activeRecords) {
                            if (r.id !== result.id) {
                                await this.client.update(r.id, {
                                    superseded_at: new Date(),
                                });
                                this.keywordSearch.remove(r.id);
                            }
                        }
                    }
                    catch (e) {
                        if (process.env.YAMO_DEBUG === "true") {
                            logger.warn({ err: e, key: sanitizedMetadata.key }, "Failed to mark memory as superseded by key");
                        }
                    }
                }
            }
            if (this.enableYamo) {
                this._emitYamoBlock("retain", result.id, YamoEmitter.buildRetainBlock({
                    content: sanitizedContent,
                    metadata: sanitizedMetadata,
                    id: result.id,
                    agentId: this.agentId,
                    memoryType: sanitizedMetadata.type || "event",
                })).catch((error) => {
                    // Log emission failures in debug mode but don't throw
                    if (process.env.YAMO_DEBUG === "true") {
                        logger.warn({ err: error }, "Failed to emit YAMO block (retain)");
                    }
                });
            }
            return {
                id: result.id,
                content: sanitizedContent,
                metadata: sanitizedMetadata,
                created_at: new Date().toISOString(),
            };
        }
        catch (error) {
            throw error instanceof Error ? error : new Error(String(error));
        }
    }
    /**
     * Semantic alias for add().
     * @param content - The text content to store
     * @param metadata - Optional metadata
     * @returns Promise with memory record
     */
    async ingest(content, metadata = {}) {
        return this.add(content, metadata);
    }
    /**
     * Reflect on recent memories
     */
    async reflect(options = {}) {
        await this.init();
        const lookback = options.lookback || 10;
        const topic = options.topic;
        const generate = options.generate !== false;
        let memories = [];
        if (topic) {
            memories = await this.search(topic, { limit: lookback });
        }
        else {
            const all = await this.getAll();
            memories = all
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                .slice(0, lookback);
        }
        const prompt = `Review these memories. Synthesize a high-level "belief" or "observation".`;
        if (!generate || !this.enableLLM || !this.llmClient) {
            return {
                topic,
                count: memories.length,
                context: memories.map((m) => ({
                    content: m.content,
                    type: m.metadata?.type || "event",
                    id: m.id,
                })),
                prompt,
            };
        }
        let reflection = "";
        let confidence = 0;
        try {
            const result = await this.llmClient.reflect(prompt, memories);
            reflection = result.reflection;
            confidence = result.confidence;
        }
        catch (_error) {
            reflection = `Aggregated from ${memories.length} memories on topic: ${topic || "general"}`;
            confidence = 0.5;
        }
        const reflectionId = `reflect_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
        await this.add(reflection, {
            type: "reflection",
            topic: topic || "general",
            source_memory_count: memories.length,
            confidence,
            generated_at: new Date().toISOString(),
        });
        let yamoBlock = null;
        if (this.enableYamo) {
            yamoBlock = YamoEmitter.buildReflectBlock({
                topic: topic || "general",
                memoryCount: memories.length,
                agentId: this.agentId,
                reflection,
                confidence,
            });
            await this._emitYamoBlock("reflect", reflectionId, yamoBlock);
        }
        return {
            id: reflectionId,
            topic: topic || "general",
            reflection,
            confidence,
            sourceMemoryCount: memories.length,
            yamoBlock,
            createdAt: new Date().toISOString(),
        };
    }
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
    async addDocument(content, metadata = {}, options = {}) {
        await this.init();
        if (typeof content !== 'string' || content.trim().length === 0) {
            throw new Error('addDocument requires non-empty string content');
        }
        const minChars = options.minChunkChars ?? 200;
        const maxChars = options.maxChunkChars ?? 2000;
        // Single-shot fallback: small docs go through add() unchanged.
        if (content.length <= maxChars) {
            const mem = await this.add(content, metadata);
            return { documentId: mem.id, chunks: 1, ids: [mem.id], lateChunked: false };
        }
        const spans = this._splitParagraphSpans(content, minChars, maxChars);
        if (spans.length <= 1) {
            const mem = await this.add(content, metadata);
            return { documentId: mem.id, chunks: 1, ids: [mem.id], lateChunked: false };
        }
        const documentId = `doc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        // Late Chunking: try to compute all chunk vectors in one forward pass
        // over the full document. Returns null on unsupported model / failure.
        let lateVectors = null;
        const shouldLateChunk = options.lateChunk !== false;
        if (shouldLateChunk) {
            lateVectors = await this.embeddingFactory.embedLateChunked(content, spans);
            if (lateVectors && lateVectors.length !== spans.length) {
                // Defensive: mismatch means we can't trust the vectors.
                lateVectors = null;
            }
        }
        const ids = [];
        for (let i = 0; i < spans.length; i++) {
            const span = spans[i];
            const chunkText = content.slice(span.start, span.end).trim();
            if (chunkText.length === 0)
                continue;
            const chunkMetadata = {
                ...metadata,
                document_id: documentId,
                document_chunk_index: i,
                document_chunk_count: spans.length,
                late_chunked: !!lateVectors,
                // skipDedup: chunks of one document are intentionally similar
                // (shared themes); content-level dedup would collapse them.
                skipDedup: true,
            };
            if (lateVectors) {
                // Late-chunked path: store with pre-computed vector. We bypass
                // mesh.add()'s embed step and write directly via client.add().
                const id = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const record = {
                    id,
                    vector: lateVectors[i],
                    content: chunkText,
                    metadata: JSON.stringify(this._validateMetadata(chunkMetadata)),
                };
                if (!this.client)
                    throw new Error('Database client not initialized');
                const result = await this.client.add(record);
                this.keywordSearch?.add?.(result.id, chunkText, chunkMetadata);
                ids.push(result.id);
            }
            else {
                // Fallback: per-chunk add() (loses cross-chunk context but works).
                const mem = await this.add(chunkText, chunkMetadata);
                ids.push(mem.id);
            }
        }
        // The late-chunk path writes directly via client.add(), bypassing the
        // cache clear in add(). Do it here so cached searches don't go stale.
        this.queryCache.clear();
        return { documentId, chunks: ids.length, ids, lateChunked: !!lateVectors };
    }
    /**
     * Split a document into paragraph-based spans of (start, end) char
     * offsets, merging short paragraphs to honor minChars and forcing breaks
     * when exceeding maxChars. Spans are non-overlapping, ordered, and cover
     * the full content.
     * @private
     */
    _splitParagraphSpans(content, minChars, maxChars) {
        const spans = [];
        const paraRegex = /\n\n+/g;
        const paraStarts = [0];
        let m;
        while ((m = paraRegex.exec(content)) !== null) {
            paraStarts.push(m.index + m[0].length);
        }
        paraStarts.push(content.length);
        // paraStarts[i]..paraStarts[i+1] (minus trailing blank) defines paragraph i
        let chunkStart = 0;
        let chunkEnd = 0;
        for (let i = 0; i < paraStarts.length - 1; i++) {
            const paraStart = paraStarts[i];
            const paraEnd = paraStarts[i + 1];
            const currentLen = chunkEnd - chunkStart;
            const wouldBeLen = paraEnd - chunkStart;
            if (currentLen === 0) {
                chunkStart = paraStart;
                chunkEnd = paraEnd;
            }
            else if (currentLen >= minChars && wouldBeLen > maxChars) {
                // Flush current chunk, start fresh
                spans.push({ start: chunkStart, end: chunkEnd });
                chunkStart = paraStart;
                chunkEnd = paraEnd;
            }
            else {
                chunkEnd = paraEnd;
            }
        }
        if (chunkEnd > chunkStart)
            spans.push({ start: chunkStart, end: chunkEnd });
        return spans;
    }
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
    async raptor(options = {}) {
        await this.init();
        const out = { levelsBuilt: 0, summariesCreated: 0, perLevel: [], treeRootId: undefined };
        if (!this.enableLLM || !this.llmClient) {
            if (process.env.YAMO_DEBUG === 'true') {
                logger.debug('raptor() skipped: LLM disabled');
            }
            return out;
        }
        const { topic, limit = 100, maxLevels = 3, branchingFactor = 5, minClusterSize = 2, } = options;
        // Seed leaves. LanceDB returns vectors as Float32Array; normalize to
        // a plain number[] so downstream math is straightforward.
        const toArray = (v) => {
            if (!v || typeof v.length !== 'number' || v.length === 0)
                return null;
            return Array.isArray(v) ? v : Array.from(v);
        };
        let currentLayer = [];
        if (topic) {
            // Topic-scoped: use vector search to gather thematically related leaves
            const hits = await this.search(topic, { limit, mode: 'vector', useCache: false });
            for (const h of hits) {
                const rec = this.client ? await this.client.getById(h.id) : null;
                const vector = rec ? toArray(rec.vector) : null;
                if (vector) {
                    currentLayer.push({ id: h.id, content: h.content, vector });
                }
            }
        }
        else {
            const all = await this.getAll({ limit });
            for (const r of all) {
                const vector = toArray(r.vector);
                if (vector) {
                    currentLayer.push({ id: r.id, content: r.content, vector });
                }
            }
        }
        if (currentLayer.length === 0)
            return out;
        for (let level = 1; level <= maxLevels; level++) {
            // Terminal case: small enough to collapse into a single root
            if (currentLayer.length <= branchingFactor) {
                const root = await this._summarizeCluster(currentLayer, level);
                if (root) {
                    out.treeRootId = root.id;
                    out.summariesCreated++;
                    out.perLevel.push({ level, clusters: 1, summaries: 1 });
                    out.levelsBuilt++;
                }
                break;
            }
            const k = Math.max(2, Math.ceil(currentLayer.length / branchingFactor));
            const clusters = this._kmeansClusters(currentLayer, k);
            const eligible = clusters.filter((c) => c.length >= minClusterSize);
            const summaries = await Promise.all(eligible.map((c) => this._summarizeCluster(c, level)));
            const validSummaries = summaries.filter((s) => s !== null);
            out.summariesCreated += validSummaries.length;
            out.perLevel.push({ level, clusters: clusters.length, summaries: validSummaries.length });
            out.levelsBuilt++;
            if (validSummaries.length === 0)
                break;
            currentLayer = validSummaries;
        }
        return out;
    }
    /**
     * K-means clustering with cosine distance. Vectors are assumed L2-normalized
     * (which they are — embedding service normalizes on output), so cosine
     * similarity is the dot product and centroids stay on the unit hypersphere
     * after mean + renormalize. Random-init centroids; k-means++ would be
     * better for stability but is overkill for this use case.
     * @private
     */
    _kmeansClusters(items, k, maxIters = 50) {
        if (items.length === 0)
            return [];
        if (k >= items.length)
            return items.map((it) => [it]);
        const dim = items[0].vector.length;
        // Initialize with k random distinct items.
        const centroids = [];
        const used = new Set();
        while (centroids.length < k) {
            const idx = Math.floor(Math.random() * items.length);
            if (used.has(idx))
                continue;
            used.add(idx);
            centroids.push([...items[idx].vector]);
        }
        const dot = (a, b) => {
            let s = 0;
            for (let i = 0; i < a.length; i++)
                s += a[i] * b[i];
            return s;
        };
        const assignments = new Array(items.length).fill(0);
        for (let iter = 0; iter < maxIters; iter++) {
            let changed = false;
            for (let i = 0; i < items.length; i++) {
                let best = 0;
                let bestSim = -Infinity;
                for (let c = 0; c < k; c++) {
                    const sim = dot(items[i].vector, centroids[c]);
                    if (sim > bestSim) {
                        bestSim = sim;
                        best = c;
                    }
                }
                if (assignments[i] !== best) {
                    assignments[i] = best;
                    changed = true;
                }
            }
            if (!changed)
                break;
            // Update centroids: mean of assigned vectors, then L2-normalize.
            for (let c = 0; c < k; c++) {
                const sum = new Array(dim).fill(0);
                let count = 0;
                for (let i = 0; i < items.length; i++) {
                    if (assignments[i] !== c)
                        continue;
                    for (let d = 0; d < dim; d++)
                        sum[d] += items[i].vector[d];
                    count++;
                }
                if (count === 0)
                    continue;
                const mean = sum.map((v) => v / count);
                const mag = Math.sqrt(mean.reduce((s, v) => s + v * v, 0));
                centroids[c] = mag > 0 ? mean.map((v) => v / mag) : mean;
            }
        }
        const clusters = Array.from({ length: k }, () => []);
        for (let i = 0; i < items.length; i++) {
            clusters[assignments[i]].push(items[i]);
        }
        return clusters.filter((c) => c.length > 0);
    }
    /**
     * LLM-summarize a cluster of memories and store the summary as a memory
     * with type=summary_l{level} and source_memory_ids linking back to leaves.
     * skipDedup is set so the summary doesn't get collapsed against the very
     * memories it summarizes.
     * @private
     */
    async _summarizeCluster(cluster, level) {
        if (!cluster || cluster.length === 0)
            return null;
        // Singleton: promote the item as-is to the next level. Avoids burning
        // an LLM call on a no-op summary.
        if (cluster.length === 1) {
            return cluster[0].vector
                ? { id: cluster[0].id, content: cluster[0].content, vector: cluster[0].vector }
                : null;
        }
        if (!this.enableLLM || !this.llmClient)
            return null;
        const timeoutMs = parseInt(process.env.RAPTOR_TIMEOUT_MS || '15000', 10);
        const systemPrompt = 'You are a summarization agent. Given several related memory entries, produce a concise abstractive summary (2-4 sentences) that captures the key information and shared themes. Synthesize — do not list verbatim. Output only the summary text, no preamble or commentary.';
        const userPrompt = cluster.map((m, i) => `[${i + 1}] ${m.content}`).join('\n\n');
        let timeoutHandle;
        let summary;
        try {
            const timeoutPromise = new Promise((_, reject) => {
                timeoutHandle = setTimeout(() => reject(new Error('RAPTOR summarize timeout')), timeoutMs);
            });
            const response = await Promise.race([
                this.llmClient.complete(systemPrompt, userPrompt),
                timeoutPromise,
            ]);
            summary = typeof response === 'string' ? response.trim() : '';
        }
        catch (error) {
            if (process.env.YAMO_DEBUG === 'true') {
                logger.debug({ err: error, clusterSize: cluster.length, level }, 'RAPTOR summarization failed');
            }
            return null;
        }
        finally {
            if (timeoutHandle)
                clearTimeout(timeoutHandle);
        }
        if (!summary)
            return null;
        try {
            const mem = await this.add(summary, {
                type: `summary_l${level}`,
                source_memory_ids: cluster.map((c) => c.id),
                cluster_size: cluster.length,
                generated_by: 'raptor',
                generated_at: new Date().toISOString(),
                skipDedup: true,
            });
            // We need the stored vector for the next clustering round. Use the
            // embedding cache rather than a second DB round-trip.
            const vector = await this.embeddingFactory.embed(summary);
            return { id: mem.id, content: summary, vector };
        }
        catch (error) {
            if (process.env.YAMO_DEBUG === 'true') {
                logger.debug({ err: error, level }, 'RAPTOR summary ingest failed');
            }
            return null;
        }
    }
    /**
     * Ingest synthesized skill
     * @param sourceFilePath - If provided, skip file write (file already exists)
     */
    async ingestSkill(yamoText, metadata = {}, sourceFilePath) {
        await this.init();
        if (!this.skillTable) {
            throw new Error("Skill table not initialized");
        }
        // DEBUG: Trace sourceFilePath parameter
        if (process.env.YAMO_DEBUG_PATHS === "true") {
            console.error(`[BRAIN.ingestSkill] sourceFilePath parameter: ${sourceFilePath || "undefined"}`);
        }
        try {
            const identity = extractSkillIdentity(yamoText);
            const name = metadata.name || identity.name;
            const intent = metadata.intent || identity.intent;
            const description = metadata.description || identity.description;
            // RECURSION DETECTION: Check for recursive naming patterns
            // Patterns like "SkillSkill", "SkillSkillSkill" indicate filename-derived names
            const recursivePattern = /^(Skill|skill){2,}/;
            if (recursivePattern.test(name)) {
                logger.warn({ originalName: name }, "Detected recursive naming pattern, rejecting ingestion to prevent loop");
                throw new Error(`Recursive naming pattern detected: ${name}. Skills must have proper name: field.`);
            }
            // Extract tags for tag-aware embeddings (improves semantic search)
            const tags = extractSkillTags(yamoText);
            const tagText = tags.length > 0 ? `\nTags: ${tags.join(", ")}` : "";
            const embeddingText = `Skill: ${name}\nIntent: ${intent}${tagText}\nDescription: ${description}`;
            const vector = await this.embeddingFactory.embed(embeddingText);
            const id = `skill_${Date.now()}_${crypto.randomBytes(2).toString("hex")}`;
            const skillMetadata = {
                reliability: 0.5,
                use_count: 0,
                source: "manual",
                ...metadata,
                // Store source file path for policy loading and parent discovery
                ...(sourceFilePath && { source_file: sourceFilePath }),
            };
            const record = {
                id,
                name,
                intent,
                yamo_text: yamoText,
                vector,
                metadata: JSON.stringify(skillMetadata),
                created_at: new Date(),
            };
            await this.skillTable.add([record]);
            // NEW: Persist to filesystem for longevity and visibility
            // Skip if sourceFilePath provided (file already exists from SkillCreator)
            // Skip if using in-memory database (:memory:)
            if (!sourceFilePath && this.dbDir !== ":memory:") {
                try {
                    const skillsDir = path.resolve(process.cwd(), this.skillDirectories[0] || "skills");
                    if (!fs.existsSync(skillsDir)) {
                        fs.mkdirSync(skillsDir, { recursive: true });
                    }
                    // Robust filename with length limit to prevent ENAMETOOLONG
                    const safeName = name
                        .toLowerCase()
                        .replace(/[^a-z0-9]/g, "-")
                        .replace(/-+/g, "-")
                        .substring(0, 50);
                    const fileName = `skill-${safeName}.md`;
                    const filePath = path.join(skillsDir, fileName);
                    // Only write if file doesn't already exist to prevent duplicates
                    if (!fs.existsSync(filePath)) {
                        fs.writeFileSync(filePath, yamoText, "utf8");
                        if (process.env.YAMO_DEBUG === "true") {
                            logger.debug({ filePath }, "Skill persisted to file");
                        }
                    }
                }
                catch (fileError) {
                    logger.warn({ err: fileError }, "Failed to persist skill to file");
                }
            }
            return { id, name, intent };
        }
        catch (error) {
            throw new Error(`Skill ingestion failed: ${error.message}`);
        }
    }
    /**
     * Recursive Skill Synthesis
     */
    async synthesize(options = {}) {
        await this.init();
        const topic = options.topic || "general_improvement";
        const enrichedPrompt = options.enrichedPrompt || topic; // PHASE 4: Use enriched prompt
        const mode = options.mode || "create";
        const targetSkillId = options.targetSkillId;
        // const lookback = options.lookback || 20;
        logger.info({ topic, mode, targetSkillId }, "Synthesizing logic");
        // OPTIMIZATION: If we have an execution engine (kernel), use SkillCreator!
        if (this._kernel_execute) {
            logger.info("Dispatching to SkillCreator agent...");
            try {
                // Fetch target skill content if refactoring
                let targetContent = "";
                let targetPath = "";
                if (mode === "refactor" && targetSkillId) {
                    const skill = await this.getSkill(targetSkillId);
                    if (skill) {
                        targetPath = skill.metadata?.source_file || "";
                        if (targetPath && fs.existsSync(targetPath)) {
                            targetContent = fs.readFileSync(targetPath, "utf8");
                        }
                        else {
                            // Fallback to DB content if file missing
                            targetContent = skill.yamo_text || "";
                        }
                    }
                }
                // Use stored skill directories
                const skillDirs = this.skillDirectories;
                // Track existing skill files (.md and legacy .yamo) before SkillCreator runs
                const filesBefore = new Set();
                for (const dir of skillDirs) {
                    if (fs.existsSync(dir)) {
                        const walk = (currentDir) => {
                            try {
                                const entries = fs.readdirSync(currentDir, {
                                    withFileTypes: true,
                                });
                                for (const entry of entries) {
                                    const fullPath = path.join(currentDir, entry.name);
                                    if (entry.isDirectory()) {
                                        walk(fullPath);
                                    }
                                    else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".yamo"))) {
                                        filesBefore.add(fullPath);
                                    }
                                }
                            }
                            catch (e) {
                                // Skip directories we can't read
                                logger.debug({ dir, error: e }, "Could not read directory");
                            }
                        };
                        walk(dir);
                    }
                }
                // PHASE 4: Use enriched prompt for SkillCreator
                let prompt = `SkillCreator: design a new skill to handle ${enrichedPrompt}`;
                if (mode === "refactor" && targetContent) {
                    prompt = `SkillCreator: REFACTOR and FIX the following skill. It failed with the following context: ${enrichedPrompt}.\n\nEXISTING SKILL CONTENT:\n${targetContent}`;
                }
                await this._kernel_execute(prompt, {
                    v1_1_enabled: true,
                });
                // Find newly created skill file (.md or legacy .yamo)
                let newSkillFile;
                for (const dir of skillDirs) {
                    if (fs.existsSync(dir)) {
                        const walk = (currentDir) => {
                            try {
                                const entries = fs.readdirSync(currentDir, {
                                    withFileTypes: true,
                                });
                                for (const entry of entries) {
                                    const fullPath = path.join(currentDir, entry.name);
                                    if (entry.isDirectory()) {
                                        walk(fullPath);
                                    }
                                    else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".yamo"))) {
                                        if (!filesBefore.has(fullPath)) {
                                            newSkillFile = fullPath;
                                        }
                                    }
                                }
                            }
                            catch (e) {
                                logger.debug({ dir, error: e }, "Could not read directory");
                            }
                        };
                        walk(dir);
                    }
                }
                // Ingest the newly created skill file
                if (newSkillFile) {
                    logger.info({ skillFile: newSkillFile }, "Ingesting newly synthesized skill");
                    let skillContent = fs.readFileSync(newSkillFile, "utf8");
                    // PHASE 4: Expand compressed → canonical for disk storage
                    // Skills created by evolution are typically compressed; expand to canonical for readability
                    // Skip expansion in test environment or when disabled
                    const expansionEnabled = process.env.YAMO_EXPANSION_ENABLED !== "false";
                    const isCompressed = !skillContent.includes("---") ||
                        (skillContent.includes("---") &&
                            skillContent.split("---").length <= 1);
                    if (expansionEnabled && isCompressed) {
                        logger.info({ skillFile: newSkillFile }, "Expanding compressed skill to canonical format");
                        try {
                            const expanded = await this._kernel_execute("skill-expansion-system-prompt.md", {
                                input_yamo: skillContent,
                            });
                            if (expanded && expanded.canonical_yamo) {
                                skillContent = expanded.canonical_yamo;
                                // Write expanded canonical format back to disk
                                fs.writeFileSync(newSkillFile, skillContent, "utf8");
                                logger.info({ skillFile: newSkillFile }, "Skill expanded to canonical format on disk");
                            }
                        }
                        catch (e) {
                            logger.warn({ err: e }, "Failed to expand skill to canonical, using compressed format");
                        }
                    }
                    // ENSURE: Synthesized skills always have proper metadata with meaningful name
                    // This prevents duplicate skill-agent-{timestamp}.md files
                    const synIdentity = extractSkillIdentity(skillContent);
                    const hasName = !synIdentity.name.startsWith("Unnamed_");
                    if (!skillContent.includes("---") || !hasName) {
                        logger.info({ skillFile: newSkillFile }, "Adding metadata block to synthesized skill");
                        const intent = synIdentity.intent !== "general_procedure"
                            ? synIdentity.intent.replace(/[^a-zA-Z0-9]/g, "")
                            : "Synthesized";
                        const PascalCase = intent.charAt(0).toUpperCase() + intent.slice(1);
                        const skillName = `${PascalCase}_${Date.now().toString(36)}`;
                        const metadata = `---
name: ${skillName}
version: 1.0.0
author: YAMO Evolution
license: MIT
tags: synthesized, evolution, auto-generated
description: Auto-generated skill to handle: ${enrichedPrompt || topic}
---
`;
                        // Prepend metadata if skill doesn't have it
                        if (!skillContent.startsWith("---")) {
                            skillContent = metadata + skillContent;
                            // Write back to disk with proper metadata
                            fs.writeFileSync(newSkillFile, skillContent, "utf8");
                            logger.info({ skillFile: newSkillFile, skillName }, "Added metadata block to synthesized skill");
                        }
                    }
                    const skill = await this.ingestSkill(skillContent, {
                        source: "synthesized",
                        trigger_topic: topic,
                    }, newSkillFile);
                    return {
                        status: "success",
                        analysis: "SkillCreator orchestrated evolution",
                        skill_id: skill.id,
                        skill_name: skill.name,
                        yamo_text: skillContent,
                    };
                }
                // Fallback if no new file found
                return {
                    status: "success",
                    analysis: "SkillCreator orchestrated evolution (no file detected)",
                    skill_name: topic.split(" ")[0],
                };
            }
            catch (e) {
                logger.error({ err: e }, "SkillCreator agent failed");
                return {
                    status: "error",
                    error: e.message,
                    analysis: "SkillCreator agent failed",
                };
            }
        }
        // SkillCreator is required for synthesis
        if (!this._kernel_execute) {
            throw new Error("Kernel execution (_kernel_execute) is required for synthesis. Use YamoKernel instead of MemoryMesh directly.");
        }
        // Should never reach here
        return {
            status: "error",
            analysis: "Unexpected state in synthesis",
        };
    }
    /**
     * Update reliability
     */
    async updateSkillReliability(id, success) {
        await this.init();
        if (!this.skillTable) {
            throw new Error("Skill table not initialized");
        }
        try {
            const results = await this.skillTable
                .query()
                .filter(`id == '${id}'`)
                .toArray();
            if (results.length === 0) {
                throw new Error(`Skill ${id} not found`);
            }
            const record = results[0];
            const metadata = JSON.parse(record.metadata);
            const adjustment = success ? 0.1 : -0.2;
            metadata.reliability = Math.max(0, Math.min(1.0, (metadata.reliability || 0.5) + adjustment));
            metadata.use_count = (metadata.use_count || 0) + 1;
            metadata.last_used = new Date().toISOString();
            await this.skillTable.update({
                where: `id == '${id}'`,
                values: { metadata: JSON.stringify(metadata) },
            });
            return {
                id,
                reliability: metadata.reliability,
                use_count: metadata.use_count,
            };
        }
        catch (error) {
            throw new Error(`Failed to update skill reliability: ${error.message}`);
        }
    }
    /**
     * Get a single synthesized skill by ID
     * @param {string} id - Skill ID
     * @returns {Promise<Object|null>} Skill data or null if not found
     */
    async getSkill(id) {
        await this.init();
        if (!this.skillTable) {
            return null;
        }
        try {
            const results = await this.skillTable
                .query()
                .filter(`id == '${id}'`)
                .toArray();
            if (results.length === 0) {
                return null;
            }
            const record = results[0];
            return {
                ...record,
                metadata: typeof record.metadata === "string"
                    ? JSON.parse(record.metadata)
                    : record.metadata,
            };
        }
        catch (error) {
            logger.warn({ err: error, id }, "Failed to get skill");
            return null;
        }
    }
    /**
     * Prune skills
     */
    async pruneSkills(threshold = 0.3) {
        await this.init();
        if (!this.skillTable) {
            throw new Error("Skill table not initialized");
        }
        try {
            const allSkills = await this.skillTable.query().toArray();
            let prunedCount = 0;
            for (const skill of allSkills) {
                const metadata = JSON.parse(skill.metadata);
                if (metadata.reliability < threshold) {
                    await this.skillTable.delete(`id == '${skill.id}'`);
                    prunedCount++;
                }
            }
            return {
                pruned_count: prunedCount,
                total_remaining: allSkills.length - prunedCount,
            };
        }
        catch (error) {
            throw new Error(`Pruning failed: ${error.message}`);
        }
    }
    /**
     * List all synthesized skills
     * @param {Object} [options={}] - Search options
     * @returns {Promise<Array>} Normalized skill results
     */
    async listSkills(options = {}) {
        await this.init();
        if (!this.skillTable) {
            return [];
        }
        try {
            const limit = options.limit || 10;
            const results = await this.skillTable.query().limit(limit).toArray();
            return results.map((r) => ({
                ...r,
                score: 1.0, // Full score for direct listing
                // Parse metadata JSON string to object
                metadata: typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata,
            }));
        }
        catch (error) {
            if (process.env.YAMO_DEBUG === "true") {
                logger.error({ err: error }, "Skill list failed");
            }
            return [];
        }
    }
    /**
     * Search for synthesized skills by semantic intent
     * @param {string} query - Search query (intent description)
     * @param {Object} [options={}] - Search options
     * @returns {Promise<Array>} Normalized skill results
     */
    async searchSkills(query, options = {}) {
        await this.init();
        if (!this.skillTable) {
            return [];
        }
        try {
            // 1. Check for explicit skill targeting (e.g., "Architect: ...")
            const explicitMatch = query.match(/^([a-zA-Z0-9_-]+):/);
            if (explicitMatch) {
                const targetName = explicitMatch[1];
                const directResults = await this.skillTable
                    .query()
                    .where(`name == '${targetName}'`)
                    .limit(1)
                    .toArray();
                if (directResults.length > 0) {
                    return directResults.map((r) => ({
                        ...r,
                        score: 1.0, // Maximum score for explicit target
                    }));
                }
            }
            // 2. Hybrid search: vector + keyword matching
            const limit = options.limit || 5;
            const queryTokens = this._tokenizeQuery(query);
            // 2a. Vector search (get more candidates for fusion)
            const vector = await this.embeddingFactory.embed(query, { isQuery: true });
            const vectorResults = await this.skillTable
                .search(vector)
                .limit(limit * 3)
                .toArray();
            // 2b. Parallel Keyword search at database level using LIKE expression
            let keywordResults = [];
            if (queryTokens.length > 0) {
                const escapedTokens = queryTokens.map(t => t.replace(/'/g, "''"));
                const filterExpr = escapedTokens
                    .map(t => `(name LIKE '%${t}%' OR intent LIKE '%${t}%' OR yamo_text LIKE '%${t}%')`)
                    .join(" OR ");
                try {
                    keywordResults = await this.skillTable
                        .query()
                        .where(filterExpr)
                        .limit(limit * 3)
                        .toArray();
                }
                catch (err) {
                    if (process.env.YAMO_DEBUG === "true") {
                        logger.warn({ err }, "Keyword search query in searchSkills failed");
                    }
                }
            }
            // 2c. Merge and deduplicate candidates
            const allCandidates = [...vectorResults, ...keywordResults];
            const uniqueCandidates = [];
            const seenIds = new Set();
            for (const c of allCandidates) {
                if (!seenIds.has(c.id)) {
                    seenIds.add(c.id);
                    uniqueCandidates.push(c);
                }
            }
            // 2d. Compute keyword match score for all candidates
            const keywordScores = new Map();
            let maxKeywordScore = 0;
            for (const result of uniqueCandidates) {
                let score = 0;
                const nameTokens = this._tokenizeQuery(result.name);
                const intentTokens = this._tokenizeQuery(result.intent || "");
                const tags = extractSkillTags(result.yamo_text);
                const tagTokens = tags.flatMap((t) => this._tokenizeQuery(t));
                const descTokens = this._tokenizeQuery(result.yamo_text.substring(0, 500)); // First 500 chars
                // Token matching with field-based weights
                // Support both exact and partial matches (for compound words)
                for (const qToken of queryTokens) {
                    // Exact or partial match in name
                    if (nameTokens.some((nt) => nt === qToken || qToken.includes(nt) || nt.includes(qToken))) {
                        score += 10.0; // Highest: name match
                    }
                    // Exact or partial match in tags
                    if (tagTokens.some((tt) => tt === qToken || qToken.includes(tt) || tt.includes(qToken))) {
                        score += 7.0; // High: tag match
                    }
                    // Exact match in intent
                    if (intentTokens.some((it) => it === qToken)) {
                        score += 5.0; // Medium: intent match
                    }
                    // Exact match in description
                    if (descTokens.some((dt) => dt === qToken)) {
                        score += 1.0; // Low: description match
                    }
                }
                if (score > 0) {
                    keywordScores.set(result.id, score);
                    maxKeywordScore = Math.max(maxKeywordScore, score);
                }
            }
            // Sort unique candidates by computed keyword score for RRF ranking
            const keywordRanked = [...uniqueCandidates]
                .filter(c => keywordScores.has(c.id))
                .sort((a, b) => (keywordScores.get(b.id) || 0) - (keywordScores.get(a.id) || 0));
            // 2e. Apply Reciprocal Rank Fusion (RRF)
            const k = 60;
            const rrfScores = new Map();
            const skillMap = new Map();
            function applyRRF(list, weight) {
                for (let rank = 0; rank < list.length; rank++) {
                    const skill = list[rank];
                    if (!skill?.id)
                        continue;
                    rrfScores.set(skill.id, (rrfScores.get(skill.id) || 0) + weight / (k + rank + 1));
                    if (!skillMap.has(skill.id))
                        skillMap.set(skill.id, skill);
                }
            }
            applyRRF(vectorResults, 0.4);
            applyRRF(keywordRanked, 0.6);
            // 2f. Build fused results with combined score compatibility
            const fusedResults = Array.from(rrfScores.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([id]) => {
                const r = skillMap.get(id);
                // Find vector similarity: 1 - distance / 2
                const vecMatch = vectorResults.find((v) => v.id === id);
                const rawDistance = vecMatch && vecMatch._distance !== undefined ? vecMatch._distance : 1.0;
                const vectorScore = Math.max(0, Math.min(1.0, 1 - rawDistance / 2));
                const keywordScore = keywordScores.get(id) || 0;
                const normalizedKeyword = maxKeywordScore > 0 ? keywordScore / maxKeywordScore : 0;
                const combinedScore = 0.7 * normalizedKeyword + 0.3 * vectorScore;
                return {
                    ...r,
                    score: combinedScore,
                    _vectorScore: vectorScore,
                    _keywordScore: keywordScore,
                };
            });
            // Sort by combined score and return top results
            // Don't normalize - we already calculated hybrid scores
            return fusedResults
                .sort((a, b) => b.score - a.score)
                .slice(0, limit)
                .map((r) => ({
                ...r,
                // Parse metadata JSON string to object for policy loading
                metadata: typeof r.metadata === "string"
                    ? JSON.parse(r.metadata)
                    : r.metadata,
            }))
                .map((r) => ({
                ...r,
                score: parseFloat(r.score.toFixed(2)), // Round for consistency
            }));
        }
        catch (error) {
            if (process.env.YAMO_DEBUG === "true") {
                logger.error({ err: error }, "Skill search failed");
            }
            return [];
        }
    }
    /**
     * Get recent YAMO logs for the heartbeat
     * @param {Object} options
     */
    async getYamoLog(options = {}) {
        if (!this.yamoTable) {
            return [];
        }
        const limit = options.limit || 10;
        const maxRetries = 5;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // orderBy might not be in LanceDB types but is supported in runtime
                const query = this.yamoTable.query();
                let results;
                try {
                    results = await query
                        .orderBy("timestamp", "desc")
                        .limit(limit)
                        .toArray();
                }
                catch (_e) {
                    // Fallback if orderBy not supported
                    results = await query.limit(1000).toArray(); // Get more and sort manually
                }
                // Sort newest first in memory
                return results
                    .sort((a, b) => {
                    const tA = a.timestamp instanceof Date
                        ? a.timestamp.getTime()
                        : Number(a.timestamp);
                    const tB = b.timestamp instanceof Date
                        ? b.timestamp.getTime()
                        : Number(b.timestamp);
                    return tB - tA;
                })
                    .slice(0, limit)
                    .map((r) => ({
                    id: r.id,
                    yamoText: r.yamo_text,
                    timestamp: r.timestamp,
                }));
            }
            catch (error) {
                const msg = error.message || "";
                const isRetryable = msg.includes("LanceError(IO)") ||
                    msg.includes("next batch") ||
                    msg.includes("No such file") ||
                    msg.includes("busy");
                if (isRetryable && attempt < maxRetries) {
                    // If we suspect stale table handle, try to refresh it
                    try {
                        // Re-open table to get fresh file handles
                        const { createYamoTable } = await import("../yamo/schema.js");
                        if (this.dbDir) {
                            const db = await lancedb.connect(this.dbDir);
                            this.yamoTable = await createYamoTable(db, "yamo_blocks");
                            if (process.env.YAMO_DEBUG === "true") {
                                logger.debug({ attempt, msg: msg.substring(0, 100) }, "Refreshed yamoTable handle during retry");
                            }
                        }
                    }
                    catch (e) {
                        logger.warn({ err: e }, "Failed to refresh table handle during retry");
                    }
                    const delay = 500 * Math.pow(2, attempt - 1); // 500ms, 1000ms, 2000ms, 4000ms
                    await new Promise((resolve) => setTimeout(resolve, delay));
                    continue;
                }
                // Only log warning on final failure
                if (attempt === maxRetries) {
                    if (isRetryable && this.dbDir) {
                        // All retries exhausted with IO error — manifest corruption is unrecoverable
                        // (re-opening finds the same stale manifest each time). Drop and recreate
                        // so the next heartbeat cycle starts with a clean table.
                        logger.warn({ err: error }, "yamo_blocks IO corruption: recreating table");
                        try {
                            const { createYamoTable: recreateYamoTable } = await import("../yamo/schema.js");
                            const db = await lancedb.connect(this.dbDir);
                            await db.dropTable("yamo_blocks");
                            this.yamoTable = await recreateYamoTable(db, "yamo_blocks");
                            logger.info("Recreated yamo_blocks table after IO corruption");
                        }
                        catch (recreateErr) {
                            logger.warn({ err: recreateErr }, "Failed to recreate yamo_blocks table — disabling yamo log");
                            this.yamoTable = null;
                        }
                    }
                    else {
                        logger.warn({ err: error }, "Failed to get log after retries");
                    }
                }
                else if (!isRetryable) {
                    // Non-retryable error
                    logger.warn({ err: error }, "Failed to get log (non-retryable)");
                    break;
                }
            }
        }
        return [];
    }
    /**
     * Emit a YAMO block to the YAMO blocks table
     * @private
     *
     * Note: YAMO emission is non-critical - failures are logged but don't throw
     * to prevent disrupting the main operation.
     */
    async _emitYamoBlock(operationType, memoryId, yamoText, heritage) {
        if (!this.yamoTable) {
            return;
        }
        const yamoId = `yamo_${operationType}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
        try {
            await this.yamoTable.add([
                {
                    id: yamoId,
                    agent_id: this.agentId,
                    operation_type: operationType,
                    yamo_text: yamoText,
                    timestamp: new Date(),
                    block_hash: null,
                    prev_hash: null,
                    metadata: JSON.stringify({
                        memory_id: memoryId || null,
                        timestamp: new Date().toISOString(),
                        ...(heritage ? { heritage_chain: heritage } : {}),
                    }),
                },
            ]);
        }
        catch (error) {
            // Log emission failures in debug mode
            // Emission is non-critical, so we don't throw
            if (process.env.YAMO_DEBUG === "true") {
                logger.warn({ err: error, operationType }, "YAMO emission failed");
            }
        }
    }
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
    async search(query, options = {}) {
        await this.init();
        try {
            const limit = options.limit || 10;
            const filter = options.filter || null;
            const mode = options.mode || "hybrid"; // "hybrid" | "vector" | "keyword"
            const useCache = options.useCache !== undefined ? options.useCache : true;
            if (useCache) {
                const cacheKey = this._generateCacheKey(query, { limit, filter, mode });
                const cached = this._getCachedResult(cacheKey);
                if (cached) {
                    return cached;
                }
            }
            // Keyword-only mode: skip embedding and vector search entirely
            if (mode === "keyword") {
                const keywordOnly = await this._keywordSearch(query, limit, filter);
                const normalizedKeyword = this._normalizeScores(keywordOnly);
                const boosted = await this._applyGraphRagBoosting(normalizedKeyword, query);
                if (useCache) {
                    const cacheKey = this._generateCacheKey(query, { limit, filter, mode });
                    this._cacheResult(cacheKey, boosted);
                }
                if (this.enableYamo) {
                    this._emitYamoBlock("recall", undefined, YamoEmitter.buildRecallBlock({
                        query,
                        resultCount: boosted.length,
                        limit,
                        agentId: this.agentId,
                        searchType: "keyword",
                    })).catch((error) => {
                        if (process.env.YAMO_DEBUG === "true") {
                            logger.warn({ err: error }, "Failed to emit YAMO block (recall)");
                        }
                    });
                }
                return boosted;
            }
            const vector = await this.embeddingFactory.embed(query, { isQuery: true });
            if (!this.client) {
                throw new Error("Database client not initialized");
            }
            const combinedFilter = filter ? `(${filter}) AND superseded_at IS NULL` : "superseded_at IS NULL";
            const vectorResults = await this.client.search(vector, {
                limit: mode === "vector" ? limit : limit * 2,
                metric: "cosine",
                filter: combinedFilter,
            });
            // Vector-only mode: skip keyword search and RRF merge
            if (mode === "vector") {
                const normalizedVector = this._normalizeScores(vectorResults.slice(0, limit));
                const boosted = await this._applyGraphRagBoosting(normalizedVector, query);
                if (useCache) {
                    const cacheKey = this._generateCacheKey(query, { limit, filter, mode });
                    this._cacheResult(cacheKey, boosted);
                }
                if (this.enableYamo) {
                    this._emitYamoBlock("recall", undefined, YamoEmitter.buildRecallBlock({
                        query,
                        resultCount: boosted.length,
                        limit,
                        agentId: this.agentId,
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
            const keywordResults = await this._keywordSearch(query, limit * 2, filter);
            // Optimized Reciprocal Rank Fusion (RRF) with min-heap for O(n log k) performance
            // Instead of sorting all results (O(n log n)), we maintain a heap of size k (O(n log k))
            const k = 60; // RRF constant
            const scores = new Map();
            const docMap = new Map();
            // Process vector results - O(m) where m = vectorResults.length
            for (let rank = 0; rank < vectorResults.length; rank++) {
                const doc = vectorResults[rank];
                const rrf = 1 / (k + rank + 1);
                scores.set(doc.id, (scores.get(doc.id) || 0) + rrf);
                docMap.set(doc.id, doc);
            }
            // Process keyword results - O(n) where n = keywordResults.length
            for (let rank = 0; rank < keywordResults.length; rank++) {
                const doc = keywordResults[rank];
                const rrf = 1 / (k + rank + 1);
                scores.set(doc.id, (scores.get(doc.id) || 0) + rrf);
                if (!docMap.has(doc.id)) {
                    docMap.set(doc.id, {
                        id: doc.id,
                        content: doc.content,
                        metadata: doc.metadata,
                        score: 0,
                        created_at: new Date().toISOString(),
                    });
                }
            }
            // Extract top candidates using min-heap pattern
            const scoreEntries = Array.from(scores.entries());
            let mergedResults;
            const rerankLimit = this.enableReranker ? Math.max(20, limit * 2) : limit;
            if (scoreEntries.length <= rerankLimit * 2) {
                // Small dataset: standard sort is fine
                mergedResults = scoreEntries
                    .sort((a, b) => b[1] - a[1]) // O(n log n) but n is small
                    .slice(0, rerankLimit)
                    .map(([id, score]) => {
                    const doc = docMap.get(id);
                    return doc ? { ...doc, score } : null;
                })
                    .filter((d) => d !== null);
            }
            else {
                // Large dataset: use partial selection sort (O(n*k) but k is small)
                // This is more efficient than full sort when we only need top k results
                const topK = [];
                for (const entry of scoreEntries) {
                    if (topK.length < rerankLimit) {
                        topK.push(entry);
                        // Keep topK sorted in descending order
                        topK.sort((a, b) => b[1] - a[1]);
                    }
                    else if (entry[1] > topK[topK.length - 1][1]) {
                        // Replace smallest in topK if current is larger
                        topK[rerankLimit - 1] = entry;
                        topK.sort((a, b) => b[1] - a[1]);
                    }
                }
                mergedResults = topK
                    .map(([id, score]) => {
                    const doc = docMap.get(id);
                    return doc ? { ...doc, score } : null;
                })
                    .filter((d) => d !== null);
            }
            // Cross-encoder rerank
            if (this.enableReranker && mergedResults.length > 0) {
                try {
                    const docContents = mergedResults.map(d => d.content);
                    const ceScores = await this.embeddingFactory.rerank(query, docContents);
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
            const boosted = await this._applyGraphRagBoosting(normalizedResults, query);
            if (useCache) {
                const cacheKey = this._generateCacheKey(query, { limit, filter, mode });
                this._cacheResult(cacheKey, boosted);
            }
            if (this.enableYamo) {
                this._emitYamoBlock("recall", undefined, YamoEmitter.buildRecallBlock({
                    query,
                    resultCount: boosted.length,
                    limit,
                    agentId: this.agentId,
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
    async _applyGraphRagBoosting(results, query) {
        if (!this.graphTable || results.length === 0) {
            return results;
        }
        try {
            const queryEntities = query.match(/\b([A-Z][a-zA-Z0-9_-]+|#[a-zA-Z0-9_-]+)\b/g) || [];
            if (queryEntities.length > 0) {
                const escapedEntities = queryEntities.map(e => e.replace(/'/g, "''"));
                const listStr = escapedEntities.map(e => `'${e}'`).join(", ");
                const filterExpr = `source IN (${listStr}) OR target IN (${listStr})`;
                const edges1 = await this.graphTable.query().where(filterExpr).toArray();
                const c1 = new Set();
                for (const edge of edges1) {
                    if (queryEntities.includes(edge.source))
                        c1.add(edge.target);
                    if (queryEntities.includes(edge.target))
                        c1.add(edge.source);
                }
                const c2 = new Set();
                if (c1.size > 0) {
                    const escapedC1 = Array.from(c1).map(e => e.replace(/'/g, "''"));
                    const listStrC1 = escapedC1.map(e => `'${e}'`).join(", ");
                    const filterExprC1 = `source IN (${listStrC1}) OR target IN (${listStrC1})`;
                    const edges2 = await this.graphTable.query().where(filterExprC1).toArray();
                    for (const edge of edges2) {
                        if (c1.has(edge.source)) {
                            if (!queryEntities.includes(edge.target) && !c1.has(edge.target)) {
                                c2.add(edge.target);
                            }
                        }
                        if (c1.has(edge.target)) {
                            if (!queryEntities.includes(edge.source) && !c1.has(edge.source)) {
                                c2.add(edge.source);
                            }
                        }
                    }
                }
                if (c1.size > 0 || c2.size > 0) {
                    for (const doc of results) {
                        let hasC1 = false;
                        for (const entity of c1) {
                            if (doc.content.includes(entity)) {
                                hasC1 = true;
                                break;
                            }
                        }
                        let hasC2 = false;
                        if (!hasC1 && c2.size > 0) {
                            for (const entity of c2) {
                                if (doc.content.includes(entity)) {
                                    hasC2 = true;
                                    break;
                                }
                            }
                        }
                        if (hasC1) {
                            doc.score = Math.min(1.0, parseFloat((doc.score * 1.15).toFixed(2)));
                        }
                        else if (hasC2) {
                            doc.score = Math.min(1.0, parseFloat((doc.score * 1.07).toFixed(2)));
                        }
                    }
                    results.sort((a, b) => b.score - a.score);
                }
            }
        }
        catch (graphError) {
            if (process.env.YAMO_DEBUG === "true") {
                logger.warn({ err: graphError }, "Failed to traverse Graph-RAG edges");
            }
        }
        return results;
    }
    async _keywordSearch(query, limit, filter = null) {
        if (this.client) {
            try {
                const combinedFilter = filter ? `(${filter}) AND superseded_at IS NULL` : "superseded_at IS NULL";
                const results = await this.client.searchFts(query, {
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
        return this.keywordSearch.search(query, { limit });
    }
    _normalizeScores(results) {
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
    _tokenizeQuery(text) {
        return text
            .replace(/([a-z])([A-Z])/g, "$1 $2") // Split camelCase: "targetSkill" → "target Skill"
            .toLowerCase()
            .replace(/[^\w\s]/g, "")
            .split(/\s+/)
            .filter((t) => t.length > 2); // Filter out very short tokens
    }
    formatResults(results) {
        if (results.length === 0) {
            return "No relevant memories found.";
        }
        let output = `[ATTENTION DIRECTIVE]\nThe following [MEMORY CONTEXT] is weighted by relevance.
- ALIGN attention to entries with [IMPORTANCE >= 0.8].
- TREAT entries with [IMPORTANCE <= 0.4] as auxiliary background info.

[MEMORY CONTEXT]`;
        results.forEach((res, i) => {
            const metadata = typeof res.metadata === "string"
                ? JSON.parse(res.metadata)
                : res.metadata;
            output += `\n\n--- MEMORY ${i + 1}: ${res.id} [IMPORTANCE: ${res.score}] ---\nType: ${metadata.type || "event"} | Source: ${metadata.source || "unknown"}\n${res.content}`;
        });
        return output;
    }
    async get(id) {
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
    async delete(id) {
        await this.init();
        if (!this.client) {
            throw new Error("Database client not initialized");
        }
        try {
            await this.client.delete(id);
            this.keywordSearch?.remove?.(id);
            // Invalidate cached search results — they may reference this id.
            this.queryCache.clear();
        }
        catch (error) {
            if (error instanceof Error && error.message.includes("not found"))
                return;
            throw error;
        }
    }
    /**
     * Distill a LessonLearned block (RFC-0011 §3.5).
     * Idempotent: same patternId + equal/higher confidence returns existing.
     */
    async distillLesson(context) {
        await this.init();
        const { situation, errorPattern, oversight, fix, preventativeRule, severity = "medium", applicableScope, inverseLesson = "", confidence = 0.7, } = context;
        const patternId = crypto.createHash("sha256")
            .update(errorPattern + applicableScope).digest("hex").slice(0, 16);
        // Idempotency check
        const existing = await this.getMemoriesByPattern(patternId);
        if (existing.length > 0) {
            const meta = typeof existing[0].metadata === "string"
                ? JSON.parse(existing[0].metadata) : existing[0].metadata;
            if ((meta.rule_confidence ?? 0) >= confidence) {
                return {
                    lessonId: meta.lesson_id, patternId, severity: meta.severity || severity,
                    preventativeRule: meta.preventative_rule || preventativeRule,
                    ruleConfidence: meta.rule_confidence, applicableScope: meta.applicable_scope || applicableScope,
                    wireFormat: meta.yamo_wire_format || "", memoryId: existing[0].id,
                };
            }
        }
        const lessonId = `lesson_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
        const timestamp = new Date().toISOString();
        const wireFormat = [
            `agent: MemoryMesh_${this.agentId};`,
            `intent: distill_wisdom_from_execution;`,
            `context:`,
            `  original_context;${situation.replace(/;/g, "%3B")};`,
            `  error_pattern;${patternId};`,
            `  severity;${severity};`,
            `  timestamp;${timestamp};`,
            `constraints:`,
            `  hypothesis;This lesson prevents recurrence of similar failures;`,
            `  hypothesis_confidence;${confidence};`,
            `priority: high;`,
            `output:`,
            `  lesson_id;${lessonId};`,
            `  oversight_description;${oversight.replace(/;/g, "%3B")};`,
            `  preventative_rule;${preventativeRule.replace(/;/g, "%3B")};`,
            `  rule_confidence;${confidence};`,
            `meta:`,
            `  rationale;${fix.replace(/;/g, "%3B")};`,
            `  applicability_scope;${applicableScope.replace(/;/g, "%3B")};`,
            `  inverse_lesson;${inverseLesson.replace(/;/g, "%3B")};`,
            `  confidence;${confidence};`,
            `log: lesson_learned;timestamp;${timestamp};pattern;${patternId};severity;${severity};id;${lessonId};`,
            `handoff: SubconsciousReflector;`,
        ].join("\n");
        const lessonContent = `[LESSON:${patternId}] ${oversight} | Rule: ${preventativeRule} | Scope: ${applicableScope}`;
        const lessonMetadata = {
            type: "lesson", tags: ["#lesson_learned"], lesson_id: lessonId,
            lesson_pattern_id: patternId, severity, oversight, preventative_rule: preventativeRule,
            rule_confidence: confidence, applicable_scope: applicableScope, inverse_lesson: inverseLesson,
            yamo_wire_format: wireFormat, source: "distillLesson",
        };
        const mem = await this.add(lessonContent, lessonMetadata);
        if (this.enableYamo) {
            this._emitYamoBlock("lesson", mem.id, wireFormat).catch(() => { });
        }
        return { lessonId, patternId, severity, preventativeRule, ruleConfidence: confidence, applicableScope, wireFormat, memoryId: mem.id };
    }
    /**
     * Query lessons from memory (RFC-0011 §4.1).
     */
    async queryLessons(query = "", options = {}) {
        await this.init();
        const limit = options.limit || 10;
        const all = await this.getAll({ limit: 1000 });
        const lessons = all.filter((r) => {
            try {
                const meta = typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata;
                return meta.type === "lesson" || (Array.isArray(meta.tags) && meta.tags.includes("#lesson_learned"));
            }
            catch {
                return false;
            }
        });
        let scored = lessons;
        if (query) {
            const q = query.toLowerCase();
            scored = lessons.map((r) => ({
                ...r,
                _score: (r.content?.toLowerCase().includes(q) ? 2 : 0) +
                    (JSON.stringify(r.metadata).toLowerCase().includes(q) ? 1 : 0),
            })).sort((a, b) => b._score - a._score);
        }
        return scored.slice(0, limit).map((r) => {
            const meta = typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata;
            return {
                lessonId: meta.lesson_id || r.id, patternId: meta.lesson_pattern_id || "",
                severity: meta.severity || "medium", preventativeRule: meta.preventative_rule || "",
                ruleConfidence: meta.rule_confidence ?? 0, applicableScope: meta.applicable_scope || "",
                wireFormat: meta.yamo_wire_format || "", memoryId: r.id,
            };
        });
    }
    /**
     * Update a memory entry's heritage_chain (RFC-0011 §8).
     */
    async insertHeritage(memoryId, heritage) {
        await this.init();
        if (!this.client)
            throw new Error("Database client not initialized");
        try {
            const record = await this.client.getById(memoryId);
            if (!record)
                return;
            const existingMeta = typeof record.metadata === "string"
                ? JSON.parse(record.metadata) : (record.metadata || {});
            await this.client.update(memoryId, {
                metadata: JSON.stringify({ ...existingMeta, heritage_chain: JSON.stringify(heritage) }),
            });
            // Emit RFC-0007 §5 heritage block
            if (this.enableYamo) {
                const ts = new Date().toISOString();
                const heritageBlock = [
                    `agent: MemoryMesh_${this.agentId};`,
                    `intent: record_heritage_chain;`,
                    `context:`,
                    `  memory_id;${memoryId};`,
                    `  intent_chain;${heritage.intentChain.join(",")};`,
                    `  timestamp;${ts};`,
                    `output:`,
                    `  heritage_recorded;true;`,
                    `log: heritage_inserted;memory;${memoryId};timestamp;${ts};`,
                    `handoff: End;`,
                ].join("\n");
                this._emitYamoBlock("heritage", memoryId, heritageBlock, heritage).catch(() => { });
            }
        }
        catch (error) {
            if (error instanceof Error && error.message.includes("not found"))
                return;
            throw error;
        }
    }
    /**
     * Return all memories whose lesson_pattern_id matches patternId (RFC-0011 §4.1).
     */
    async getMemoriesByPattern(patternId) {
        await this.init();
        const all = await this.getAll({ limit: 1000 });
        return all.filter((r) => {
            try {
                const meta = typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata;
                return meta.lesson_pattern_id === patternId;
            }
            catch {
                return false;
            }
        });
    }
    /**
     * S-MORA: Singularity Memory-Oriented Retrieval Augmentation (RFC-0012)
     * 5-layer pipeline: Scrubbing → HyDE-Lite → Multi-channel retrieval → RRF → Heritage-aware reranking
     */
    async smora(query, options = {}) {
        await this.init();
        const t0 = Date.now();
        const { limit = 10, retrievalLimit = 30, sessionIntent = [], enableSynthesis = false, enableHyDE = true, } = options;
        // Layer 0: scrub query
        let scrubbed = query;
        try {
            if (this.scrubber) {
                const s = await this.scrubber.process({ content: query });
                scrubbed = s.content || query;
            }
        }
        catch { /* non-fatal */ }
        if (!this.client) {
            return { results: [], pipeline: { queryExpanded: false, heritageAware: false, synthesized: false, latencyMs: Date.now() - t0 } };
        }
        // Layer 1: HyDE — LLM-generated hypothetical answer (template fallback)
        let hydeQuery = null;
        if (enableHyDE) {
            hydeQuery = await this._generateHyDE(scrubbed);
        }
        // Layer 2: Multi-channel retrieval (semantic original, semantic HyDE, keyword BM25)
        // HyDE expansion already reads like a document, so embed it as a passage
        // rather than a query — the prefix difference matters for instruction-aware models.
        const queryVec = await this.embeddingFactory.embed(scrubbed, { isQuery: true });
        const hydeVec = hydeQuery ? await this.embeddingFactory.embed(hydeQuery, { isQuery: false }) : null;
        const [semanticOrig, semanticHyde, keywordResults] = await Promise.all([
            this.client.search(queryVec, { limit: retrievalLimit, metric: 'cosine', filter: 'superseded_at IS NULL' }),
            hydeVec ? this.client.search(hydeVec, { limit: retrievalLimit, metric: 'cosine', filter: 'superseded_at IS NULL' }) : Promise.resolve([]),
            Promise.resolve(this.keywordSearch.search(scrubbed, { limit: retrievalLimit })),
        ]);
        // Layer 3: Reciprocal Rank Fusion (k=60, channel weights: 1.0 / 0.8 / 0.6)
        const k = 60;
        const weights = { orig: 1.0, hyde: 0.8, keyword: 0.6 };
        const rrfScores = new Map();
        const docMap = new Map();
        function applyRRF(list, weight) {
            for (let rank = 0; rank < list.length; rank++) {
                const doc = list[rank];
                if (!doc?.id)
                    continue;
                rrfScores.set(doc.id, (rrfScores.get(doc.id) || 0) + weight / (k + rank + 1));
                if (!docMap.has(doc.id))
                    docMap.set(doc.id, doc);
            }
        }
        applyRRF(semanticOrig, weights.orig);
        applyRRF(semanticHyde, weights.hyde);
        applyRRF(keywordResults.map((r) => ({ id: r.id, content: r.content, metadata: r.metadata, created_at: r.created_at || new Date().toISOString() })), weights.keyword);
        // Take top pre_rerank_limit candidates
        const preRerankLimit = 20;
        let candidates = Array.from(rrfScores.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, preRerankLimit)
            .map(([id]) => docMap.get(id))
            .filter(Boolean);
        // Optional Layer 2.5: ColBERT late-interaction rerank
        // Runs token-level MaxSim over the candidate set before the cross-encoder.
        // Catches token-level alignment that pooled vectors flatten away — useful
        // on long-doc / multi-topic candidates. No-op when the model can't produce
        // token embeddings; cost is amortized across the candidate set (top 20).
        const enableColbert = options.enableColbert === true;
        if (enableColbert && candidates.length > 0) {
            try {
                const reranked = await this.embeddingFactory.colbertRerank(scrubbed, candidates);
                if (Array.isArray(reranked) && reranked.length === candidates.length) {
                    candidates = reranked;
                }
            }
            catch (error) {
                if (process.env.YAMO_DEBUG === "true") {
                    logger.warn({ err: error }, "ColBERT rerank in smora failed, falling back to RRF order");
                }
            }
        }
        // Compute cross-encoder scores if enabled
        let ceScores = null;
        if (this.enableReranker && candidates.length > 0) {
            try {
                const docContents = candidates.map((d) => d.content);
                ceScores = await this.embeddingFactory.rerank(scrubbed, docContents);
            }
            catch (error) {
                if (process.env.YAMO_DEBUG === "true") {
                    logger.warn({ err: error }, "Cross-encoder reranking in smora failed, falling back to RRF scores");
                }
            }
        }
        // Layer 4: Heritage-aware reranking
        // final_score = 0.6×semantic_sim + 0.25×heritage_bonus + 0.15×recency_decay
        // When no sessionIntent: weights renormalize → α=0.71, γ=0.29
        const hasHeritage = sessionIntent.length > 0;
        const α = hasHeritage ? 0.6 : 0.71;
        const β = hasHeritage ? 0.25 : 0.0;
        const γ = hasHeritage ? 0.15 : 0.29;
        const λ = 0.05; // recency decay rate (half-life ≈ 14 days)
        const now = Date.now();
        const reranked = candidates.map((doc, idx) => {
            // Semantic score: use cross-encoder if available, otherwise RRF-based approximation
            let semanticScore = 0;
            if (ceScores && ceScores[idx] !== undefined) {
                const sigmoid = (x) => 1 / (1 + Math.exp(-x));
                semanticScore = sigmoid(ceScores[idx]);
            }
            else {
                const rrfScore = rrfScores.get(doc.id) || 0;
                semanticScore = Math.min(1.0, rrfScore * 20); // scale to ~[0,1]
            }
            // Heritage bonus
            let heritageBonus = 0;
            if (hasHeritage) {
                try {
                    const meta = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : doc.metadata;
                    const chain = meta?.heritage_chain;
                    const parsedChain = typeof chain === 'string' ? JSON.parse(chain) : chain;
                    const intentChain = parsedChain?.intentChain ?? [];
                    const overlap = intentChain.filter((i) => sessionIntent.includes(i)).length;
                    if (overlap > 0)
                        heritageBonus = Math.min(1.0, overlap / sessionIntent.length);
                }
                catch { /* no heritage */ }
            }
            // Recency decay: exp(-λ × age_days)
            let recencyDecay = 1.0;
            try {
                const createdAt = doc.created_at || doc.metadata?.created_at;
                if (createdAt) {
                    const ageDays = (now - new Date(createdAt).getTime()) / 86400000;
                    recencyDecay = Math.exp(-λ * ageDays);
                }
            }
            catch { /* use 1.0 */ }
            const score = α * semanticScore + β * heritageBonus + γ * recencyDecay;
            const meta = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : doc.metadata;
            return { doc, score, semanticScore, heritageBonus, recencyDecay, meta };
        });
        reranked.sort((a, b) => b.score - a.score);
        const results = reranked.slice(0, limit).map(({ doc, score, semanticScore, heritageBonus, recencyDecay, meta }, idx) => ({
            id: doc.id,
            content: doc.content,
            metadata: meta,
            score,
            semanticScore,
            heritageBonus,
            recencyDecay,
            rrfRank: idx + 1,
        }));
        // Layer 5: Synthesis (skip if LLM unavailable)
        let synthesis;
        let synthesized = false;
        if (enableSynthesis && this.llmClient) {
            try {
                const excerpts = results.slice(0, 5).map((r, i) => `[${i + 1}] ${r.content}`).join('\n');
                synthesis = await this.llmClient.complete(`You are a retrieval synthesis agent. Given the following memory excerpts, produce a coherent summary that directly answers the query.\nQuery: ${scrubbed}\nExcerpts:\n${excerpts}`);
                synthesized = true;
            }
            catch { /* non-fatal, skip synthesis */ }
        }
        return {
            results,
            ...(synthesis !== undefined ? { synthesis } : {}),
            pipeline: {
                queryExpanded: enableHyDE,
                heritageAware: hasHeritage,
                synthesized,
                latencyMs: Date.now() - t0,
            },
        };
    }
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
    async _judgeMemoryWrite(newContent, neighbor) {
        if (!this.enableLLM || !this.llmClient) {
            return { decision: 'ADD' };
        }
        const timeoutMs = parseInt(process.env.AGENTIC_OPS_TIMEOUT_MS || '5000', 10);
        const systemPrompt = 'You are a memory curator. Given a NEW candidate memory and the most semantically similar EXISTING memory already stored, choose exactly one action:\n- ADD: the new memory contains genuinely new information not in the existing one; store both.\n- UPDATE: the new memory is a more recent or more accurate version of the existing one; replace it.\n- MERGE: the two memories together would be more useful as one combined memory; provide merged_content.\n- NOOP: the new memory adds nothing the existing one does not already cover; skip storage.\n\nReply with ONLY a JSON object on a single line: {"decision":"ADD"|"UPDATE"|"MERGE"|"NOOP","merged_content":"...","rationale":"one short sentence"}\nOmit merged_content unless decision is MERGE.';
        const userPrompt = `NEW memory:\n"${newContent}"\n\nEXISTING memory:\n"${neighbor.content}"\n\nDecision:`;
        let timeoutHandle;
        try {
            const timeoutPromise = new Promise((_, reject) => {
                timeoutHandle = setTimeout(() => reject(new Error('Agentic ops LLM timeout')), timeoutMs);
            });
            const responseText = await Promise.race([
                this.llmClient.complete(systemPrompt, userPrompt),
                timeoutPromise,
            ]);
            const cleaned = String(responseText)
                .trim()
                .replace(/^```(?:json)?\s*/i, '')
                .replace(/```\s*$/i, '')
                .trim();
            const parsed = JSON.parse(cleaned);
            const decision = parsed.decision;
            if (decision !== 'ADD' && decision !== 'UPDATE' && decision !== 'MERGE' && decision !== 'NOOP') {
                return { decision: 'ADD' };
            }
            if (decision === 'MERGE' && (typeof parsed.merged_content !== 'string' || !parsed.merged_content.trim())) {
                // MERGE without usable merged_content falls back to ADD to avoid data loss.
                return { decision: 'ADD' };
            }
            return {
                decision,
                mergedContent: typeof parsed.merged_content === 'string' ? parsed.merged_content.trim() : undefined,
                rationale: typeof parsed.rationale === 'string' ? parsed.rationale : undefined,
            };
        }
        catch (error) {
            if (process.env.YAMO_DEBUG === 'true') {
                logger.debug({ err: error }, 'Agentic ops judge failed, defaulting to ADD');
            }
            return { decision: 'ADD' };
        }
        finally {
            if (timeoutHandle)
                clearTimeout(timeoutHandle);
        }
    }
    /**
     * Emit a YAMO block recording an agentic ops decision for provenance.
     * Non-critical — failures are swallowed (caller wraps in .catch).
     */
    async _emitAgenticDecisionBlock(judgment, neighborId, newContent) {
        if (!this.yamoTable)
            return;
        const ts = new Date().toISOString();
        const yamoText = [
            `agent: MemoryMesh_${this.agentId};`,
            'intent: agentic_memory_decision;',
            'context:',
            `  neighbor_memory_id;${neighborId};`,
            `  candidate_excerpt;${newContent.slice(0, 120).replace(/;/g, '%3B')};`,
            `  timestamp;${ts};`,
            'output:',
            `  decision;${judgment.decision};`,
            ...(judgment.rationale ? [`  rationale;${judgment.rationale.replace(/;/g, '%3B')};`] : []),
            'log: agentic_decision;decision;' + judgment.decision + ';neighbor;' + neighborId + ';timestamp;' + ts + ';',
            'handoff: End;',
        ].join('\n');
        await this._emitYamoBlock('agentic_decision', neighborId, yamoText);
    }
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
    async _generateHyDE(query) {
        const template = `A document about ${query}. This covers concepts related to ${query} including patterns, insights, and lessons learned.`;
        if (!this.enableLLM || !this.llmClient) {
            return template;
        }
        const cacheKey = `hyde:${query}`;
        const cached = this.hydeCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheConfig.ttlMs) {
            return cached.text;
        }
        const timeoutMs = parseInt(process.env.HYDE_TIMEOUT_MS || '5000', 10);
        const systemPrompt = 'You are a search retrieval assistant. Given a user query, write a concise 2-3 sentence hypothetical passage that would directly answer it. Use technical vocabulary that would appear in a real document on this topic. Output only the passage, no preamble or commentary.';
        let timeoutHandle;
        try {
            const timeoutPromise = new Promise((_, reject) => {
                timeoutHandle = setTimeout(() => reject(new Error('HyDE LLM timeout')), timeoutMs);
            });
            const hydeText = await Promise.race([
                this.llmClient.complete(systemPrompt, query),
                timeoutPromise,
            ]);
            const cleaned = (hydeText && typeof hydeText === 'string' && hydeText.trim())
                ? hydeText.trim()
                : template;
            // LRU eviction
            const cap = 200;
            if (this.hydeCache.size >= cap) {
                const firstKey = this.hydeCache.keys().next().value;
                if (firstKey !== undefined)
                    this.hydeCache.delete(firstKey);
            }
            this.hydeCache.set(cacheKey, { text: cleaned, timestamp: Date.now() });
            return cleaned;
        }
        catch (error) {
            if (process.env.YAMO_DEBUG === 'true') {
                logger.debug({ err: error, query }, 'HyDE LLM call failed, using template');
            }
            return template;
        }
        finally {
            if (timeoutHandle)
                clearTimeout(timeoutHandle);
        }
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
                embedding: { configured: false, primary: null, fallbacks: [] },
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
    _extractTriplesHeuristics(content) {
        const triples = [];
        const terms = content.match(/\b([A-Z][a-zA-Z0-9_-]+|#[a-zA-Z0-9_-]+)\b/g);
        if (terms && terms.length >= 2) {
            const uniqueTerms = Array.from(new Set(terms));
            for (let i = 0; i < uniqueTerms.length - 1; i++) {
                const source = uniqueTerms[i];
                const target = uniqueTerms[i + 1];
                let relation = "relates_to";
                const pattern = new RegExp(`${source}\\s+(\\w+)\\s+.*?${target}`, "i");
                const match = content.match(pattern);
                if (match && match[1]) {
                    const verb = match[1].toLowerCase();
                    if (["uses", "contains", "implements", "is", "has", "creates", "manages", "configures", "calls"].includes(verb)) {
                        relation = verb;
                    }
                }
                triples.push({
                    source,
                    target,
                    relation,
                    weight: 1.0
                });
            }
        }
        return triples;
    }
    async _extractTriplesLLM(content) {
        if (!this.llmClient)
            return [];
        try {
            const prompt = `Extract entity-relation triples (Subject, Predicate, Object) from the following text.
Format the output as a JSON array of objects with keys: "source", "target", "relation", "weight" (0.0 to 1.0).
Only output the JSON array, nothing else.

Text: "${content}"`;
            const response = await this.llmClient.complete("You are a Graph-RAG entity extractor. Output ONLY valid JSON array.", prompt);
            const cleanedResponse = response.trim().replace(/^```json/, '').replace(/```$/, '').trim();
            const triples = JSON.parse(cleanedResponse);
            if (Array.isArray(triples)) {
                return triples.map(t => ({
                    source: String(t.source),
                    target: String(t.target),
                    relation: String(t.relation),
                    weight: typeof t.weight === 'number' ? t.weight : 1.0
                }));
            }
        }
        catch (err) {
            if (process.env.YAMO_DEBUG === "true") {
                logger.warn({ err }, "LLM triple extraction failed");
            }
        }
        return [];
    }
    async anchor() {
        await this.init();
        if (!this.yamoTable) {
            throw new Error("YAMO blocks table not initialized");
        }
        const allBlocks = await this.yamoTable.query().toArray();
        allBlocks.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        const unanchored = allBlocks.filter((b) => !b.anchored_at);
        if (unanchored.length === 0) {
            return null;
        }
        const anchored = allBlocks.filter((b) => b.anchored_at);
        const crypto = await import("crypto");
        const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
        let prevHash = anchored.length > 0 ? anchored[anchored.length - 1].block_hash : sha256("GENESIS");
        const leafHashes = [];
        const updates = [];
        for (let i = 0; i < unanchored.length; i++) {
            const block = unanchored[i];
            const blockHash = sha256(block.yamo_text + prevHash);
            leafHashes.push(blockHash);
            updates.push({
                id: block.id,
                block_hash: blockHash,
                prev_hash: prevHash,
                anchored_at: new Date(),
            });
            prevHash = blockHash;
        }
        // Build Merkle Tree
        const buildMerkleTree = (leaves) => {
            if (leaves.length === 0)
                return { root: sha256(""), tree: [[]] };
            const tree = [leaves];
            while (tree[tree.length - 1].length > 1) {
                const currentLevel = tree[tree.length - 1];
                const nextLevel = [];
                for (let i = 0; i < currentLevel.length; i += 2) {
                    const left = currentLevel[i];
                    const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
                    nextLevel.push(sha256(left + right));
                }
                tree.push(nextLevel);
            }
            return { root: tree[tree.length - 1][0], tree };
        };
        const { root } = buildMerkleTree(leafHashes);
        // Update database records
        for (const update of updates) {
            await this.yamoTable.update({
                where: `id == '${update.id}'`,
                values: {
                    block_hash: update.block_hash,
                    prev_hash: update.prev_hash,
                    anchored_at: update.anchored_at,
                },
            });
        }
        return {
            root,
            count: unanchored.length,
            updates,
        };
    }
}
/**
 * Main CLI handler
 */
export async function run() {
    let action, input;
    if (process.argv.length > 3) {
        action = process.argv[2];
        try {
            input = JSON.parse(process.argv[3]);
        }
        catch (e) {
            logger.error({ err: e }, "Invalid JSON argument");
            process.exit(1);
        }
    }
    else {
        try {
            const rawInput = fs.readFileSync(0, "utf8");
            input = JSON.parse(rawInput);
            action = input.action || action;
        }
        catch (_e) {
            logger.error("No input provided");
            process.exit(1);
        }
    }
    const mesh = new MemoryMesh({
        llmProvider: process.env.LLM_PROVIDER ||
            (process.env.OPENAI_API_KEY ? "openai" : "ollama"),
        llmApiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY,
        llmModel: process.env.LLM_MODEL,
    });
    try {
        if (action === "ingest" || action === "store") {
            const record = await mesh.add(input.content, input.metadata || {});
            process.stdout.write(`[MemoryMesh] Ingested record ${record.id}\n${JSON.stringify({ status: "ok", record })}\n`);
        }
        else if (action === "search") {
            const results = await mesh.search(input.query, {
                limit: input.limit || 10,
                filter: input.filter || null,
            });
            process.stdout.write(`[MemoryMesh] Found ${results.length} matches.\n**Formatted Context**:\n\`\`\`yamo\n${mesh.formatResults(results)}\n\`\`\`\n**Output**: memory_results.json\n\`\`\`json\n${JSON.stringify(results, null, 2)}\n\`\`\`\n${JSON.stringify({ status: "ok", results })}\n`);
        }
        else if (action === "synthesize") {
            const result = await mesh.synthesize({
                topic: input.topic,
                lookback: input.limit || 20,
            });
            process.stdout.write(`[MemoryMesh] Synthesis Outcome: ${result.status}\n${JSON.stringify(result, null, 2)}\n`);
        }
        else if (action === "ingest-skill") {
            const record = await mesh.ingestSkill(input.yamo_text, input.metadata || {});
            process.stdout.write(`[MemoryMesh] Ingested skill ${record.name} (${record.id})\n${JSON.stringify({ status: "ok", record })}\n`);
        }
        else if (action === "search-skills") {
            await mesh.init();
            const vector = await mesh.embeddingFactory.embed(input.query, { isQuery: true });
            if (mesh.skillTable) {
                const results = await mesh.skillTable
                    .search(vector)
                    .limit(input.limit || 5)
                    .toArray();
                process.stdout.write(`[MemoryMesh] Found ${results.length} synthesized skills.\n${JSON.stringify({ status: "ok", results }, null, 2)}\n`);
            }
            else {
                process.stdout.write(`[MemoryMesh] Skill table not initialized.\n`);
            }
        }
        else if (action === "skill-feedback") {
            const result = await mesh.updateSkillReliability(input.id, input.success !== false);
            process.stdout.write(`[MemoryMesh] Feedback recorded for ${input.id}: Reliability now ${result.reliability}\n${JSON.stringify({ status: "ok", ...result })}\n`);
        }
        else if (action === "skill-prune") {
            const result = await mesh.pruneSkills(input.threshold || 0.3);
            process.stdout.write(`[MemoryMesh] Pruning complete. Removed ${result.pruned_count} unreliable skills.\n${JSON.stringify({ status: "ok", ...result })}\n`);
        }
        else if (action === "stats") {
            process.stdout.write(`[MemoryMesh] Database Statistics:\n${JSON.stringify({ status: "ok", stats: await mesh.stats() }, null, 2)}\n`);
        }
        else if (action === "get") {
            const record = await mesh.get(input.id);
            if (!record) {
                process.stdout.write(`[MemoryMesh] Record not found: ${input.id}\n${JSON.stringify({ status: "not_found", id: input.id })}\n`);
            }
            else {
                process.stdout.write(`[MemoryMesh] Record ${record.id}\n${JSON.stringify({ status: "ok", record }, null, 2)}\n`);
            }
        }
        else if (action === "delete") {
            await mesh.delete(input.id);
            process.stdout.write(`[MemoryMesh] Deleted record ${input.id}\n${JSON.stringify({ status: "ok", id: input.id })}\n`);
        }
        else if (action === "reflect") {
            const result = await mesh.reflect({ topic: input.topic, lookback: input.lookback });
            process.stdout.write(`[MemoryMesh] Reflection complete.\n${JSON.stringify({ status: "ok", result }, null, 2)}\n`);
        }
        else if (action === "anchor") {
            const result = await mesh.anchor();
            if (!result) {
                process.stdout.write(`[MemoryMesh] No un-anchored blocks found.\n${JSON.stringify({ status: "ok", root: null, count: 0 })}\n`);
            }
            else {
                process.stdout.write(`[MemoryMesh] Anchored ${result.count} blocks. Merkle Root: ${result.root}\n${JSON.stringify({ status: "ok", root: result.root, count: result.count })}\n`);
            }
        }
        else {
            logger.error({ action }, "Unknown action");
            process.exit(1);
        }
    }
    catch (error) {
        const errorResponse = handleError(error, {
            action,
            input: { ...input, content: input.content ? "[REDACTED]" : undefined },
        });
        logger.error({ err: error, errorResponse }, "Fatal Error");
        process.exit(1);
    }
}
export default MemoryMesh;
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    run().catch((err) => {
        logger.error({ err }, "Fatal Error");
        process.exit(1);
    });
}
