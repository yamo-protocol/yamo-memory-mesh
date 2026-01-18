/**
 * S-MORA Orchestrator
 *
 * Main pipeline coordinator integrating all four layers:
 * 1. Query Understanding (HyDE-Lite)
 * 2. Hybrid Retrieval (Vector + Keyword + Metadata)
 * 3. Context Compression (Tree-based)
 * 4. Structured Context Assembly
 *
 * @module smora/orchestrator
 */

import { HyDELite } from './query-understanding/index.js';
import { HybridRetrieval } from './retrieval/index.js';
import { ContextCompressor } from './compression/index.js';
import { ContextAssembler } from './assembly/index.js';
import { SMORAOrchestratorError } from './errors/orchestrator-error.js';
import { loadSMORAConfigSync } from './config/loader.js';
import { MetricsCollector } from './utils/metrics.js';
import { OllamaHealthCheck } from './utils/ollama-health.js';
import { QueryCache, generateCacheKey } from './cache/index.js';
import { BatchProcessor } from './batch/index.js';
import { PerformanceTracker, CacheMonitor, CLIReporter } from './monitoring/index.js';
import { QualityMetrics } from './quality/metrics.js';
import { HyDEQualityScorer } from './quality/hyde-scorer.js';

/**
 * Main S-MORA Orchestrator
 *
 * Coordinates all layers of the retrieval pipeline
 * with intelligent routing, monitoring, and error handling.
 */
export class SMORAOrchestrator {
  constructor(config = {}) {
    // Load configuration with defaults
    const loadedConfig = loadSMORAConfigSync();
    this.config = {
      // Core configuration
      enabled: config.enabled ?? loadedConfig.enabled ?? false,

      // Component configurations
      lancedb: config.lancedb || loadedConfig.lancedb || {},
      embedding: config.embedding || loadedConfig.embedding || {},
      llm: config.llm || loadedConfig.llm || {},

      // Layer-specific configurations
      hyde: config.hyde || loadedConfig.hyde || {},
      retrieval: config.retrieval || loadedConfig.retrieval || {},
      compression: config.compression || loadedConfig.compression || {},
      assembly: config.assembly || loadedConfig.assembly || {},

      // Phase 6: Performance & Scalability configurations
      cache: config.cache || loadedConfig.cache || {},
      batch: config.batch || loadedConfig.batch || {},

      // Phase 0: Pre-ingestion Scrubber (Layer 0)
      scrubber: config.scrubber || loadedConfig.scrubber || {},
      monitoring: config.monitoring || loadedConfig.monitoring || {},

      // Feature flags
      options: {
        maxContextLength: config.options?.maxContextLength || loadedConfig.assembly?.maxTokens || 4096,
        retrievalLimit: config.options?.retrievalLimit || loadedConfig.retrieval?.finalLimit || 10,
        enableHyDE: config.options?.enableHyDE ?? loadedConfig.hyde?.enabled ?? false,
        enableCompression: config.options?.enableCompression ?? loadedConfig.compression?.enabled ?? false
      }
    };

    // Initialize state
    this.initialized = false;
    this.metrics = new MetricsCollector();

    // Quality tracking (optional, enabled via qualityTracking flag)
    this.qualityMetrics = config.qualityTracking ? new QualityMetrics() : null;
    this.hydeScorer = new HyDEQualityScorer();

    // Component placeholders
    this.db = null;
    this.embeddings = null;
    this.llm = null;
    this.queryUnderstanding = null;
    this.retrieval = null;
    this.compression = null;
    this.assembly = null;

    // Phase 6: Cache (optional, initialized if config.cache.enabled is true)
    this.cache = this.config.cache?.enabled
      ? new QueryCache({
          maxSize: this.config.cache?.maxSize || 100,
          ttl: this.config.cache?.ttl || 300000
        })
      : null;

    // Phase 6: Monitoring
    this.cacheMetrics = {
      hits: 0,
      misses: 0,
      hitLatencies: [],
      missLatencies: []
    };

    // Phase 6: Batch Processor (lazy initialization)
    this.batchProcessor = null;
    this.batchConfig = {
      concurrency: this.config.batch?.concurrency || 10
    };

    // Phase 6: Performance Monitoring
    this.performanceTracker = new PerformanceTracker({
      windowSize: this.config.monitoring?.windowSize || 1000
    });

    // Phase 6: Cache Monitor (lazy initialization)
    this.cacheMonitor = null;
  }

