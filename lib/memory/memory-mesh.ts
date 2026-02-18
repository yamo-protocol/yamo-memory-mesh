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
    llmClient;
    scrubber;
    queryCache;
    cacheConfig;
    skillDirectories; // Store skill directories for synthesis
    dbDir; // Store custom dbDir for in-memory databases
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
            // Hydrate Keyword Search (In-Memory)
            if (this.client) {
                try {
                    const allRecords = await this.client.getAll({ limit: 10000 });
                    this.keywordSearch.load(allRecords);
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
                        });
                    }
                    if (process.env.YAMO_DEBUG === "true") {
                        logger.debug("YAMO blocks and synthesized skills tables initialized");
                    }
                }
                catch (e) {
                    logger.warn({ err: e }, "Failed to initialize extension tables");
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
            let processedContent = content;
            let scrubbedMetadata = {};
            try {
                const scrubbedResult = await this.scrubber.process({
                    content: content,
                    source: "memory-api",
                    type: "txt",
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
            const sanitizedContent = this._sanitizeContent(processedContent);
            const sanitizedMetadata = this._validateMetadata({
                ...scrubbedMetadata,
                ...enrichedMetadata,
            });
            if (process.env.YAMO_DEBUG === "true") {
                console.error("[DEBUG] brain.add() scrubbedMetadata.type:", scrubbedMetadata.type);
                console.error("[DEBUG] brain.add() enrichedMetadata.type:", enrichedMetadata.type);
                console.error("[DEBUG] brain.add() sanitizedMetadata.type:", sanitizedMetadata.type);
            }
            const vector = await this.embeddingFactory.embed(sanitizedContent);
            // Dedup: search by the already-computed vector before inserting.
            // Catches exact duplicates regardless of which write path is used,
            // protecting callers that bypass captureInteraction()'s dedup guard.
            if (this.client) {
                const nearest = await this.client.search(vector, { limit: 1 });
                if (nearest.length > 0 && nearest[0].content === sanitizedContent) {
                    return {
                        id: nearest[0].id,
                        content: sanitizedContent,
                        metadata: sanitizedMetadata,
                        created_at: new Date().toISOString(),
                    };
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
            const intent = identity.intent;
            const description = identity.description;
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
                    const fileName = `skill-${safeName}.yamo`;
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
        // const lookback = options.lookback || 20;
        logger.info({ topic, enrichedPrompt }, "Synthesizing logic");
        // OPTIMIZATION: If we have an execution engine (kernel), use SkillCreator!
        if (this._kernel_execute) {
            logger.info("Dispatching to SkillCreator agent...");
            try {
                // Use stored skill directories
                const skillDirs = this.skillDirectories;
                // Track existing .yamo files before SkillCreator runs
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
                                    else if (entry.isFile() && entry.name.endsWith(".yamo")) {
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
                await this._kernel_execute(`SkillCreator: design a new skill to handle ${enrichedPrompt}`, {
                    v1_1_enabled: true,
                });
                // Find newly created .yamo file
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
                                    else if (entry.isFile() && entry.name.endsWith(".yamo")) {
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
                            const expanded = await this._kernel_execute("skill-expansion-system-prompt.yamo", {
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
                    // This prevents duplicate skill-agent-{timestamp}.yamo files
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
            // 2a. Vector search (get more candidates for fusion)
            const vector = await this.embeddingFactory.embed(query);
            const vectorResults = await this.skillTable
                .search(vector)
                .limit(limit * 3)
                .toArray();
            // 2b. Keyword matching against skill fields (including tags)
            const queryTokens = this._tokenizeQuery(query);
            const keywordScores = new Map();
            let maxKeywordScore = 0;
            for (const result of vectorResults) {
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
            // 2c. Combine scores using weighted fusion
            const fusedResults = vectorResults.map((r) => {
                // Normalize vector distance to [0, 1] similarity score
                // LanceDB cosine distance ranges from 0 (identical) to 2 (opposite)
                const rawDistance = r._distance !== undefined ? r._distance : 1.0;
                const vectorScore = Math.max(0, Math.min(1.0, 1 - rawDistance / 2));
                const keywordScore = keywordScores.get(r.id) || 0;
                // Normalize keyword score by max observed (or use fixed max to avoid division by zero)
                const normalizedKeyword = maxKeywordScore > 0 ? keywordScore / maxKeywordScore : 0;
                // Weighted combination: 70% keyword, 30% vector
                // Keywords get higher weight to prioritize exact matches
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
                    logger.warn({ err: error }, "Failed to get log after retries");
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
    async _emitYamoBlock(operationType, memoryId, yamoText) {
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
            const useCache = options.useCache !== undefined ? options.useCache : true;
            if (useCache) {
                const cacheKey = this._generateCacheKey(query, { limit, filter });
                const cached = this._getCachedResult(cacheKey);
                if (cached) {
                    return cached;
                }
            }
            const vector = await this.embeddingFactory.embed(query);
            if (!this.client) {
                throw new Error("Database client not initialized");
            }
            const vectorResults = await this.client.search(vector, {
                limit: limit * 2,
                metric: "cosine",
                filter,
            });
            const keywordResults = this.keywordSearch.search(query, {
                limit: limit * 2,
            });
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
            // Extract top k results using min-heap pattern - O(n log k)
            // Since JavaScript doesn't have a built-in heap, we use an efficient approach:
            // Convert to array and sort only if results exceed limit significantly
            const scoreEntries = Array.from(scores.entries());
            let mergedResults;
            if (scoreEntries.length <= limit * 2) {
                // Small dataset: standard sort is fine
                mergedResults = scoreEntries
                    .sort((a, b) => b[1] - a[1]) // O(n log n) but n is small
                    .slice(0, limit)
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
                    if (topK.length < limit) {
                        topK.push(entry);
                        // Keep topK sorted in descending order
                        topK.sort((a, b) => b[1] - a[1]);
                    }
                    else if (entry[1] > topK[topK.length - 1][1]) {
                        // Replace smallest in topK if current is larger
                        topK[limit - 1] = entry;
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
            const normalizedResults = this._normalizeScores(mergedResults);
            if (useCache) {
                const cacheKey = this._generateCacheKey(query, { limit, filter });
                this._cacheResult(cacheKey, normalizedResults);
            }
            if (this.enableYamo) {
                this._emitYamoBlock("recall", undefined, YamoEmitter.buildRecallBlock({
                    query,
                    resultCount: normalizedResults.length,
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
            return normalizedResults;
        }
        catch (error) {
            throw error instanceof Error ? error : new Error(String(error));
        }
    }
    _normalizeScores(results) {
        if (results.length === 0) {
            return [];
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
    async delete(id: string): Promise<void> {
        await this.init();
        if (!this.client) {
            throw new Error("Database client not initialized");
        }
        try {
            await this.client.delete(id);
            this.keywordSearch?.remove?.(id);
        } catch (error: any) {
            if (error instanceof Error && error.message.includes("not found")) return;
            throw error;
        }
    }
    /**
     * Distill a LessonLearned block (RFC-0011 §3.5).
     * Idempotent: same patternId + equal/higher confidence returns existing.
     */
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
        await this.init();
        const {
            situation, errorPattern, oversight, fix, preventativeRule,
            severity = "medium", applicableScope, inverseLesson = "", confidence = 0.7,
        } = context;
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
            `  original_context;${situation.replace(/;/g, ",")};`,
            `  error_pattern;${patternId};`,
            `  severity;${severity};`,
            `  timestamp;${timestamp};`,
            `constraints:`,
            `  hypothesis;This lesson prevents recurrence of similar failures;`,
            `  hypothesis_confidence;${confidence};`,
            `priority: high;`,
            `output:`,
            `  lesson_id;${lessonId};`,
            `  oversight_description;${oversight.replace(/;/g, ",")};`,
            `  preventative_rule;${preventativeRule.replace(/;/g, ",")};`,
            `  rule_confidence;${confidence};`,
            `meta:`,
            `  rationale;${fix.replace(/;/g, ",")};`,
            `  applicability_scope;${applicableScope.replace(/;/g, ",")};`,
            `  inverse_lesson;${inverseLesson.replace(/;/g, ",")};`,
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
            this._emitYamoBlock("lesson", mem.id, wireFormat).catch(() => {});
        }
        return { lessonId, patternId, severity, preventativeRule, ruleConfidence: confidence, applicableScope, wireFormat, memoryId: mem.id };
    }
    /**
     * Query lessons from memory (RFC-0011 §4.1).
     */
    async queryLessons(query = "", options: { limit?: number } = {}): Promise<any[]> {
        await this.init();
        const limit = options.limit || 10;
        const all = await this.getAll({ limit: 1000 });
        const lessons = all.filter((r: any) => {
            try {
                const meta = typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata;
                return meta.type === "lesson" || (Array.isArray(meta.tags) && meta.tags.includes("#lesson_learned"));
            } catch { return false; }
        });
        let scored = lessons as any[];
        if (query) {
            const q = query.toLowerCase();
            scored = lessons.map((r: any) => ({
                ...r,
                _score: (r.content?.toLowerCase().includes(q) ? 2 : 0) +
                    (JSON.stringify(r.metadata).toLowerCase().includes(q) ? 1 : 0),
            })).sort((a: any, b: any) => b._score - a._score);
        }
        return scored.slice(0, limit).map((r: any) => {
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
    async insertHeritage(memoryId: string, heritage: { intentChain: string[]; hypotheses: string[]; rationales: string[] }): Promise<void> {
        await this.init();
        if (!this.client) throw new Error("Database client not initialized");
        try {
            const record = await this.client.getById(memoryId);
            if (!record) return;
            const existingMeta = typeof record.metadata === "string"
                ? JSON.parse(record.metadata) : (record.metadata || {});
            await this.client.update(memoryId, {
                metadata: JSON.stringify({ ...existingMeta, heritage_chain: JSON.stringify(heritage) }),
            });
        } catch (error: any) {
            if (error instanceof Error && error.message.includes("not found")) return;
            throw error;
        }
    }
    /**
     * Return all memories whose lesson_pattern_id matches patternId (RFC-0011 §4.1).
     */
    async getMemoriesByPattern(patternId: string): Promise<any[]> {
        await this.init();
        const all = await this.getAll({ limit: 1000 });
        return (all as any[]).filter((r) => {
            try {
                const meta = typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata;
                return meta.lesson_pattern_id === patternId;
            } catch { return false; }
        });
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
            const vector = await mesh.embeddingFactory.embed(input.query);
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
