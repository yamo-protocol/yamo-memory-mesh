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
import crypto from "crypto";
import { LanceDBClient } from "../lancedb/client.js";
import { getConfig } from "../lancedb/config.js";
import { getEmbeddingDimension } from "../lancedb/schema.js";
import { handleError, StorageError, QueryError } from "../lancedb/errors.js";
import EmbeddingFactory from "../embeddings/factory.js";
import { Scrubber } from "../scrubber/scrubber.js";
import { KeywordSearch } from "../search/keyword-search.js";
import { YamoEmitter } from "../yamo/emitter.js";
import { LLMClient } from "../llm/client.js";

/**
 * MemoryMesh class for managing vector memory storage
 */
class MemoryMesh {
  /**
   * Create a new MemoryMesh instance
   * @param {Object} [options={}] - Configuration options
   * @param {boolean} [options.enableYamo=true] - Enable YAMO block emission
   * @param {boolean} [options.enableLLM=true] - Enable LLM for reflections
   * @param {string} [options.agentId='default'] - Agent identifier for YAMO blocks
   * @param {string} [options.llmProvider] - LLM provider (openai, anthropic, ollama)
   * @param {string} [options.llmApiKey] - LLM API key
   * @param {string} [options.llmModel] - LLM model name
   */
  constructor(options = {}) {
    this.client = null;
    this.config = null;
    this.embeddingFactory = new EmbeddingFactory();
    this.keywordSearch = new KeywordSearch();
    this.isInitialized = false;
    this.vectorDimension = 384; // Will be set during init()

    // YAMO and LLM support
    this.enableYamo = options.enableYamo !== false;  // Default: true
    this.enableLLM = options.enableLLM !== false;    // Default: true
    this.agentId = options.agentId || 'default';
    this.yamoTable = null;  // Will be initialized in init()
    this.llmClient = null;

    // Initialize LLM client if enabled
    if (this.enableLLM) {
      this.llmClient = new LLMClient({
        provider: options.llmProvider,
        apiKey: options.llmApiKey,
        model: options.llmModel
      });
    }

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
      const envDimension = parseInt(process.env.EMBEDDING_DIMENSION || '0') || null;
      this.vectorDimension = envDimension || getEmbeddingDimension(modelName);

      // Only log in debug mode to avoid corrupting spinner/REPL display
      if (process.env.YAMO_DEBUG === 'true') {
        console.error(`[MemoryMesh] Using vector dimension: ${this.vectorDimension} (model: ${modelName})`);
      }

      // Create LanceDBClient with detected dimension
      this.client = new LanceDBClient({
        uri: this.config.LANCEDB_URI,
        tableName: this.config.LANCEDB_MEMORY_TABLE,
        vectorDimension: this.vectorDimension,
        maxRetries: 3,
        retryDelay: 1000
      });

      // Connect to database
      await this.client.connect();

      // Configure embedding factory from environment
      const embeddingConfigs = this._parseEmbeddingConfig();
      this.embeddingFactory.configure(embeddingConfigs);
      await this.embeddingFactory.init();

      // Hydrate Keyword Search (In-Memory)
      // Note: This is efficient for small datasets (< 10k).
      // For larger, we should persist the inverted index or use LanceDB FTS.
      if (this.client) {
        try {
          const allRecords = await this.client.getAll({ limit: 10000 });
          this.keywordSearch.load(allRecords);
        } catch (e) {
          // Ignore if table doesn't exist yet
        }
      }

      // Initialize YAMO blocks table if enabled
      if (this.enableYamo && this.client && this.client.db) {
        try {
          const { createYamoTable } = await import('../yamo/schema.js');
          this.yamoTable = await createYamoTable(this.client.db, 'yamo_blocks');
          if (process.env.YAMO_DEBUG === 'true') {
            console.error('[MemoryMesh] YAMO blocks table initialized');
          }
        } catch (e) {
          // Log warning but don't fail initialization
          console.warn('[MemoryMesh] Failed to initialize YAMO table:', e instanceof Error ? e.message : String(e));
        }
      }

      this.isInitialized = true;

    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      throw e;
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

    // Default to 'event' if no type provided
    const type = metadata.type || 'event';
    const enrichedMetadata = { ...metadata, type };

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
           const message = scrubError instanceof Error ? scrubError.message : String(scrubError);
           console.error(`[MemoryMesh] Scrubber failed: ${message}`);
        }
      }

      // Validate and sanitize inputs (legacy check)
      const sanitizedContent = this._sanitizeContent(processedContent);
      const sanitizedMetadata = this._validateMetadata({ ...enrichedMetadata, ...scrubbedMetadata });

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
      if (!this.client) throw new Error('Database client not initialized');
      const result = await this.client.add(record);

      // Add to Keyword Search
      this.keywordSearch.add(record.id, record.content, sanitizedMetadata);

      // Emit YAMO block for retain operation (async, non-blocking)
      if (this.enableYamo) {
        // Fire and forget - don't await
        this._emitYamoBlock('retain', result.id, YamoEmitter.buildRetainBlock({
          content: sanitizedContent,
          metadata: sanitizedMetadata,
          id: result.id,
          agentId: this.agentId,
          memoryType: sanitizedMetadata.type || 'event'
        })).catch(err => {
          if (process.env.YAMO_DEBUG === 'true') {
            console.error('[MemoryMesh] YAMO emission failed in add():', err);
          }
        });
      }

      return {
        id: result.id,
        content: sanitizedContent,
        metadata: sanitizedMetadata,
        created_at: new Date().toISOString()
      };


    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      throw e;
    }
  }

  /**
   * Reflect on recent memories to generate insights (enhanced with LLM + YAMO)
   * @param {Object} options
   * @param {string} [options.topic] - Topic to search for
   * @param {number} [options.lookback=10] - Number of memories to consider
   * @param {boolean} [options.generate=true] - Whether to generate reflection via LLM
   * @returns {Promise<Object>} Reflection result with YAMO block
   */
  async reflect(options = {}) {
    await this.init();

    const lookback = options.lookback || 10;
    const topic = options.topic;
    const generate = options.generate !== false;

    // Gather memories
    let memories = [];
    if (topic) {
      memories = await this.search(topic, { limit: lookback });
    } else {
      const all = await this.getAll();
      memories = all
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, lookback);
    }

    const prompt = `Review these memories. Synthesize a high-level "belief" or "observation".`;

    // Check if LLM generation is requested and available
    if (!generate || !this.enableLLM || !this.llmClient) {
      // Return prompt-only mode (backward compatible)
      return {
        topic,
        count: memories.length,
        context: memories.map(m => ({
          content: m.content,
          type: m.metadata?.type || 'event',
          id: m.id
        })),
        prompt
      };
    }

    // Generate reflection via LLM
    let reflection = null;
    let confidence = 0;

    try {
      const result = await this.llmClient.reflect(prompt, memories);
      reflection = result.reflection;
      confidence = result.confidence;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`[MemoryMesh] LLM reflection failed: ${errorMessage}`);
      // Fall back to simple aggregation
      reflection = `Aggregated from ${memories.length} memories on topic: ${topic || 'general'}`;
      confidence = 0.5;
    }

    // Store reflection to memory
    const reflectionId = `reflect_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    await this.add(reflection, {
      type: 'reflection',
      topic: topic || 'general',
      source_memory_count: memories.length,
      confidence,
      generated_at: new Date().toISOString()
    });

    // Emit YAMO block if enabled
    let yamoBlock = null;
    if (this.enableYamo) {
      yamoBlock = YamoEmitter.buildReflectBlock({
        topic: topic || 'general',
        memoryCount: memories.length,
        agentId: this.agentId,
        reflection,
        confidence
      });

      await this._emitYamoBlock('reflect', reflectionId, yamoBlock);
    }

    return {
      id: reflectionId,
      topic: topic || 'general',
      reflection,
      confidence,
      sourceMemoryCount: memories.length,
      yamoBlock,
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Emit a YAMO block to the YAMO blocks table
   * @private
   * @param {string} operationType - 'retain', 'recall', 'reflect'
   * @param {string|undefined} memoryId - Associated memory ID (undefined for recall)
   * @param {string} yamoText - The YAMO block text
   */
  async _emitYamoBlock(operationType, memoryId, yamoText) {
    if (!this.yamoTable) {
      if (process.env.YAMO_DEBUG === 'true') {
        console.warn('[MemoryMesh] YAMO table not initialized, skipping emission');
      }
      return;
    }

    const yamoId = `yamo_${operationType}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    try {
      await this.yamoTable.add([{
        id: yamoId,
        agent_id: this.agentId,
        operation_type: operationType,
        yamo_text: yamoText,
        timestamp: new Date(),
        block_hash: null,  // Future: blockchain anchoring
        prev_hash: null,
        metadata: JSON.stringify({
          memory_id: memoryId || null,
          timestamp: new Date().toISOString()
        })
      }]);

      if (process.env.YAMO_DEBUG === 'true') {
        console.log(`[MemoryMesh] YAMO block emitted: ${yamoId}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[MemoryMesh] Failed to emit YAMO block: ${errorMessage}`);
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
      if (!this.client) throw new Error('Database client not initialized');
      const result = await this.client.addBatch(recordsWithEmbeddings);

      return {
        count: result.count,
        success: result.success,
        ids: recordsWithEmbeddings.map(r => r.id)
      };

    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      throw e;
    }
  }

  /**
   * Search memory by semantic similarity
   * @param {string} query - Search query text
   * @param {Object} options - Search options
   * @param {number} [options.limit=10] - Maximum number of results
   * @param {string} [options.filter] - Optional filter expression
   * @param {boolean} [options.useCache=true] - Whether to use query cache
   * @returns {Promise<Array>} Search results with scores
   */
  async search(query, options = {}) {
    await this.init();

    try {
      const limit = options.limit || 10;
      const filter = options.filter || null;
      // @ts-ignore
      const useCache = options.useCache !== undefined ? options.useCache : true;

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

      // 1. Vector Search
      if (!this.client) throw new Error('Database client not initialized');
      const vectorResults = await this.client.search(vector, {
        limit: limit * 2, // Fetch more for re-ranking
        metric: 'cosine',
        filter
      });

      // 2. Keyword Search
      const keywordResults = this.keywordSearch.search(query, { limit: limit * 2 });

      // 3. Reciprocal Rank Fusion (RRF)
      const k = 60; // RRF constant
      const scores = new Map(); // id -> score
      const docMap = new Map(); // id -> doc

      // Process Vector Results
      vectorResults.forEach((doc, rank) => {
        const rrf = 1 / (k + rank + 1);
        scores.set(doc.id, (scores.get(doc.id) || 0) + rrf);
        docMap.set(doc.id, doc);
      });

      // Process Keyword Results
      keywordResults.forEach((doc, rank) => {
        const rrf = 1 / (k + rank + 1);
        scores.set(doc.id, (scores.get(doc.id) || 0) + rrf);
        
        if (!docMap.has(doc.id)) {
           // Add keyword-only match
           docMap.set(doc.id, {
             id: doc.id,
             content: doc.content,
             metadata: doc.metadata,
             score: 0, // Base score, will be overwritten
             created_at: new Date().toISOString() // Approximate or missing
           });
        }
      });

      // Sort by RRF score
      const mergedResults = Array.from(scores.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([id, score]) => {
          const doc = docMap.get(id);
          if (doc) return { ...doc, score }; 
          return null; 
        })
        .filter(d => d !== null);

      // Cache the result (unless disabled)
      if (useCache) {
        const cacheKey = this._generateCacheKey(query, { limit, filter });
        this._cacheResult(cacheKey, mergedResults);
      }

      // Emit YAMO block for recall operation (async, non-blocking)
      if (this.enableYamo) {
        this._emitYamoBlock('recall', undefined, YamoEmitter.buildRecallBlock({
          query,
          resultCount: mergedResults.length,
          limit,
          agentId: this.agentId,
          searchType: 'hybrid'
        })).catch(err => {
          if (process.env.YAMO_DEBUG === 'true') {
            console.error('[MemoryMesh] YAMO emission failed in search():', err);
          }
        });
      }

      return mergedResults;

    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      throw e;
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
      if (!this.client) throw new Error('Database client not initialized');
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
      const e = error instanceof Error ? error : new Error(String(error));
      throw e;
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
      if (!this.client) throw new Error('Database client not initialized');
      return await this.client.getAll(options);
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      throw e;
    }
  }

  /**
   * Get YAMO blocks for this agent (audit trail)
   * @param {Object} options - Query options
   * @param {string} [options.operationType] - Filter by operation type ('retain', 'recall', 'reflect')
   * @param {number} [options.limit=10] - Max results to return
   * @returns {Promise<Array>} List of YAMO blocks
   */
  async getYamoLog(options = {}) {
    if (!this.yamoTable) {
      return [];
    }

    const limit = options.limit || 10;
    const operationType = options.operationType;

    try {
      // Use search with empty vector to get all records, then filter
      // This avoids using the protected execute() method
      const allResults = [];

      // Build query manually using the LanceDB table
      // @ts-ignore - LanceDB types may not match exactly
      const table = this.yamoTable;

      // Get all records and filter
      // @ts-ignore
      const records = await table.query().limit(limit * 2).toArrow();

      // Process Arrow table
      for (const row of records) {
        const opType = row.operationType;
        if (!operationType || opType === operationType) {
          allResults.push({
            id: row.id,
            agentId: row.agentId,
            operationType: row.operationType,
            yamoText: row.yamoText,
            timestamp: row.timestamp,
            blockHash: row.blockHash,
            metadata: row.metadata ? JSON.parse(row.metadata) : null
          });

          if (allResults.length >= limit) {
            break;
          }
        }
      }

      return allResults;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[MemoryMesh] Failed to get YAMO log:', errorMessage);
      return [];
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

      if (!this.client) throw new Error('Database client not initialized');
      const result = await this.client.update(id, updateData);

      return {
        id: result.id,
        content: sanitizedContent,
        success: result.success
      };

    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      throw e;
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
      if (!this.client) throw new Error('Database client not initialized');
      const result = await this.client.delete(id);

      // Remove from Keyword Search
      this.keywordSearch.remove(id);

      return {
        deleted: result.id,
        success: result.success
      };


    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      throw e;
    }
  }

  /**
   * Get database statistics
   * @returns {Promise<Object>} Statistics including count, size, etc.
   */
  async stats() {
    await this.init();

    try {
      if (!this.client) throw new Error('Database client not initialized');
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
      const e = error instanceof Error ? error : new Error(String(error));
      throw e;
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

      // @ts-ignore
      health.checks.database = {
        status: 'up',
        latency: dbLatency,
        isConnected: this.client?.isConnected || false,
        tableName: this.client?.tableName || 'unknown'
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // @ts-ignore
      health.checks.database = {
        status: 'error',
        error: message
      };
      health.status = 'degraded';
    }

    // Check 2: Embedding service
    try {
      const startEmbedding = Date.now();
      const testEmbedding = await this.embeddingFactory.embed('health check');
      const embeddingLatency = Date.now() - startEmbedding;

      // @ts-ignore
      health.checks.embedding = {
        status: 'up',
        latency: embeddingLatency,
        dimension: testEmbedding.length,
        configured: true
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // @ts-ignore
      health.checks.embedding = {
        status: 'error',
        error: message
      };
      health.status = 'degraded';
    }

    // Check 3: Get stats (verifies read operations work)
    try {
      const stats = await this.stats();
      // @ts-ignore
      health.checks.stats = {
        status: 'up',
        recordCount: stats.count || 0
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // @ts-ignore
      health.checks.stats = {
        status: 'warning',
        error: message
      };
      // Don't degrade status for stats failure - it's not critical
    }

    // Check 4: Cache status (if caching enabled)
    if (this.queryCache) {
      // @ts-ignore
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
      dimension: parseInt(process.env.EMBEDDING_DIMENSION || '384'),
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
   * @returns {string|null} LanceDB filter expression
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

    // @ts-ignore
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
      const error = e instanceof Error ? e : new Error(String(e));
      const errorResponse = handleError(error, { context: 'CLI argument parsing' });
      console.error(`❌ Error: Invalid JSON argument: ${error.message}`);
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
      const error = e instanceof Error ? e : new Error(String(e));
      const errorResponse = handleError(error, { context: 'STDIN parsing' });
      console.error("❌ Error: No input provided via CLI or STDIN.");
      console.error(`Details: ${error.message}`);
      console.error(JSON.stringify(errorResponse, null, 2));
      process.exit(1);
    }
  }

  // Create MemoryMesh instance
  const mesh = new MemoryMesh();

  try {
    // Route to appropriate action
    if (action === 'ingest' || action === 'store') {
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

    } else if (action === 'export') {
      const records = await mesh.getAll({ limit: input.limit || 10000 });
      console.log(JSON.stringify({ status: "ok", count: records.length, records }));

    } else if (action === 'reflect') {
      // Enhanced reflect with LLM support
      const enableLLM = input.llm !== false;  // Default true
      const result = await mesh.reflect({
        topic: input.topic,
        lookback: input.limit || 10,
        generate: enableLLM
      });

      if (result.reflection) {
        // New format with LLM-generated reflection
        console.log(JSON.stringify({
          status: "ok",
          reflection: result.reflection,
          confidence: result.confidence,
          id: result.id,
          topic: result.topic,
          sourceMemoryCount: result.sourceMemoryCount,
          yamoBlock: result.yamoBlock,
          createdAt: result.createdAt
        }));
      } else {
        // Old format for backward compatibility (prompt-only mode)
        console.log(JSON.stringify({ status: "ok", ...result }));
      }

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
    const e = error instanceof Error ? error : new Error(String(error));
    const errorResponse = handleError(e, { action, input: { ...input, content: input.content ? '[REDACTED]' : undefined } });

    if (errorResponse.success === false) {
      console.error(`❌ Fatal Error: ${errorResponse.error.message}`);
      if (process.env.NODE_ENV === 'development' && errorResponse.error.details) {
        console.error(`Details:`, errorResponse.error.details);
      }
      console.error(JSON.stringify(errorResponse, null, 2));
    } else {
      console.error(`❌ Fatal Error: ${e.message}`);
      console.error(e.stack);
    }

    process.exit(1);
  }
}

// Export for testing and CLI usage
export { MemoryMesh, run };
export default MemoryMesh;

// Run CLI if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch(err => {
    console.error(`❌ Fatal Error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  });
}
