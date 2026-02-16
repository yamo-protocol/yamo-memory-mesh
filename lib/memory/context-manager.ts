// @ts-nocheck
/**
 * MemoryContextManager - High-level memory management for YAMO
 */
import { MemoryMesh } from "./memory-mesh.js";
import { MemoryScorer } from "./scorer.js";
import { MemoryTranslator } from "./memory-translator.js";
import { createLogger } from "../utils/logger.js";
const logger = createLogger("context-manager");
export class MemoryContextManager {
    #config;
    #mesh;
    #scorer;
    #initialized = false;
    #queryCache = new Map();
    #cacheConfig = {
        maxSize: 100,
        ttlMs: 2 * 60 * 1000, // 2 minutes
    };
    #cleanupTimer = null;
    /**
     * Create a new MemoryContextManager
     */
    constructor(config = {}) {
        this.#config = {
            autoInit: true,
            enableCache: true,
            recallLimit: 5,
            minImportance: 0.1,
            silent: config.silent !== false,
            ...config,
        };
        // Use provided mesh or create new instance
        this.#mesh = config.mesh || new MemoryMesh();
        this.#scorer = new MemoryScorer(this.#mesh);
        // Start periodic cleanup timer (every 60 seconds)
        this.#startCleanupTimer();
    }
    /**
     * Initialize the memory context manager
     */
    async initialize() {
        if (this.#initialized) {
            return;
        }
        try {
            await this.#mesh.init();
            this.#initialized = true;
        }
        catch (error) {
            this.#logWarn(`Initialization failed: ${error.message}`);
            this.#initialized = false;
        }
    }
    /**
     * Capture an interaction as memory
     */
    async captureInteraction(prompt, response, context = {}) {
        try {
            if (this.#config.autoInit && !this.#initialized) {
                await this.initialize();
            }
            if (!this.#initialized) {
                return null;
            }
            const content = this.#formatInteraction(prompt, response);
            const metadata = this.#buildMetadata(context);
            const isDuplicate = await this.#scorer.isDuplicate(content);
            if (isDuplicate) {
                return null;
            }
            const importance = this.#scorer.calculateImportance(content, metadata);
            if (importance < (this.#config.minImportance ?? 0.1)) {
                return null;
            }
            const memory = await this.#mesh.add(content, {
                ...metadata,
                importanceScore: importance,
            });
            return memory;
        }
        catch (error) {
            this.#logWarn(`Failed to capture interaction: ${error.message}`);
            return null;
        }
    }
    /**
     * Recall relevant memories for a query
     */
    async recallMemories(query, options = {}) {
        try {
            if (this.#config.autoInit && !this.#initialized) {
                await this.initialize();
            }
            if (!this.#initialized) {
                return [];
            }
            const { limit = this.#config.recallLimit, useCache = this.#config.enableCache, memoryType = null, skillName = null, } = options;
            if (useCache) {
                const cacheKey = this.#cacheKey(query, {
                    limit,
                    memoryType,
                    skillName,
                });
                const cached = this.#getCached(cacheKey);
                if (cached) {
                    return cached;
                }
            }
            const filter = memoryType ? `memoryType == '${memoryType}'` : null;
            // Fetch extra when skill-scoping — some results will be filtered out post-query
            const fetchLimit = skillName ? limit * 2 : limit;
            let memories = [];
            if (memoryType === "synthesized_skill" &&
                typeof this.#mesh.searchSkills === "function") {
                memories = await this.#mesh.searchSkills(query, { limit: fetchLimit });
            }
            else {
                memories = await this.#mesh.search(query, {
                    limit: fetchLimit,
                    filter,
                    useCache: false,
                });
            }
            memories = memories.map((memory) => {
                const metadata = typeof memory.metadata === "string"
                    ? JSON.parse(memory.metadata)
                    : memory.metadata || {};
                return {
                    ...memory,
                    importanceScore: memory.score || metadata.importanceScore || 0,
                    memoryType: metadata.memoryType ||
                        (memoryType === "synthesized_skill"
                            ? "synthesized_skill"
                            : "global"),
                };
            });
            // Deduplicate by content — results are already sorted by score, so first occurrence wins
            const seen = new Set();
            memories = memories.filter((memory) => {
                if (seen.has(memory.content)) {
                    return false;
                }
                seen.add(memory.content);
                return true;
            });
            // Skill-scope filter: keep memories tagged with this skill OR untagged (global).
            // Untagged memories are shared context; tagged memories are skill-private.
            if (skillName) {
                memories = memories.filter((memory) => {
                    const meta = typeof memory.metadata === "string"
                        ? JSON.parse(memory.metadata)
                        : memory.metadata || {};
                    return !meta.skill_name || meta.skill_name === skillName;
                });
                memories = memories.slice(0, limit);
            }
            if (useCache) {
                const cacheKey = this.#cacheKey(query, {
                    limit,
                    memoryType,
                    skillName,
                });
                this.#setCached(cacheKey, memories);
            }
            return memories;
        }
        catch (error) {
            this.#logWarn(`Failed to recall memories: ${error.message}`);
            return [];
        }
    }
    /**
     * Format memories for inclusion in prompt
     */
    formatMemoriesForPrompt(memories, options = {}) {
        try {
            if (!memories || memories.length === 0) {
                return "";
            }
            return MemoryTranslator.toYAMOContext(memories, options);
        }
        catch (error) {
            this.#logWarn(`Failed to format memories: ${error.message}`);
            return "";
        }
    }
    #logWarn(message) {
        if (!this.#config.silent || process.env.YAMO_DEBUG === "true") {
            logger.warn(message);
        }
    }
    #formatInteraction(prompt, response) {
        const lines = [
            `[USER] ${prompt}`,
            `[ASSISTANT] ${response.substring(0, 500)}${response.length > 500 ? "..." : ""}`,
        ];
        return lines.join("\n\n");
    }
    #buildMetadata(context) {
        const metadata = {
            interaction_type: context.interactionType || "llm_response",
            created_at: new Date().toISOString(),
        };
        if (context.toolsUsed?.length > 0) {
            metadata.tools_used = context.toolsUsed;
        }
        if (context.filesInvolved?.length > 0) {
            metadata.files_involved = context.filesInvolved;
        }
        if (context.tags?.length > 0) {
            metadata.tags = context.tags;
        }
        if (context.skillName) {
            metadata.skill_name = context.skillName;
        }
        if (context.sessionId) {
            metadata.session_id = context.sessionId;
        }
        return metadata;
    }
    #cacheKey(query, options) {
        return `recall:${query}:${JSON.stringify(options)}`;
    }
    /**
     * Get cached result if valid
     * Race condition fix: Update timestamp atomically for LRU tracking
     */
    #getCached(key) {
        const entry = this.#queryCache.get(key);
        if (!entry) {
            return null;
        }
        // Check TTL before any mutation
        const now = Date.now();
        if (now - entry.timestamp > this.#cacheConfig.ttlMs) {
            this.#queryCache.delete(key);
            return null;
        }
        // Move to end (most recently used) - delete and re-add with updated timestamp
        this.#queryCache.delete(key);
        this.#queryCache.set(key, {
            ...entry,
            timestamp: now, // Update timestamp for LRU tracking
        });
        return entry.result;
    }
    #setCached(key, result) {
        if (this.#queryCache.size >= this.#cacheConfig.maxSize) {
            const firstKey = this.#queryCache.keys().next().value;
            if (firstKey !== undefined) {
                this.#queryCache.delete(firstKey);
            }
        }
        this.#queryCache.set(key, {
            result,
            timestamp: Date.now(),
        });
    }
    clearCache() {
        this.#queryCache.clear();
    }
    getCacheStats() {
        return {
            size: this.#queryCache.size,
            maxSize: this.#cacheConfig.maxSize,
            ttlMs: this.#cacheConfig.ttlMs,
        };
    }
    async healthCheck() {
        const health = {
            status: "healthy",
            timestamp: new Date().toISOString(),
            initialized: this.#initialized,
            checks: {},
        };
        try {
            health.checks.mesh = await this.#mesh.stats(); // brain.ts has stats()
            if (health.checks.mesh.isConnected === false) {
                health.status = "degraded";
            }
        }
        catch (error) {
            health.checks.mesh = {
                status: "error",
                error: error.message,
            };
            health.status = "unhealthy";
        }
        health.checks.cache = {
            status: "up",
            size: this.#queryCache.size,
            maxSize: this.#cacheConfig.maxSize,
        };
        return health;
    }
    /**
     * Start periodic cleanup timer to remove expired cache entries
     * @private
     */
    #startCleanupTimer() {
        // Clear any existing timer
        if (this.#cleanupTimer) {
            clearInterval(this.#cleanupTimer);
        }
        // Run cleanup every 60 seconds
        this.#cleanupTimer = setInterval(() => {
            this.#cleanupExpired();
        }, 60000);
    }
    /**
     * Clean up expired cache entries
     * @private
     */
    #cleanupExpired() {
        const now = Date.now();
        const expiredKeys = [];
        // Find expired entries
        for (const [key, entry] of this.#queryCache.entries()) {
            if (now - entry.timestamp > this.#cacheConfig.ttlMs) {
                expiredKeys.push(key);
            }
        }
        // Remove expired entries
        for (const key of expiredKeys) {
            this.#queryCache.delete(key);
        }
        if (expiredKeys.length > 0 &&
            (process.env.YAMO_DEBUG === "true" || !this.#config.silent)) {
            logger.debug({ count: expiredKeys.length }, "Cleaned up expired cache entries");
        }
    }
    /**
     * Dispose of resources (cleanup timer and cache)
     * Call this when the MemoryContextManager is no longer needed
     */
    dispose() {
        if (this.#cleanupTimer) {
            clearInterval(this.#cleanupTimer);
            this.#cleanupTimer = null;
        }
        this.clearCache();
    }
}
export default MemoryContextManager;