  /**
   * Initialize the orchestrator and all components
   *
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // Initialize adapters dynamically to avoid circular dependencies
      const { createLancedbAdapter } = await import('./adapters/lancedb-adapter.js');
      const { createEmbeddingAdapter } = await import('./adapters/embedding-adapter.js');
      const { createLLMAdapter } = await import('./adapters/llm-adapter.js');

      // Create adapter instances (note: createLLMAdapter is async)
      this.db = createLancedbAdapter(this.config.lancedb);
      this.embeddings = createEmbeddingAdapter(this.config.embedding);

    // Initialize Layer 0 Scrubber if enabled
    if (this.config.scrubber?.enabled) {
      const { Scrubber } = await import('./scrubber/scrubber.js');
      this.scrubber = new Scrubber(this.config.scrubber);
    } else {
      this.scrubber = null;
    }
      this.llm = await createLLMAdapter(this.config.llm);

      // Initialize all adapters in parallel
      await Promise.all([
        this.db.initialize?.() || this.db.init?.() || Promise.resolve(),
        this.embeddings.initialize?.() || this.embeddings.init?.() || Promise.resolve(),
        this.llm.initialize?.() || this.llm.init?.() || Promise.resolve()
      ]);

      // Health check for Ollama if HyDE is enabled
      if (this.config.options.enableHyDE) {
        const ollamaHealth = new OllamaHealthCheck({
          baseUrl: this.config.llm.baseUrl || 'http://localhost:11434',
          timeout: 5000
        });

        const healthResult = await ollamaHealth.checkOllama();

        if (healthResult.status !== 'healthy') {
          throw new SMORAOrchestratorError(
            `Ollama health check failed. Ollama must be running for HyDE query enhancement. ` +
            `Please start Ollama: 'ollama serve'\n` +
            `Health check result: ${healthResult.error || 'Unknown error'}`,
            {
              component: 'ollama',
              ollamaUrl: this.config.llm.baseUrl || 'http://localhost:11434',
              healthResult
            }
          );
        }
      }

      // Initialize layers
      this.queryUnderstanding = this._createQueryUnderstanding();
      this.retrieval = this._createRetrieval();
      this.compression = this._createCompression();
      this.assembly = this._createAssembly();

      this.initialized = true;

      this.metrics.record('orchestrator', 'initialized', {
        timestamp: Date.now()
      });
    } catch (error) {
      throw new SMORAOrchestratorError(
        `Failed to initialize S-MORA orchestrator: ${error.message}`,
        { originalError: error }
      );
    }
  }

  /**
   * Create query understanding layer
   *
   * @private
   * @returns {HyDELite|null}
   */
  _createQueryUnderstanding() {
    if (!this.config.options.enableHyDE) {
      return null;
    }

    return new HyDELite(this.llm, this.embeddings, {
      maxTokens: this.config.hyde?.maxTokens || 256,
      temperature: this.config.hyde?.temperature || 0.3,
      fallbackToQuery: true,
      cacheHypotheticals: true
    });
  }

  /**
   * Create retrieval layer
   *
   * @private
   * @returns {HybridRetrieval}
   */
  _createRetrieval() {
    const retrievalConfig = {
      alpha: this.config.retrieval?.alpha ?? 0.5,
      vectorLimit: this.config.retrieval?.vectorLimit ?? 30,
      keywordLimit: this.config.retrieval?.keywordLimit ?? 30,
      finalLimit: this.config.options.retrievalLimit,
      enableReranking: this.config.retrieval?.enableReranking ?? false,
      enableQualityGate: this.config.retrieval?.enableQualityGate ?? false
    };

    return new HybridRetrieval(this.db, this.embeddings, retrievalConfig);
  }

