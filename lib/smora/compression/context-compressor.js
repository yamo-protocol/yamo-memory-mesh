/**
 * S-MORA Context Compressor
 *
 * Orchestrates tree-based context compression for
 * efficient retrieval and summarization.
 *
 * @module smora/compression/context-compressor
 */

import { TreeBuilder, TreeBuilderError } from './tree-builder.js';
import { TreeTraverser, TreeTraverserError } from './tree-traverser.js';
import { SummaryCache, SummaryCacheError } from './summary-cache.js';

/**
 * S-MORA Context Compressor
 *
 * Orchestrates tree building, traversal, and caching
 * for efficient context compression.
 */
export class ContextCompressor {
  constructor(db, llm, embeddings, options = {}) {
    this.db = db;
    this.llm = llm;
    this.embeddings = embeddings;

    // Configuration
    this.config = {
      enabled: options.enabled !== false,
      maxChunkSize: options.maxChunkSize || 500,
      chunkOverlap: options.chunkOverlap || 50,
      summaryCompressionRatio: options.summaryCompressionRatio || 0.3,
      maxTreeDepth: options.maxTreeDepth || 3,
      sectionSize: options.sectionSize || 5,
      cacheTrees: options.cacheTrees !== false,
      ...options
    };

    // Initialize components
    this.treeBuilder = new TreeBuilder(llm, embeddings, {
      maxChunkSize: this.config.maxChunkSize,
      chunkOverlap: this.config.chunkOverlap,
      summaryCompressionRatio: this.config.summaryCompressionRatio,
      maxTreeDepth: this.config.maxTreeDepth,
      sectionSize: this.config.sectionSize
    });

    this.treeTraverser = new TreeTraverser({
      defaultMaxDepth: this.config.maxTreeDepth,
      preferSummaries: true
    });

    this.summaryCache = new SummaryCache({
      maxSize: options.cacheSize || 100,
      maxMemoryMB: options.cacheMemoryMB || 50
    });

    // Tree storage
    this.trees = new Map();

    this.metrics = {
      documentsProcessed: 0,
      treesBuilt: 0,
      compressions: 0,
      avgCompressionRatio: 0,
      avgTokensSaved: 0
    };
  }

  /**
   * Initialize context compressor
   */
  async init() {
    // Load existing trees if any
    await this._loadExistingTrees();
  }

  /**
   * Process a document and build its tree
   *
   * @param {Object} document - Document to process
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Built tree
   */
  async processDocument(document, options = {}) {
    if (!this.config.enabled) {
      return { tree: null, compressionRatio: 1 };
    }

    const { id, content, metadata = {} } = document;

    // Check cache first
    if (this.config.cacheTrees) {
      const cached = this.summaryCache.getTree(id);
      if (cached) {
        return { tree: cached, fromCache: true };
      }
    }

    // Build tree
    const tree = await this.treeBuilder.buildTree({
      id,
      content,
      metadata
    });

    // Store tree
    this.trees.set(id, tree);

    // Cache tree
    if (this.config.cacheTrees) {
      this.summaryCache.setTree(id, tree);
    }

    // Update metrics
    this.metrics.documentsProcessed++;
    this.metrics.treesBuilt++;

    return { tree, fromCache: false };
  }

  /**
   * Compress search results using tree summaries
   *
   * @param {Array} results - Search results to compress
   * @param {Object} options - Compression options
   * @returns {Promise<Object>} Compressed results
   */
  async compress(results, options = {}) {
    if (!this.config.enabled) {
      return this._noCompression(results);
    }

    this.metrics.compressions++;

    const {
      queryEmbedding = null,
      maxTokens = 4000,
      query = null
    } = options;

    // Estimate current token count
    const currentTokens = this._estimateTokens(results);

    if (currentTokens <= maxTokens) {
      return this._noCompression(results, currentTokens);
    }

    // Group results by document
    const documentGroups = this._groupByDocument(results);

    // Compress each document group
    const compressed = [];
    let totalOriginalTokens = 0;
    let totalCompressedTokens = 0;

    for (const [rootId, chunks] of Object.entries(documentGroups)) {
      const originalTokens = this._estimateTokens(chunks);

      // Try to use summary
      const tree = this.trees.get(rootId);
      if (tree && queryEmbedding) {
        const relevantNodes = await this.treeTraverser.findRelevantNodes(
          tree,
          queryEmbedding,
          { maxResults: Math.min(chunks.length, 3), minSimilarity: 0.5 }
        );

        if (relevantNodes.length > 0) {
          // Use summaries
          for (const node of relevantNodes) {
            compressed.push({
              ...node,
              isSummary: node.chunkType !== 'chunk',
              rootId
            });
          }

          const compressedTokens = this._estimateTokens(relevantNodes);
          totalCompressedTokens += compressedTokens;
          totalOriginalTokens += originalTokens;

          // Only use one summary per document for now
          continue;
        }
      }

      // Fallback: use original chunks
      compressed.push(...chunks);
      totalCompressedTokens += originalTokens;
      totalOriginalTokens += originalTokens;
    }

    const compressionRatio = totalCompressedTokens / totalOriginalTokens;

    // Update metrics
    this._updateCompressionMetrics(compressionRatio, totalOriginalTokens - totalCompressedTokens);

    return {
      results: compressed.slice(0, results.length), // Preserve original limit
      originalTokens: totalOriginalTokens,
      compressedTokens: totalCompressedTokens,
      compressionRatio,
      method: 'tree'
    };
  }

