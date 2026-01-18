/**
 * MemoryContextManager - High-level memory management for YAMO
 *
 * Provides automatic memory capture and intelligent recall for YAMO interactions.
 * Integrates with MemoryMesh for storage, MemoryScorer for importance calculation,
 * and MemoryTranslator for YAMO agent formatting.
 *
 * Features:
 * - Automatic memory capture from interactions
 * - Intelligent memory recall with caching
 * - Duplicate detection
 * - YAMO agent formatting
 * - Graceful degradation on errors
 */

import { MemoryMesh } from './memory-mesh.js';
import { MemoryScorer } from './scorer.js';
import { MemoryTranslator } from './memory-translator.js';

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

  /**
   * Create a new MemoryContextManager
   * @param {Object} config - Configuration object
   * @param {MemoryMesh} [config.mesh] - Optional existing MemoryMesh instance
   * @param {boolean} [config.autoInit=true] - Auto-initialize on first use
   * @param {boolean} [config.enableCache=true] - Enable query caching
   * @param {number} [config.recallLimit=5] - Max memories to recall
   * @param {number} [config.minImportance=0.1] - Min importance score to store
   * @param {boolean} [config.silent=true] - Suppress console warnings (prevents spinner corruption)
   */
  constructor(config = {}) {
    this.#config = {
      autoInit: true,
      enableCache: true,
      recallLimit: 5,
      minImportance: 0.1,
      // Silent mode prevents console output that corrupts spinner/REPL display
      silent: config.silent !== false,
      ...config,
    };

    // Use provided mesh or create new instance
    this.#mesh = config.mesh || new MemoryMesh();
    this.#scorer = new MemoryScorer(this.#mesh);
  }

  /**
   * Initialize the memory context manager
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.#initialized) {
      return;
    }

    try {
      await this.#mesh.init();
      this.#initialized = true;
    } catch (error) {
      // Graceful degradation - silent by default to avoid corrupting spinner/REPL
      const e = error instanceof Error ? error : new Error(String(error));
      this.#logWarn(`Initialization failed: ${e.message}`);
      this.#initialized = false;
    }
  }

  /**
   * Capture an interaction as memory
   * @param {string} prompt - User prompt
   * @param {string} response - System response
   * @param {Object} context - Additional context
   * @param {string} [context.interactionType='llm_response'] - Type of interaction
   * @param {Array<string>} [context.toolsUsed] - Tools used in interaction
   * @param {Array<string>} [context.filesInvolved] - Files involved
   * @param {Array<string>} [context.tags] - Optional tags
   * @returns {Promise<Object|null>} Created memory record or null on failure
   */
  async captureInteraction(prompt, response, context = {}) {
    try {
      // Auto-initialize if needed
      if (this.#config.autoInit && !this.#initialized) {
        await this.initialize();
      }

      if (!this.#initialized) {
        return null;
      }

      // Format the interaction content
      const content = this.#formatInteraction(prompt, response);

      // Build metadata
      const metadata = this.#buildMetadata(context);

      // Check for duplicates
      const isDuplicate = await this.#scorer.isDuplicate(content);
      if (isDuplicate) {
        return null;
      }

      // Calculate importance
      const importance = await this.#scorer.calculateImportance(content, metadata);

      // Skip if below threshold
      if (importance < this.#config.minImportance) {
        return null;
      }

      // Add to memory
      const memory = await this.#mesh.add(content, {
        ...metadata,
        importanceScore: importance,
      });

      return memory;

    } catch (error) {
      // Graceful degradation - silent by default to avoid corrupting spinner/REPL
      const e = error instanceof Error ? error : new Error(String(error));
      this.#logWarn(`Failed to capture interaction: ${e.message}`);
      return null;
    }
  }

  /**
   * Recall relevant memories for a query
   * @param {string} query - Query to search for
   * @param {Object} options - Recall options
   * @param {number} [options.limit] - Max memories to recall (default from config)
   * @param {boolean} [options.useCache] - Use cache (default from config)
   * @param {string} [options.memoryType] - Filter by memory type
   * @returns {Promise<Array>} Array of relevant memories
   */
  async recallMemories(query, options = {}) {
    try {
      // Auto-initialize if needed
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
      } = options;

      // Check cache
      if (useCache) {
        const cacheKey = this.#cacheKey(query, { limit, memoryType });
        const cached = this.#getCached(cacheKey);
        if (cached) {
          return cached;
        }
      }

      // Build filter if memoryType specified
      const filter = memoryType ? `memoryType == '${memoryType}'` : null;

      // Search memories
      // @ts-ignore
      let memories = await this.#mesh.search(query, { limit, filter, useCache: false });

      // Add importance scores
      memories = await Promise.all(memories.map(async (memory) => {
        const metadata = typeof memory.metadata === 'string'
          ? JSON.parse(memory.metadata)
          : memory.metadata || {};

        return {
          ...memory,
          importanceScore: metadata.importanceScore || 0,
          memoryType: metadata.memoryType || 'global',
        };
      }));

      // Cache results
      if (useCache) {
        const cacheKey = this.#cacheKey(query, { limit, memoryType });
        this.#setCached(cacheKey, memories);
      }

      return memories;

    } catch (error) {
      // Graceful degradation - silent by default to avoid corrupting spinner/REPL
      const e = error instanceof Error ? error : new Error(String(error));
      this.#logWarn(`Failed to recall memories: ${e.message}`);
      return [];
    }
  }

  /**
   * Format memories for inclusion in prompt
   * @param {Array} memories - Memories to format
   * @param {Object} options - Formatting options
   * @param {string} [options.mode='background_context'] - YAMO agent mode
   * @param {boolean} [options.includeMetadata=true] - Include metadata
   * @param {number} [options.maxContentLength=500] - Max content length per memory
   * @returns {string} Formatted memories ready for prompt injection
   */
  formatMemoriesForPrompt(memories, options = {}) {
    try {
      if (!memories || memories.length === 0) {
        return '';
      }

      return MemoryTranslator.toYAMOContext(memories, options);

    } catch (error) {
      // Graceful degradation - silent by default to avoid corrupting spinner/REPL
      const e = error instanceof Error ? error : new Error(String(error));
      this.#logWarn(`Failed to format memories: ${e.message}`);
      return '';
    }
  }

  /**
   * Log warning message (respects silent mode to avoid corrupting spinner/REPL)
   */
  #logWarn(message) {
    // Only log if not in silent mode or if YAMO_DEBUG is set
    if (!this.#config.silent || process.env.YAMO_DEBUG === 'true') {
      console.warn(`[MemoryContextManager] ${message}`);
    }
  }

  /**
   * Format interaction for storage
   */
  #formatInteraction(prompt, response) {
    // Create a structured representation
    const lines = [
      `[USER] ${prompt}`,
      `[ASSISTANT] ${response.substring(0, 500)}${response.length > 500 ? '...' : ''}`,
    ];

    return lines.join('\n\n');
  }

  /**
   * Build metadata object from context
   */
  #buildMetadata(context) {
    const metadata = {
      interaction_type: context.interactionType || 'llm_response',
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

  /**
   * Generate cache key
   */
  #cacheKey(query, options) {
    return `recall:${query}:${JSON.stringify(options)}`;
  }

  /**
   * Get cached result
   */
  #getCached(key) {
    const entry = this.#queryCache.get(key);
    if (!entry) {
      return null;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > this.#cacheConfig.ttlMs) {
      this.#queryCache.delete(key);
      return null;
    }

    // Move to end (MRU)
    this.#queryCache.delete(key);
    this.#queryCache.set(key, entry);

    return entry.result;
  }

  /**
   * Set cached result
   */
  #setCached(key, result) {
    // Evict oldest if at max size
    if (this.#queryCache.size >= this.#cacheConfig.maxSize) {
      const firstKey = this.#queryCache.keys().next().value;
      this.#queryCache.delete(firstKey);
    }

    this.#queryCache.set(key, {
      result,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear the query cache
   */
  clearCache() {
    this.#queryCache.clear();
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getCacheStats() {
    return {
      size: this.#queryCache.size,
      maxSize: this.#cacheConfig.maxSize,
      ttlMs: this.#cacheConfig.ttlMs,
    };
  }

  /**
   * Health check for the memory context manager
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      initialized: this.#initialized,
      checks: {},
    };

    // Check mesh
    try {
      health.checks.mesh = await this.#mesh.healthCheck();
      if (health.checks.mesh.status !== 'healthy') {
        health.status = 'degraded';
      }
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      health.checks.mesh = {
        status: 'error',
        error: e.message,
      };
      health.status = 'unhealthy';
    }

    // Check cache
    health.checks.cache = {
      status: 'up',
      size: this.#queryCache.size,
      maxSize: this.#cacheConfig.maxSize,
    };

    return health;
  }
}

export default MemoryContextManager;