  /**
   * Create compression layer
   *
   * @private
   * @returns {ContextCompressor|null}
   */
  _createCompression() {
    if (!this.config.options.enableCompression) {
      return null;
    }

    return new ContextCompressor(this.db, this.llm, this.embeddings, {
      maxChunkSize: this.config.compression?.maxChunkSize || 500,
      chunkOverlap: this.config.compression?.chunkOverlap || 50,
      summaryCompressionRatio: this.config.compression?.summaryCompressionRatio || 0.3,
      maxTreeDepth: this.config.compression?.maxTreeDepth || 3,
      cacheTrees: this.config.compression?.cacheTrees !== false
    });
  }

  /**
   * Create assembly layer
   *
   * @private
   * @returns {ContextAssembler}
   */
  _createAssembly() {
    return new ContextAssembler({
      maxContextLength: this.config.options.maxContextLength,
      structure: this.config.assembly?.structure || 'structured',
      includeCitations: this.config.assembly?.includeCitations !== false,
      includeHypothetical: this.config.assembly?.includeHypothetical !== false,
      includeSummary: this.config.assembly?.includeSummary !== false,
      instructionTemplate: this.config.assembly?.instructionTemplate || 'default'
    });
  }

  /**
   * Main retrieval pipeline
   *
   * Executes the complete S-MORA pipeline:
   * 1. Query Understanding (HyDE-Lite)
   * 2. Hybrid Retrieval
   * 3. Context Compression
   * 4. Structured Context Assembly
   *
   * @param {string} query - User query
   * @param {Object} options - Retrieval options
   * @returns {Promise<Object>} Retrieval results with metadata
   */
  async retrieve(query, options = {}) {
    const startTime = Date.now();
    const telemetry = { stages: {} };

    // Phase 6: Cache Check (fast path)
    if (this.cache) {
      const key = generateCacheKey(query, options);
      const cached = this.cache.get(key);

      if (cached) {
        const latency = Date.now() - startTime;
        this.cacheMetrics.hits++;
        this.cacheMetrics.hitLatencies.push(latency);
        this.performanceTracker.recordLatency('retrieve', latency);
        this.metrics.record('orchestrator', 'cache_hit', { latency });
        return cached;
      }

      this.cacheMetrics.misses++;
    }

    try {
      await this.initialize();

      // Layer 1: Query Understanding
      const queryStageStart = Date.now();
      const enhancedQuery = await this._understandQuery(query, options);
      telemetry.stages.queryUnderstanding = {
        duration: Date.now() - queryStageStart,
        hydeEnabled: enhancedQuery.source === 'hyde',
        hasHypothetical: !!enhancedQuery.hypothetical
      };

      // Layer 2: Hybrid Retrieval
      const retrievalStageStart = Date.now();
      const rawResults = await this._retrieve(enhancedQuery, query, options);
      telemetry.stages.retrieval = {
        duration: Date.now() - retrievalStageStart,
        resultCount: rawResults.length
      };

      // Layer 3: Context Compression
      const compressionStageStart = Date.now();
      const compressedResults = await this._compress(rawResults, query, options);
      telemetry.stages.compression = {
        duration: Date.now() - compressionStageStart,
        compressionRatio: compressedResults.compressionRatio || 1.0,
        method: compressedResults.method || 'none'
      };

      // Layer 4: Context Assembly
      const assemblyStageStart = Date.now();
      const assembledContext = await this._assemble(
        compressedResults.chunks,
        query,
        enhancedQuery,
        options
      );
      telemetry.stages.assembly = {
        duration: Date.now() - assemblyStageStart,
        finalTokens: assembledContext.tokenCount
      };

      const totalDuration = Date.now() - startTime;

      // Record metrics
      this.metrics.record('orchestrator', 'retrieve', {
        duration: totalDuration,
        success: true,
        hydeEnabled: telemetry.stages.queryUnderstanding.hydeEnabled,
        resultCount: rawResults.length,
        finalTokens: assembledContext.tokenCount
      });

      // Record performance metrics
      this.performanceTracker.recordLatency('retrieve', totalDuration);

      const result = {
        query,
        context: assembledContext.formattedContext,
        chunks: compressedResults.chunks,
        metadata: {
          telemetry: {
            ...telemetry,
            totalDuration
          },
          queryUnderstanding: {
            hypothetical: enhancedQuery.hypothetical,
            source: enhancedQuery.source
          },
          retrieval: {
            totalCandidates: rawResults.length,
            selectedChunks: compressedResults.chunks.length
          },
          compression: {
            ratio: compressedResults.compressionRatio || 1.0,
            method: compressedResults.method || 'none'
          }
        },
        success: true
      };

      // Phase 6: Store in cache
      if (this.cache) {
        const key = generateCacheKey(query, options);
        this.cache.set(key, result);
      }

      return result;
    } catch (error) {
      const totalDuration = Date.now() - startTime;

      this.metrics.record('orchestrator', 'retrieve', {
        duration: totalDuration,
        success: false,
        error: error.message
      });

      // Record error in performance tracker
      this.performanceTracker.recordError('retrieve', error.message);

      return {
        query,
        context: null,
        chunks: [],
        metadata: {
          error: error.message,
          telemetry,
          totalDuration
        },
        success: false
      };
    }
  }

