/**
 * S-MORA Hybrid Retrieval
 *
 * Enhanced hybrid search combining vector and keyword retrieval
 * with quality gating and adaptive fusion.
 *
 * @module smora/retrieval/hybrid-retrieval
 */

import { KeywordSearch, KeywordSearchError } from './keyword-search.js';
import { ResultFusion, ResultFusionError } from './result-fusion.js';
import { QualityGate, QualityGateError } from './quality-gate.js';

/**
 * S-MORA Hybrid Retrieval
 *
 * Orchestrates vector and keyword search with advanced fusion
 * and quality filtering for optimal retrieval results.
 */
export class HybridRetrieval {
  constructor(db, embeddings, options = {}) {
    this.db = db;
    this.embeddings = embeddings;

    // Configuration
    this.config = {
      alpha: options.alpha ?? 0.5,
      vectorLimit: options.vectorLimit ?? 30,
      keywordLimit: options.keywordLimit ?? 30,
      finalLimit: options.finalLimit ?? 10,
      enableReranking: options.enableReranking ?? false,
      enableQualityGate: options.enableQualityGate !== false,
      ...options
    };

    // Initialize components
    this.keywordSearch = new KeywordSearch(db, options.keywordSearch);
    this.resultFusion = new ResultFusion(options.fusion);
    this.qualityGate = new QualityGate(options.qualityGate);

    // Metrics
    this.metrics = {
      totalSearches: 0,
      totalResults: 0,
      avgLatency: 0,
      vectorOnlyCount: 0,
      keywordOnlyCount: 0,
      hybridCount: 0,
      qualityFilteredCount: 0
    };
  }

  /**
   * Initialize hybrid retrieval
   *
   * @param {Object} options - Initialization options
   */
  async init(options = {}) {
    // Only initialize keyword search if alpha > 0 (i.e., keyword search will be used)
    if (this.config.alpha > 0) {
      await this.keywordSearch.init(options);
    }
  }

  /**
   * Execute hybrid search
   *
   * @param {string|Object} query - Search query or embedding
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Search results
   */
  async search(query, options = {}) {
    const startTime = Date.now();
    this.metrics.totalSearches++;

    const {
      limit = this.config.finalLimit,
      alpha = this.config.alpha,
      filter = null,
      queryText = null,
      embedding = null,
      enableQualityGate = this.config.enableQualityGate,
      minScore = 0.1,
      diversityThreshold = 0.85
    } = options;

    try {
      // Prepare search inputs
      const searchEmbedding = embedding || await this._getEmbedding(query);
      const searchText = queryText || (typeof query === 'string' ? query : null);

      // Only use keyword search if alpha > 0
      const useKeywordSearch = this.config.alpha > 0 && searchText;

      // Execute parallel searches
      const [vectorResults, keywordResults] = await Promise.all([
        this._vectorSearch(searchEmbedding, this.config.vectorLimit, filter),
        useKeywordSearch ? this._keywordSearch(searchText, this.config.keywordLimit, filter) : []
      ]);

      // Fuse results using RRF
      const fused = this.resultFusion.fuse(vectorResults, keywordResults, { alpha });

      // Track result types
      this._trackResultTypes(fused);

      // Apply quality gate
      let filtered = fused;
      if (enableQualityGate) {
        filtered = this.qualityGate.filter(fused, {
          minScore,
          diversityThreshold,
          maxResults: limit * 2
        });
        this.metrics.qualityFilteredCount += fused.length - filtered.length;
      }

      // Apply final limit
      const results = filtered.slice(0, limit);

      // Update metrics
      this.metrics.totalResults += results.length;
      this._updateLatency(Date.now() - startTime);

      return results;

    } catch (error) {
      throw new HybridRetrievalError(`Hybrid retrieval failed: ${error.message}`, {
        query,
        originalError: error
      });
    }
  }

