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

import { fileURLToPath } from 'url';
import fs from "fs";
import { LanceDBClient } from "../lancedb/client.js";
import { getConfig } from "../lancedb/config.js";
import { getEmbeddingDimension } from "../lancedb/schema.js";
import { handleError, StorageError, QueryError } from "../lancedb/errors.js";
import EmbeddingFactory from "../embeddings/factory.js";
import { Scrubber } from "../smora/scrubber/scrubber.js";

/**
 * MemoryMesh class for managing vector memory storage
 */
class MemoryMesh {
  /**
   * Create a new MemoryMesh instance
   */
  constructor() {
    this.client = null;
    this.config = null;
    this.embeddingFactory = new EmbeddingFactory();
    this.isInitialized = false;
    this.vectorDimension = 384; // Will be set during init()

    // Scrubber for Layer 0 sanitization
    this.scrubber = new Scrubber({ 
      enabled: true,
      chunking: {
        minTokens: 1 // Allow short memories
      },
      validation: {
        enforceMinLength: false // Disable strict length validation
      }
    });

    // Simple LRU cache for search queries (5 minute TTL)
    this.queryCache = new Map();
    this.cacheConfig = {
      maxSize: 500,
      ttlMs: 5 * 60 * 1000, // 5 minutes
    };
  }

  /**
   * Generate a cache key from query and options
   * @private
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {string} Cache key
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
   * @param {string} key - Cache key
   * @returns {Object|null} Cached result or null if expired/missing
   */
  _getCachedResult(key) {
    const entry = this.queryCache.get(key);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > this.cacheConfig.ttlMs) {
      this.queryCache.delete(key);
      return null;
    }

    // Move to end (most recently used)
    this.queryCache.delete(key);
    this.queryCache.set(key, entry);