  /**
   * Layer 1: Query Understanding with HyDE-Lite
   *
   * @private
   * @param {string} query - User query
   * @param {Object} options - Options
   * @returns {Promise<Object>} Enhanced query with embedding
   */
  async _understandQuery(query, options) {
    if (!this.queryUnderstanding) {
      // Fallback: generate embedding directly from query
      const embedding = await this.embeddings.embed(query);
      return {
        query,
        embedding,
        source: 'query',
        hypothetical: null
      };
    }

    try {
      const result = await this.queryUnderstanding.process(query, {
        maxTokens: options.hydeMaxTokens || this.config.hyde?.maxTokens || 256
      });

      return {
        query,
        embedding: result.embedding,
        source: result.source || 'hyde',
        hypothetical: result.hypothetical || null
      };
    } catch (error) {
      // Fallback to raw query on error
      const embedding = await this.embeddings.embed(query);
      return {
        query,
        embedding,
        source: 'query',
        hypothetical: null,
        error: error.message
      };
    }
  }

  /**
   * Layer 2: Hybrid Retrieval
   *
   * @private
   * @param {Object} enhancedQuery - Enhanced query from Layer 1
   * @param {string} originalQuery - Original user query
   * @param {Object} options - Options
   * @returns {Promise<Array>} Retrieved results
   */
  async _retrieve(enhancedQuery, originalQuery, options) {
    const limit = options.limit || this.config.options.retrievalLimit;

    return await this.retrieval.search(enhancedQuery.embedding, {
      limit,
      queryText: originalQuery,
      filter: options.filter
    });
  }

  /**
   * Layer 3: Context Compression
   *
   * @private
   * @param {Array} results - Retrieved results
   * @param {string} query - Original query
   * @param {Object} options - Options
   * @returns {Promise<Object>} Compressed results
   */
  async _compress(results, query, options) {
    if (!this.compression) {
      // No compression, return results as-is
      return {
        chunks: results,
        compressionRatio: 1.0,
        method: 'none'
      };
    }

    const maxTokens = options.maxTokens || this.config.options.maxContextLength;

    return await this.compression.compress(results, {
      query,
      maxTokens: maxTokens * 0.8 // Leave room for assembly overhead
    });
  }

  /**
   * Layer 4: Context Assembly
   *
   * @private
   * @param {Array} chunks - Compressed chunks
   * @param {string} query - Original query
   * @param {Object} enhancedQuery - Enhanced query from Layer 1
   * @param {Object} options - Options
   * @returns {Promise<Object>} Assembled context
   */
  async _assemble(chunks, query, enhancedQuery, options) {
    return await this.assembly.build({
      query,
      chunks,
      hypotheticalAnswer: enhancedQuery.hypothetical,
      maxTokens: options.maxTokens || this.config.options.maxContextLength
    });
  }

