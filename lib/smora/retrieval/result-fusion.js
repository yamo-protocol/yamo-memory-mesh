/**
 * Result Fusion with Enhanced RRF
 *
 * Advanced Reciprocal Rank Fusion for combining vector and keyword results.
 * Supports adaptive weighting and score normalization.
 *
 * @module smora/retrieval/result-fusion
 */

/**
 * Result Fusion using Enhanced RRF
 *
 * Combines multiple ranked lists using adaptive Reciprocal Rank Fusion.
 * Improves upon standard RRF with configurable weights and normalization.
 */
export class ResultFusion {
  constructor(options = {}) {
    this.config = {
      k: options.k ?? 60,              // RRF constant
      defaultAlpha: options.defaultAlpha ?? 0.5,  // Default keyword weight
      normalization: options.normalization ?? 'rrf',  // 'rrf', 'linear', 'log'
      enableDeduplication: options.enableDeduplication !== false,
      ...options
    };

    this.metrics = {
      totalFusions: 0,
      totalResults: 0,
      avgResultsPerFusion: 0,
      deduplicationRate: 0
    };
  }

  /**
   * Fuse vector and keyword results using RRF
   *
   * @param {Array} vectorResults - Vector search results
   * @param {Array} keywordResults - Keyword search results
   * @param {Object} options - Fusion options
   * @returns {Array} Fused and ranked results
   */
  fuse(vectorResults, keywordResults, options = {}) {
    const startTime = Date.now();
    this.metrics.totalFusions++;

    const alpha = options.alpha !== undefined ? options.alpha : this.config.defaultAlpha;
    const k = options.k !== undefined ? options.k : this.config.k;

    // Handle edge cases for alpha
    if (alpha === 0) {
      // Pure vector search - ignore keyword results
      return this._vectorOnly(vectorResults, k);
    }

    if (alpha === 1) {
      // Pure keyword search - ignore vector results
      return this._keywordOnly(keywordResults, k);
    }

    // Create result map for fusion
    const fused = new Map();

    // Add vector results
    for (let i = 0; i < vectorResults.length; i++) {
      const result = vectorResults[i];
      const rank = i + 1;
      const score = this._calculateScore(rank, result.score, 'vector', k);

      fused.set(result.id, {
        ...result,
        vectorScore: score,
        vectorRank: rank,
        keywordScore: 0,
        keywordRank: null,
        combinedScore: (1 - alpha) * score,
        searchType: 'vector'
      });
    }

    // Add and fuse keyword results
    for (let i = 0; i < keywordResults.length; i++) {
      const result = keywordResults[i];
      const rank = i + 1;
      const score = this._calculateScore(rank, result.score, 'keyword', k);

      if (fused.has(result.id)) {
        // Document exists in both - merge
        const existing = fused.get(result.id);
        existing.keywordScore = score;
        existing.keywordRank = rank;
        existing.combinedScore += alpha * score;
        existing.searchType = 'hybrid';
      } else {
        // Document only in keyword results
        fused.set(result.id, {
          ...result,
          vectorScore: 0,
          vectorRank: null,
          keywordScore: score,
          keywordRank: rank,
          combinedScore: alpha * score,
          searchType: 'keyword'
        });
      }
    }

    // Convert to array and sort
    let results = Array.from(fused.values())
      .sort((a, b) => b.combinedScore - a.combinedScore);

    // Apply deduplication if enabled
    if (this.config.enableDeduplication && options.enableDeduplication !== false) {
      const beforeCount = results.length;
      results = this._deduplicate(results, options.deduplicationThreshold ?? 0.95);
      const afterCount = results.length;

      // Update deduplication rate
      this.metrics.deduplicationRate = (beforeCount - afterCount) / beforeCount;
    }

    // Update metrics
    this.metrics.totalResults += results.length;
    this.metrics.avgResultsPerFusion = this.metrics.totalFusions > 0
      ? this.metrics.totalResults / this.metrics.totalFusions
      : results.length;

    return results;
  }

  /**
   * Calculate fusion score for a result
   *
   * @private
   * @param {number} rank - Result rank
   * @param {number} originalScore - Original search score
   * @param {string} type - Search type ('vector' or 'keyword')
   * @param {number} k - RRF constant
   * @returns {number} Fusion score
   */
  _calculateScore(rank, originalScore, type, k) {
    switch (this.config.normalization) {
      case 'linear':
        // Linear normalization: 1/rank
        return 1 / rank;

      case 'log':
        // Logarithmic normalization: 1 / log(k + rank)
        return 1 / Math.log(k + rank);

      case 'rrf':
      default:
        // Standard RRF: 1 / (k + rank)
        return 1 / (k + rank);
    }
  }

  /**
   * Remove near-duplicate results
   *
   * @private
   * @param {Array} results - Results to deduplicate
   * @param {number} threshold - Similarity threshold
   * @returns {Array} Deduplicated results
   */
  _deduplicate(results, threshold) {
    const unique = [];
    const seen = [];

    for (const result of results) {
      let isDuplicate = false;

      // Check against already seen results
      for (const seenResult of seen) {
        const similarity = this._cosineSimilarity(
          result.vector || result._vector || [],
          seenResult.vector || seenResult._vector || []
        );

        if (similarity > threshold) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        unique.push(result);
        seen.push(result);
      }
    }

    return unique;
  }

  /**
   * Calculate cosine similarity between two vectors
   *
   * @private
   * @param {Array} a - First vector
   * @param {Array} b - Second vector
   * @returns {number} Cosine similarity
   */
  _cosineSimilarity(a, b) {
    if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) {
      return 0;
    }

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0;
    }

    return dotProduct / (magnitudeA * magnitudeB);
  }

  /**
   * Handle vector-only results (alpha = 0)
   *
   * @private
   * @param {Array} vectorResults - Vector search results
   * @param {number} k - RRF constant
   * @returns {Array} Vector-only results
   */
  _vectorOnly(vectorResults, k) {
    return vectorResults.map((result, index) => ({
      ...result,
      vectorScore: this._calculateScore(index + 1, result.score, 'vector', k),
      vectorRank: index + 1,
      keywordScore: 0,
      keywordRank: null,
      combinedScore: this._calculateScore(index + 1, result.score, 'vector', k),
      searchType: 'vector'
    }));
  }

  /**
   * Handle keyword-only results (alpha = 1)
   *
   * @private
   * @param {Array} keywordResults - Keyword search results
   * @param {number} k - RRF constant
   * @returns {Array} Keyword-only results
   */
  _keywordOnly(keywordResults, k) {
    return keywordResults.map((result, index) => ({
      ...result,
      vectorScore: 0,
      vectorRank: null,
      keywordScore: this._calculateScore(index + 1, result.score, 'keyword', k),
      keywordRank: index + 1,
      combinedScore: this._calculateScore(index + 1, result.score, 'keyword', k),
      searchType: 'keyword'
    }));
  }

  /**
   * Get fusion metrics
   *
   * @returns {Object} Metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      config: {
        k: this.config.k,
        defaultAlpha: this.config.defaultAlpha,
        normalization: this.config.normalization
      }
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      totalFusions: 0,
      totalResults: 0,
      avgResultsPerFusion: 0,
      deduplicationRate: 0
    };
  }

  /**
   * Update configuration
   *
   * @param {Object} options - New configuration options
   */
  updateConfig(options) {
    Object.assign(this.config, options);
  }
}

/**
 * Custom error class for result fusion operations
 */
export class ResultFusionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ResultFusionError';
    this.details = details;
  }
}

export default ResultFusion;