    return entry.result;
  }

  /**
   * Cache a search result
   * @private
   * @param {string} key - Cache key
   * @param {Object} result - Search result to cache
   */
  _cacheResult(key, result) {
    // Evict oldest if at max size
    if (this.queryCache.size >= this.cacheConfig.maxSize) {
      const firstKey = this.queryCache.keys().next().value;
      this.queryCache.delete(firstKey);
    }

    this.queryCache.set(key, {
      result,
      timestamp: Date.now()
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
   * @returns {Object} Cache stats
   */
  getCacheStats() {
    return {
      size: this.queryCache.size,
      maxSize: this.cacheConfig.maxSize,
      ttlMs: this.cacheConfig.ttlMs
    };
  }

  /**
   * Validate and sanitize metadata to prevent prototype pollution
   * @param {Object} metadata - Metadata to validate
   * @returns {Object} Sanitized metadata
   * @private
   */
  _validateMetadata(metadata) {
    if (typeof metadata !== 'object' || metadata === null) {
      throw new Error('Metadata must be a non-null object');
    }

    // Sanitize keys to prevent prototype pollution
    const sanitized = {};
    for (const [key, value] of Object.entries(metadata)) {
      // Skip dangerous keys that could pollute prototype
      // Note: 'constructor' and 'prototype' are handled by hasOwnProperty check
      // '.__proto__' needs explicit check because Object.entries() doesn't include it
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
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
   * @param {string} content - Content to sanitize
   * @returns {string} Sanitized content
   * @private
   */
  _sanitizeContent(content) {
    if (typeof content !== 'string') {
      throw new Error('Content must be a string');
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
   * @returns {Promise<void>}
   */
  async init() {
    if (this.isInitialized) {
      return;
    }

    try {
      // Load configuration
      this.config = getConfig();

      // Detect vector dimension from embedding model configuration
      const modelName = process.env.EMBEDDING_MODEL_NAME || 'Xenova/all-MiniLM-L6-v2';
      const envDimension = parseInt(process.env.EMBEDDING_DIMENSION) || null;
      this.vectorDimension = envDimension || getEmbeddingDimension(modelName);

      // Only log in debug mode to avoid corrupting spinner/REPL display
      if (process.env.YAMO_DEBUG === 'true') {
        console.error(`[MemoryMesh] Using vector dimension: ${this.vectorDimension} (model: ${modelName})`);
      }

      // Create LanceDB client with detected dimension
      this.client = new LanceDBClient({
        uri: this.config.LANCEDB_URI,
        tableName: this.config.LANCEDB_MEMORY_TABLE,
        vectorDimension: this.vectorDimension
      });

      // Connect to database
      await this.client.connect();

      // Configure embedding factory from environment
      const embeddingConfigs = this._parseEmbeddingConfig();
      this.embeddingFactory.configure(embeddingConfigs);
      await this.embeddingFactory.init();

      this.isInitialized = true;

    } catch (error) {
      throw handleError(error, { context: 'MemoryMesh.init' });
    }
  }

  /**
   * Add content to memory with auto-generated embedding
   * @param {string} content - Text content to store
   * @param {Object} metadata - Optional metadata tags
   * @returns {Promise<Object>} Created record with ID
   */
  async add(content, metadata = {}) {
    await this.init();

    try {
      // Layer 0: Scrubber Sanitization
      let processedContent = content;
      let scrubbedMetadata = {};
      
      try {
        const scrubbedResult = await this.scrubber.process({
          content: content,
          source: 'memory-api',
          type: 'txt' // Default to text
        });

        if (scrubbedResult.success && scrubbedResult.chunks.length > 0) {
          // Reconstruct cleaned content
          processedContent = scrubbedResult.chunks.map(c => c.text).join('\n\n');
          
          // Merge scrubber telemetry/metadata if useful
          if (scrubbedResult.metadata) {
             scrubbedMetadata = {
               ...scrubbedResult.metadata,
               scrubber_telemetry: JSON.stringify(scrubbedResult.telemetry)
             };
          }
        }
      } catch (scrubError) {
        // Fallback to raw content if scrubber fails, but log it
        if (process.env.YAMO_DEBUG === 'true') {
           console.error(`[MemoryMesh] Scrubber failed: ${scrubError.message}`);
        }
      }

      // Validate and sanitize inputs (legacy check)
      const sanitizedContent = this._sanitizeContent(processedContent);
      const sanitizedMetadata = this._validateMetadata({ ...metadata, ...scrubbedMetadata });

      // Generate ID
      const id = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Generate embedding using EmbeddingFactory
      const vector = await this.embeddingFactory.embed(sanitizedContent);

      // Prepare record data with sanitized metadata
      const record = {
        id,
        vector,
        content: sanitizedContent,
        metadata: JSON.stringify(sanitizedMetadata)
      };


      // Add to LanceDB
      const result = await this.client.add(record);

      return {
        id: result.id,
        content: sanitizedContent,
        metadata: sanitizedMetadata,
        created_at: new Date().toISOString()
      };


    } catch (error) {
      throw handleError(error, { context: 'MemoryMesh.add' });
    }
  }

  /**
   * Add multiple memory entries in batch for efficiency
   * @param {Array<{content: string, metadata?: Object}>} entries - Array of entries to add
   * @returns {Promise<Object>} Result with count and IDs
   */
  async addBatch(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error('Entries must be a non-empty array');
    }

    await this.init();

    try {
      const now = Date.now();
      const records = [];

      // Process entries in parallel for embeddings
      const embeddingPromises = entries.map(async (entry, index) => {
        // Layer 0: Scrubber Sanitization
        let processedContent = entry.content;
        let scrubbedMetadata = {};

        try {
          const scrubbedResult = await this.scrubber.process({
            content: entry.content,
            source: 'memory-batch',
            type: 'txt'
          });

          if (scrubbedResult.success && scrubbedResult.chunks.length > 0) {
            processedContent = scrubbedResult.chunks.map(c => c.text).join('\n\n');
             if (scrubbedResult.metadata) {
               scrubbedMetadata = {
                 ...scrubbedResult.metadata,
                 scrubber_telemetry: JSON.stringify(scrubbedResult.telemetry)
               };
            }
          }
        } catch (e) {
           // Fallback silently
        }

        const sanitizedContent = this._sanitizeContent(processedContent);
        const sanitizedMetadata = this._validateMetadata({ ...(entry.metadata || {}), ...scrubbedMetadata });

        const id = `mem_${now}_${Math.random().toString(36).substr(2, 9)}_${index}`;
        const vector = await this.embeddingFactory.embed(sanitizedContent);

        return {
          id,
          vector,
          content: sanitizedContent,
          metadata: JSON.stringify(sanitizedMetadata)
        };
      });

      const recordsWithEmbeddings = await Promise.all(embeddingPromises);

      // Add all records to database
      const result = await this.client.addBatch(recordsWithEmbeddings);

      return {
        count: result.count,
        success: result.success,
        ids: recordsWithEmbeddings.map(r => r.id)
      };

    } catch (error) {
      throw handleError(error, { context: 'MemoryMesh.addBatch', count: entries.length });
    }
  }

  /**
   * Search memory by semantic similarity
   * @param {string} query - Search query text
   * @param {Object} options - Search options
   * @param {number} [options.limit=10] - Maximum number of results
   * @param {string} [options.filter] - Optional filter expression
   * @returns {Promise<Array>} Search results with scores
   */
  async search(query, options = {}) {
    await this.init();

    try {
      const { limit = 10, filter = null, useCache = true } = options;

      // Check cache first (unless disabled)
      if (useCache) {
        const cacheKey = this._generateCacheKey(query, { limit, filter });
        const cached = this._getCachedResult(cacheKey);
        if (cached) {
          return cached;
        }
      }

      // Generate embedding using EmbeddingFactory
      const vector = await this.embeddingFactory.embed(query);

      // Perform semantic search
      const results = await this.client.search(vector, {
        limit,
        metric: 'cosine',
        filter
      });

      // Format results
      const formattedResults = results.map(result => ({
        id: result.id,
        content: result.content,
        metadata: result.metadata,
        score: result.score,
        created_at: result.created_at
      }));

      // Cache the result (unless disabled)
      if (useCache) {
        const cacheKey = this._generateCacheKey(query, { limit, filter });
        this._cacheResult(cacheKey, formattedResults);
      }

      return formattedResults;

    } catch (error) {
      throw handleError(error, { context: 'MemoryMesh.search', query });
    }
  }

  /**
   * Get a record by ID
   * @param {string} id - Record ID
   * @returns {Promise<Object|null>} Record object or null if not found
   */
  async get(id) {
    await this.init();

    try {
      const record = await this.client.getById(id);

      if (!record) {
        return null;
      }

      return {
        id: record.id,
        content: record.content,
        metadata: record.metadata,
        created_at: record.created_at,
        updated_at: record.updated_at
      };


    } catch (error) {
      throw handleError(error, { context: 'MemoryMesh.get', id });
    }
  }

  /**
   * Get all memory records
   * @param {Object} options - Options
   * @param {number} [options.limit] - Limit results
   * @returns {Promise<Array>} Array of records
   */
  async getAll(options = {}) {
    await this.init();
    try {
      return await this.client.getAll(options);
    } catch (error) {
      throw handleError(error, { context: 'MemoryMesh.getAll' });
    }
  }

  /**
   * Update a memory record
   * @param {string} id - Record ID
   * @param {string} content - New content
   * @param {Object} metadata - New metadata
   * @returns {Promise<Object>} Result
   */
  async update(id, content, metadata = {}) {
    await this.init();

    try {
      // Layer 0: Scrubber Sanitization
      let processedContent = content;
      let scrubbedMetadata = {};
      
      try {
        const scrubbedResult = await this.scrubber.process({
          content: content,
          source: 'memory-update',
          type: 'txt'
        });

        if (scrubbedResult.success && scrubbedResult.chunks.length > 0) {
          processedContent = scrubbedResult.chunks.map(c => c.text).join('\n\n');
          if (scrubbedResult.metadata) {
             scrubbedMetadata = {
               ...scrubbedResult.metadata,
               scrubber_telemetry: JSON.stringify(scrubbedResult.telemetry)
             };
          }
        }
      } catch (e) {
        // Fallback
      }

      const sanitizedContent = this._sanitizeContent(processedContent);
      const sanitizedMetadata = this._validateMetadata({ ...metadata, ...scrubbedMetadata });

      // Re-generate embedding
      const vector = await this.embeddingFactory.embed(sanitizedContent);

      const updateData = {
        vector,
        content: sanitizedContent,
        metadata: JSON.stringify(sanitizedMetadata)
      };

      const result = await this.client.update(id, updateData);

      return {
        id: result.id,
        content: sanitizedContent,
        success: result.success
      };

    } catch (error) {
      throw handleError(error, { context: 'MemoryMesh.update', id });
    }
  }

  /**
   * Delete a record by ID
   * @param {string} id - Record ID to delete
   * @returns {Promise<Object>} Result with success status
   */
  async delete(id) {
    await this.init();

    try {
      const result = await this.client.delete(id);

      return {
        deleted: result.id,
        success: result.success
      };


    } catch (error) {
      throw handleError(error, { context: 'MemoryMesh.delete', id });
    }
  }

  /**
   * Get database statistics
   * @returns {Promise<Object>} Statistics including count, size, etc.
   */
  async stats() {
    await this.init();

    try {
      const dbStats = await this.client.getStats();
      const embeddingStats = this.embeddingFactory.getStats();

      return {
        count: dbStats.count,
        tableName: dbStats.tableName,
        uri: dbStats.uri,
        isConnected: dbStats.isConnected,
        embedding: embeddingStats
      };


    } catch (error) {
      throw handleError(error, { context: 'MemoryMesh.stats' });
    }
  }

  /**
   * Health check for MemoryMesh
   * @returns {Promise<Object>} Health status with checks for all components
   */
  async healthCheck() {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      checks: {}
    };

    // Check 1: Database connectivity
    try {
      const startDb = Date.now();
      await this.init();
      const dbLatency = Date.now() - startDb;

      health.checks.database = {
        status: 'up',
        latency: dbLatency,
        isConnected: this.client?.isConnected || false,
        tableName: this.client?.tableName || 'unknown'
      };
    } catch (error) {
      health.checks.database = {
        status: 'error',
        error: error.message
      };
      health.status = 'degraded';
    }

    // Check 2: Embedding service
    try {
      const startEmbedding = Date.now();
      const testEmbedding = await this.embeddingFactory.embed('health check');
      const embeddingLatency = Date.now() - startEmbedding;

      health.checks.embedding = {
        status: 'up',
        latency: embeddingLatency,
        dimension: testEmbedding.length,
        configured: true
      };
    } catch (error) {
      health.checks.embedding = {
        status: 'error',
        error: error.message
      };
      health.status = 'degraded';
    }

    // Check 3: Get stats (verifies read operations work)
    try {
      const stats = await this.stats();
      health.checks.stats = {
        status: 'up',
        recordCount: stats.count || 0
      };
    } catch (error) {
      health.checks.stats = {
        status: 'warning',
        error: error.message
      };
      // Don't degrade status for stats failure - it's not critical
    }

    // Check 4: Cache status (if caching enabled)
    if (this.queryCache) {
      health.checks.cache = {
        status: 'up',
        size: this.queryCache.size || 0,
        max: this.cacheConfig?.maxSize || 'unknown'
      };
    }

    return health;
  }

  /**
   * Parse embedding configuration from environment
   * @private
   */
  _parseEmbeddingConfig() {
    const configs = [];

    // Primary: from EMBEDDING_MODEL_TYPE
    configs.push({
      modelType: process.env.EMBEDDING_MODEL_TYPE || 'local',
      modelName: process.env.EMBEDDING_MODEL_NAME || 'Xenova/all-MiniLM-L6-v2',
      dimension: parseInt(process.env.EMBEDDING_DIMENSION) || 384,
      priority: 1,
      apiKey: process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || process.env.COHERE_API_KEY
    });

    // Fallback 1: local model (if primary is API)
    if (configs[0].modelType !== 'local') {
      configs.push({
        modelType: 'local',
        modelName: 'Xenova/all-MiniLM-L6-v2',
        dimension: 384,
        priority: 2
      });
    }

    // Fallback 2: OpenAI (if key available)
    if (process.env.OPENAI_API_KEY && configs[0].modelType !== 'openai') {
      configs.push({
        modelType: 'openai',
        modelName: 'text-embedding-3-small',
        dimension: 1536,
        priority: 3,
        apiKey: process.env.OPENAI_API_KEY
      });
    }

    return configs;
  }

  /**
   * Build a LanceDB filter expression from an object
   * Supports basic filtering on metadata fields
   * @param {Object} filter - Filter object
   * @returns {string} LanceDB filter expression
   * @private
   */
  _buildFilter(filter) {
    if (!filter || typeof filter !== 'object') {
      return null;
    }

    const conditions = [];

    for (const [key, value] of Object.entries(filter)) {
      if (typeof value === 'string') {
        conditions.push(`${key} == '${value}'`);
      } else if (typeof value === 'number') {
        conditions.push(`${key} == ${value}`);
      } else if (typeof value === 'boolean') {
        conditions.push(`${key} == ${value}`);
      }
      // Note: Complex filtering on JSON metadata field not supported
      // Filters work on top-level schema fields only
    }

    return conditions.length > 0 ? conditions.join(' AND ') : null;
  }
}

/**
 * Main CLI handler
 */
async function run() {
  let action, input;

  // Check if arguments are provided via CLI
  if (process.argv.length > 3) {
    action = process.argv[2];
    try {
      input = JSON.parse(process.argv[3]);
    } catch (e) {
      const errorResponse = handleError(e, { context: 'CLI argument parsing' });
      console.error(`❌ Error: Invalid JSON argument: ${e.message}`);
      console.error(`Received: ${process.argv[3]}`);
      console.error(JSON.stringify(errorResponse, null, 2));
      process.exit(1);
    }
  } else {
    // Fallback to STDIN for System Skill compatibility
    try {
      const rawInput = fs.readFileSync(0, 'utf8');
      const data = JSON.parse(rawInput);
      action = data.action || action;
      input = data;
    } catch (e) {
      const errorResponse = handleError(e, { context: 'STDIN parsing' });
      console.error("❌ Error: No input provided via CLI or STDIN.");
      console.error(`Details: ${e.message}`);
      console.error(JSON.stringify(errorResponse, null, 2));
      process.exit(1);
    }
  }

  // Create MemoryMesh instance
  const mesh = new MemoryMesh();

  try {
    // Route to appropriate action
    if (action === 'ingest') {
      // Validate required fields
      if (!input.content) {
        console.error('❌ Error: "content" field is required for ingest action');
        process.exit(1);
      }

      const record = await mesh.add(input.content, input.metadata || {});
      console.log(`[MemoryMesh] Ingested record ${record.id}`);
      console.log(JSON.stringify({ status: "ok", record }));

    } else if (action === 'search') {
      // Validate required fields
      if (!input.query) {
        console.error('❌ Error: "query" field is required for search action');
        process.exit(1);
      }

      const options = {
        limit: input.limit || 10,
        filter: input.filter || null
      };


      const results = await mesh.search(input.query, options);
      console.log(`[MemoryMesh] Found ${results.length} matches.`);

      const jsonResult = JSON.stringify(results, null, 2);
      // YAMO Skill compatibility: Output as a marked block for auto-saving
      console.log(`\n**Output**: memory_results.json
\`\`\`json
${jsonResult}
\`\`\`
`);
      // Also output raw JSON for STDIN callers
      console.log(JSON.stringify({ status: "ok", results }));

    } else if (action === 'get') {
      // Validate required fields
      if (!input.id) {
        console.error('❌ Error: "id" field is required for get action');
        process.exit(1);
      }

      const record = await mesh.get(input.id);

      if (!record) {
        console.log(JSON.stringify({ status: "ok", record: null }));
      } else {
        console.log(JSON.stringify({ status: "ok", record }));
      }

    } else if (action === 'delete') {
      // Validate required fields
      if (!input.id) {
        console.error('❌ Error: "id" field is required for delete action');
        process.exit(1);
      }

      const result = await mesh.delete(input.id);
      console.log(`[MemoryMesh] Deleted record ${result.deleted}`);
      console.log(JSON.stringify({ status: "ok", ...result }));

    } else if (action === 'stats') {
      const stats = await mesh.stats();
      console.log('[MemoryMesh] Database Statistics:');
      console.log(JSON.stringify({ status: "ok", stats }, null, 2));

    } else {
      console.error(`❌ Error: Unknown action "${action}". Valid actions: ingest, search, get, delete, stats`);
      process.exit(1);
    }

  } catch (error) {
    // Handle errors using the error handler
    const errorResponse = handleError(error, { action, input: { ...input, content: input.content ? '[REDACTED]' : undefined } });

    if (errorResponse.success === false) {
      console.error(`❌ Fatal Error: ${errorResponse.error.message}`);
      if (process.env.NODE_ENV === 'development' && errorResponse.error.details) {
        console.error(`Details:`, errorResponse.error.details);
      }
      console.error(JSON.stringify(errorResponse, null, 2));
    } else {
      console.error(`❌ Fatal Error: ${error.message}`);
      console.error(error.stack);
    }

    process.exit(1);
  }
}

// Export for testing
export { MemoryMesh };
export default MemoryMesh;

// Run CLI if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch(err => {
    console.error(`❌ Fatal Error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  });
}