  /**
   * Batch retrieval for multiple queries
   *
   * Processes multiple queries in parallel with configurable concurrency.
   * Useful for bulk operations and API endpoints handling multiple requests.
   *
   * @param {Array<string>} queries - Array of queries to process
   * @param {Object} options - Batch processing options
   * @param {number} options.concurrency - Max parallel queries (default: 10)
   * @param {Function} options.onProgress - Progress callback (completed, total)
   * @returns {Promise<Array>} Array of retrieval results
   */
  async retrieveBatch(queries, options = {}) {
    await this.initialize();

    // Initialize batch processor lazily
    if (!this.batchProcessor) {
      this.batchProcessor = new BatchProcessor(this, this.batchConfig);
    }

    // Override concurrency if provided in options
    const concurrency = options.concurrency || this.batchConfig.concurrency;

    return await this.batchProcessor.process(queries, {
      concurrency,
      onProgress: options.onProgress
    });
  }

  /**
   * Index a document with tree-based compression
   *
   * @param {Object} document - Document to index
   * @returns {Promise<Object>} Indexing result
   */
  async indexDocument(document) {
    await this.initialize();

    if (!this.compression) {
      throw new SMORAOrchestratorError(
        'Document indexing requires compression to be enabled'
      );
    }

    // If scrubber is enabled, pre-process document through scrubber
    if (this.scrubber && this.config.scrubber?.enabled) {
      const scrubbedResult = await this.scrubber.process(document);

      // Build tree from scrubbed chunks
      // Reconstruct document content from scrubbed chunks for tree builder
      const scrubbedContent = scrubbedResult.chunks
        .map(chunk => chunk.text)
        .join('\n\n');

      return await this.compression.processDocument({
        content: scrubbedContent,
        metadata: {
          ...document.metadata,
          scrubber: {
            enabled: true,
            chunksProcessed: scrubbedResult.chunks.length,
            telemetry: scrubbedResult.telemetry
          }
        }
      });
    }

    // Original behavior when scrubber disabled
    return await this.compression.processDocument(document);
  }

  /**
   * Health check for all components
   *
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    // If not initialized, return degraded status
    if (!this.initialized) {
      return {
        status: 'degraded',
        components: {
          database: null,
          embeddings: null,
          llm: null
        },
        config: {
          enabled: this.config.enabled,
          hydeEnabled: this.config.options.enableHyDE,
          compressionEnabled: this.config.options.enableCompression,
          scrubberEnabled: this.scrubber ? true : false
        },
        reason: 'not_initialized'
      };
    }

    const checks = await Promise.allSettled([
      this.db?.healthCheck?.() || this.db?.checkHealth?.() || Promise.resolve({ status: 'healthy' }),
      this.embeddings?.healthCheck?.() || this.embeddings?.checkHealth?.() || Promise.resolve({ status: 'healthy' }),
      this.llm?.healthCheck?.() || this.llm?.checkHealth?.() || Promise.resolve({ status: 'healthy' }),
      this.scrubber?.healthCheck?.() || Promise.resolve({ status: 'healthy' })
    ]);

    const components = {
      database: checks[0].status,
      embeddings: checks[1].status,
      llm: checks[2].status,
      scrubber: this.scrubber ? {
        status: 'enabled',
        enabled: true
      } : {
        status: 'disabled',
        enabled: false
      }
    };

    const overallStatus = checks.every(
      c => c.status === 'fulfilled' && c.value.status === 'healthy'
    )
      ? 'healthy'
      : 'degraded';

    return {
      status: overallStatus,
      components: {
        database: checks[0].status === 'fulfilled' ? checks[0].value : null,
        embeddings: checks[1].status === 'fulfilled' ? checks[1].value : null,
        llm: checks[2].status === 'fulfilled' ? checks[2].value : null,
        scrubber: this.scrubber ? {
          status: 'enabled',
          enabled: true
        } : {
          status: 'disabled',
          enabled: false
        }
      },
      config: {
        enabled: this.config.enabled,
        hydeEnabled: this.config.options.enableHyDE,
        compressionEnabled: this.config.options.enableCompression,
        scrubberEnabled: this.scrubber ? true : false
      }
    };
  }

  /**
   * Get metrics from all components
   *
   * @returns {Object} Metrics summary
   */
  getMetrics() {
    const cacheStats = this.cache ? {
      enabled: true,
      ...this.cache.getStats(),
      hits: this.cacheMetrics.hits,
      misses: this.cacheMetrics.misses,
      hitLatencies: [...this.cacheMetrics.hitLatencies],
      missLatencies: [...this.cacheMetrics.missLatencies]
    } : { enabled: false };

    return {
      orchestrator: {
        summary: this.performanceTracker.getSummary(),
        summaryOnly: true
      },
      assembly: this.assembly?.getMetrics() || null,
      config: {
        enabled: this.config.enabled,
        hydeEnabled: this.config.options.enableHyDE,
        compressionEnabled: this.config.options.enableCompression
      },
      cache: cacheStats
    };
  }

