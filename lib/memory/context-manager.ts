/**
 * MemoryContextManager - High-level memory management for YAMO
 */

import { MemoryMesh } from "./memory-mesh.js";
import { MemoryScorer } from "./scorer.js";
import { MemoryTranslator } from "./memory-translator.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("context-manager");

export interface MemoryContextConfig {
  mesh?: MemoryMesh;
  autoInit?: boolean;
  enableCache?: boolean;
  recallLimit?: number;
  minImportance?: number;
  silent?: boolean;
}

interface CacheEntry {
  result: any[];
  timestamp: number;
}

export class MemoryContextManager {
  #config: MemoryContextConfig;
  #mesh: MemoryMesh;
  #scorer: MemoryScorer;
  #initialized = false;
  #queryCache = new Map<string, CacheEntry>();
  #cacheConfig = {
    maxSize: 100,
    ttlMs: 2 * 60 * 1000, // 2 minutes
  };
  #cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Create a new MemoryContextManager
   */
  constructor(config: MemoryContextConfig = {}) {
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
  async initialize(): Promise<void> {
    if (this.#initialized) {
      return;
    }

    try {
      await this.#mesh.init();
      this.#initialized = true;
    } catch (error: any) {
      this.#logWarn(`Initialization failed: ${error.message}`);
      this.#initialized = false;
    }
  }

  /**
   * Capture an interaction as memory
   */
  async captureInteraction(
    prompt: string,
    response: string,
    context: any = {},
  ): Promise<any> {
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
    } catch (error: any) {
      this.#logWarn(`Failed to capture interaction: ${error.message}`);
      return null;
    }
  }

  /**
   * Recall relevant memories for a query
   */
  async recallMemories(query: string, options: any = {}): Promise<any[]> {
    try {
      if (this.#config.autoInit && !this.#initialized) {
        await this.initialize();
      }

      if (!this.#initialized) {
        return [];
      }

      const {
        limit = this.#config.recallLimit,
        useCache = this.#config.enableCache,
        memoryType = null,
        skillName = null,
      } = options;

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

      let memories: any[] = [];
      if (
        memoryType === "synthesized_skill" &&
        typeof this.#mesh.searchSkills === "function"
      ) {
        memories = await this.#mesh.searchSkills(query, { limit: fetchLimit });
      } else {
        memories = await this.#mesh.search(query, {
          limit: fetchLimit,
          filter,
          useCache: false,
        });
      }

      memories = memories.map((memory) => {
        const metadata =
          typeof memory.metadata === "string"
            ? JSON.parse(memory.metadata)
            : memory.metadata || {};

        return {
          ...memory,
          importanceScore: memory.score || metadata.importanceScore || 0,
          memoryType:
            metadata.memoryType ||
            (memoryType === "synthesized_skill"
              ? "synthesized_skill"
              : "global"),
        };
      });

      // Deduplicate by content — results are already sorted by score, so first occurrence wins
      const seen = new Set<string>();
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
          const meta =
            typeof memory.metadata === "string"
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
    } catch (error: any) {
      this.#logWarn(`Failed to recall memories: ${error.message}`);
      return [];
    }
  }

  /**
   * Format memories for inclusion in prompt
   */
  formatMemoriesForPrompt(memories: any[], options: any = {}): string {
    try {
      if (!memories || memories.length === 0) {
        return "";
      }

      return MemoryTranslator.toYAMOContext(memories, options);
    } catch (error: any) {
      this.#logWarn(`Failed to format memories: ${error.message}`);
      return "";
    }
  }

  #logWarn(message: string): void {
    if (!this.#config.silent || process.env.YAMO_DEBUG === "true") {
      logger.warn(message);
    }
  }

  #formatInteraction(prompt: string, response: string): string {
    const lines = [
      `[USER] ${prompt}`,
      `[ASSISTANT] ${response.substring(0, 500)}${response.length > 500 ? "..." : ""}`,
    ];

    return lines.join("\n\n");
  }

  #buildMetadata(context: any): any {
    const metadata: any = {
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

  #cacheKey(query: string, options: any): string {
    return `recall:${query}:${JSON.stringify(options)}`;
  }

  /**
   * Get cached result if valid
   * Race condition fix: Update timestamp atomically for LRU tracking
   */
  #getCached(key: string): any {
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

  #setCached(key: string, result: any): void {
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

  clearCache(): void {
    this.#queryCache.clear();
  }

  getCacheStats(): any {
    return {
      size: this.#queryCache.size,
      maxSize: this.#cacheConfig.maxSize,
      ttlMs: this.#cacheConfig.ttlMs,
    };
  }

  async healthCheck(): Promise<any> {
    const health: any = {
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
    } catch (error: any) {
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
  #startCleanupTimer(): void {
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
  #cleanupExpired(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

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

    if (
      expiredKeys.length > 0 &&
      (process.env.YAMO_DEBUG === "true" || !this.#config.silent)
    ) {
      logger.debug(
        { count: expiredKeys.length },
        "Cleaned up expired cache entries",
      );
    }
  }

  /**
   * Dispose of resources (cleanup timer and cache)
   * Call this when the MemoryContextManager is no longer needed
   */
  dispose(): void {
    if (this.#cleanupTimer) {
      clearInterval(this.#cleanupTimer);
      this.#cleanupTimer = null;
    }
    this.clearCache();
  }
}

export default MemoryContextManager;