  /**
   * Get tree by document ID
   *
   * @param {string} documentId - Document ID
   * @returns {Object|null} Tree or null
   */
  getTree(documentId) {
    return this.trees.get(documentId) || null;
  }

  /**
   * Return results without compression
   *
   * @private
   * @param {Array} results - Search results
   * @param {number} tokenCount - Optional token count
   * @returns {Object} Uncompressed results
   */
  _noCompression(results, tokenCount = null) {
    return {
      results,
      originalTokens: tokenCount || this._estimateTokens(results),
      compressedTokens: tokenCount || this._estimateTokens(results),
      compressionRatio: 1,
      method: 'none'
    };
  }

  /**
   * Group results by document/root ID
   *
   * @private
   * @param {Array} results - Search results
   * @returns {Object} Grouped results
   */
  _groupByDocument(results) {
    const groups = {};

    for (const result of results) {
      const rootId = result.rootId || result.document_id || 'unknown';

      if (!groups[rootId]) {
        groups[rootId] = [];
      }

      groups[rootId].push(result);
    }

    return groups;
  }

  /**
   * Estimate token count for items
   *
   * @private
   * @param {Array} items - Items to estimate
   * @returns {number} Estimated token count
   */
  _estimateTokens(items) {
    const array = Array.isArray(items) ? items : [items];

    let totalChars = 0;
    for (const item of array) {
      if (item.content) {
        totalChars += item.content.length;
      } else if (typeof item === 'string') {
        totalChars += item.length;
      }
    }

    // Rough estimate: 1 token per 4 characters
    return Math.ceil(totalChars / 4);
  }

  /**
   * Update compression metrics
   *
   * @private
   * @param {number} ratio - Compression ratio
   * @param {number} tokensSaved - Tokens saved
   */
  _updateCompressionMetrics(ratio, tokensSaved) {
    const alpha = 0.1;

    this.metrics.avgCompressionRatio = this.metrics.avgCompressionRatio === 0
      ? ratio
      : alpha * ratio + (1 - alpha) * this.metrics.avgCompressionRatio;

    this.metrics.avgTokensSaved = this.metrics.avgTokensSaved === 0
      ? tokensSaved
      : alpha * tokensSaved + (1 - alpha) * this.metrics.avgTokensSaved;
  }

  /**
   * Load existing trees from storage
   *
   * @private
   * @returns {Promise<void>}
   */
  async _loadExistingTrees() {
    // TODO: Implement loading from persistent storage
    // For now, trees are only kept in memory
  }

  /**
   * Get compressor metrics
   *
   * @returns {Object} Metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      treeBuilder: this.treeBuilder.getMetrics(),
      treeTraverser: this.treeTraverser.getMetrics(),
      summaryCache: this.summaryCache.getMetrics(),
      config: {
        enabled: this.config.enabled,
        maxChunkSize: this.config.maxChunkSize,
        sectionSize: this.config.sectionSize
      }
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      documentsProcessed: 0,
      treesBuilt: 0,
      compressions: 0,
      avgCompressionRatio: 0,
      avgTokensSaved: 0
    };

    this.treeBuilder.resetMetrics();
    this.treeTraverser.resetMetrics();
    this.summaryCache.resetMetrics();
  }

  /**
   * Update configuration
   *
   * @param {Object} options - New configuration options
   */
  updateConfig(options) {
    Object.assign(this.config, options);

    // Update component configs
    if (options.maxChunkSize || options.chunkOverlap || options.summaryCompressionRatio) {
      this.treeBuilder.updateConfig({
        maxChunkSize: this.config.maxChunkSize,
        chunkOverlap: this.config.chunkOverlap,
        summaryCompressionRatio: this.config.summaryCompressionRatio
      });
    }

    if (options.sectionSize) {
      this.treeBuilder.updateConfig({ sectionSize: this.config.sectionSize });
    }
  }
}

/**
 * Custom error class for context compressor operations
 */
export class ContextCompressorError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ContextCompressorError';
    this.details = details;
  }
}

export default ContextCompressor;