  /**
   * Reset all metrics
   */
  resetMetrics() {
    this.metrics.reset();
    this.assembly?.resetMetrics();

    // Reset cache metrics
    this.cacheMetrics = {
      hits: 0,
      misses: 0,
      hitLatencies: [],
      missLatencies: []
    };

    // Reset performance tracker
    this.performanceTracker.reset();
  }

  /**
   * Print metrics to console (CLI-friendly output)
   */
  printMetrics() {
    const metrics = this.getMetrics();
    CLIReporter.printMetrics(metrics);
  }

  /**
   * Calculate percentile from array of numbers
   *
   * @private
   * @param {Array<number>} values - Array of values
   * @param {number} percentile - Percentile to calculate (0-100)
   * @returns {number} Percentile value
   */
  _percentile(values, percentile) {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.floor((percentile / 100) * sorted.length);
    return sorted[Math.min(index, sorted.length - 1)];
  }

  /**
   * Update configuration
   *
   * @param {Object} updates - Configuration updates
   */
  updateConfig(updates) {
    // Merge updates with existing config
    if (updates.options) {
      this.config.options = { ...this.config.options, ...updates.options };
    }
    if (updates.hyde) {
      this.config.hyde = { ...this.config.hyde, ...updates.hyde };
    }
    if (updates.retrieval) {
      this.config.retrieval = { ...this.config.retrieval, ...updates.retrieval };
    }
    if (updates.compression) {
      this.config.compression = { ...this.config.compression, ...updates.compression };
    }
    if (updates.assembly) {
      this.config.assembly = { ...this.config.assembly, ...updates.assembly };
    }

    // Update assembly config if assembly exists
    if (this.assembly && updates.assembly) {
      this.assembly.updateConfig(updates.assembly);
    }

    // Re-initialize components if major config changes
    if (updates.options?.enableHyDE !== undefined || updates.options?.enableCompression !== undefined) {
      this.initialized = false;
    }
  }

  /**
   * Get quality metrics
   *
   * @returns {Object|null} Quality metrics for all layers, or null if disabled
   */
  getQualityMetrics() {
    return this.qualityMetrics ? this.qualityMetrics.getAllStats() : null;
  }

  /**
   * Shutdown the orchestrator
   *
   * @returns {Promise<void>}
   */
  async shutdown() {
    // Cleanup adapters
    await Promise.allSettled([
      this.db?.close?.() || this.db?.disconnect?.() || Promise.resolve(),
      this.embeddings?.cleanup?.() || Promise.resolve(),
      this.llm?.cleanup?.() || Promise.resolve()
    ]);

    this.initialized = false;
  }
}

export default SMORAOrchestrator;