  /**
   * Perform vector search
   *
   * @private
   * @param {Array} embedding - Query embedding
   * @param {number} limit - Result limit
   * @param {string} filter - Optional filter
   * @returns {Promise<Array>} Vector search results
   */
  async _vectorSearch(embedding, limit, filter) {
    const searchOptions = { limit, metric: 'cosine' };
    if (filter) {
      searchOptions.filter = filter;
    }

    const results = await this.db.search(embedding, searchOptions);

    // Deduplicate by ID to handle LanceDB returning duplicate records
    const uniqueMap = new Map();
    for (const r of results) {
      if (!uniqueMap.has(r.id)) {
        uniqueMap.set(r.id, {
          ...r,
          score: r._distance !== undefined ? 1 - r._distance : (r.score || 0),
          searchType: 'vector',
          vector: r.vector || r._vector || null
        });
      }
    }

    return Array.from(uniqueMap.values());
  }

  /**
   * Perform keyword search
   *
   * @private
   * @param {string} query - Search query
   * @param {number} limit - Result limit
   * @param {string} filter - Optional filter
   * @returns {Promise<Array>} Keyword search results
   */
  async _keywordSearch(query, limit, filter) {
    return await this.keywordSearch.search(query, { limit, filter });
  }

  /**
   * Get embedding for query
   *
   * @private
   * @param {string|Object} query - Query string or object
   * @returns {Promise<Array>} Query embedding
   */
  async _getEmbedding(query) {
    if (Array.isArray(query)) {
      return query; // Already an embedding
    }

    if (typeof query === 'string') {
      return await this.embeddings.embed(query);
    }

    if (query.embedding) {
      return query.embedding;
    }

    throw new HybridRetrievalError('Invalid query format');
  }

  /**
   * Track result types for metrics
   *
   * @private
   * @param {Array} results - Search results
   */
  _trackResultTypes(results) {
    for (const result of results) {
      switch (result.searchType) {
        case 'vector':
          this.metrics.vectorOnlyCount++;
          break;
        case 'keyword':
          this.metrics.keywordOnlyCount++;
          break;
        case 'hybrid':
          this.metrics.hybridCount++;
          break;
      }
    }
  }

  /**
   * Update latency metrics
   *
   * @private
   * @param {number} latency - Search latency in ms
   */
  _updateLatency(latency) {
    const alpha = 0.1; // Exponential moving average factor
    this.metrics.avgLatency = this.metrics.avgLatency === 0
      ? latency
      : alpha * latency + (1 - alpha) * this.metrics.avgLatency;
  }

  /**
   * Get search metrics
   *
   * @returns {Object} Metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      keywordSearch: this.keywordSearch.getMetrics(),
      resultFusion: this.resultFusion.getMetrics(),
      qualityGate: this.qualityGate.getMetrics(),
      config: {
        alpha: this.config.alpha,
        vectorLimit: this.config.vectorLimit,
        keywordLimit: this.config.keywordLimit,
        finalLimit: this.config.finalLimit
      }
    };
  }

  /**
   * Reset all metrics
   */
  resetMetrics() {
    this.metrics = {
      totalSearches: 0,
      totalResults: 0,
      avgLatency: 0,
      vectorOnlyCount: 0,
      keywordOnlyCount: 0,
      hybridCount: 0,
      qualityFilteredCount: 0
    };

    this.keywordSearch.resetMetrics();
    this.resultFusion.resetMetrics();
    this.qualityGate.resetMetrics();
  }

  /**
   * Update configuration
   *
   * @param {Object} options - New configuration options
   */
  updateConfig(options) {
    Object.assign(this.config, options);

    if (options.fusion) {
      this.resultFusion.updateConfig(options.fusion);
    }

    if (options.qualityGate) {
      this.qualityGate.updateConfig(options.qualityGate);
    }
  }
}

/**
 * Custom error class for hybrid retrieval operations
 */
export class HybridRetrievalError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'HybridRetrievalError';
    this.details = details;
  }
}

export default HybridRetrieval;
