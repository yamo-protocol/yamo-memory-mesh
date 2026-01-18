/**
 * Quality Gate for Retrieval Results
 *
 * Filters and validates search results to ensure quality.
 * Implements score thresholding and diversity filtering.
 *
 * @module smora/retrieval/quality-gate
 */

/**
 * Quality Gate for Search Results
 *
 * Ensures retrieved results meet quality standards before
 * being returned to the user or used for context assembly.
 */
export class QualityGate {
  constructor(options = {}) {
    this.config = {
      minScore: options.minScore ?? 0.1,
      minHybridScore: options.minHybridScore ?? 0.2,
      diversityThreshold: options.diversityThreshold ?? 0.85,
      maxResults: options.maxResults ?? 20,
      enableDiversityFilter: options.enableDiversityFilter !== false,
      enableScoreFilter: options.enableScoreFilter !== false,
      ...options
    };

    this.metrics = {
      totalFiltered: 0,
      scoreFiltered: 0,
      diversityFiltered: 0,
      avgInputCount: 0,
      avgOutputCount: 0,
      filterRate: 0
    };
  }

  /**
   * Filter results by quality criteria
   *
   * @param {Array} results - Search results to filter
   * @param {Object} options - Filter options
   * @returns {Array} Filtered results
   */
  filter(results, options = {}) {
    const startTime = Date.now();
    this.metrics.totalFiltered++;

    const config = {
      minScore: options.minScore ?? this.config.minScore,
      minHybridScore: options.minHybridScore ?? this.config.minHybridScore,
      diversityThreshold: options.diversityThreshold ?? this.config.diversityThreshold,
      maxResults: options.maxResults ?? this.config.maxResults,
      enableDiversityFilter: options.enableDiversityFilter ?? this.config.enableDiversityFilter,
      enableScoreFilter: options.enableScoreFilter ?? this.config.enableScoreFilter,
      ...options
    };

    let filtered = [...results];
    const inputCount = filtered.length;

    // Apply score filtering
    if (config.enableScoreFilter) {
      filtered = this._filterByScore(filtered, config);
      this.metrics.scoreFiltered += inputCount - filtered.length;
    }

    // Apply diversity filtering
    if (config.enableDiversityFilter && filtered.length > 1) {
      filtered = this._filterByDiversity(filtered, config);
      this.metrics.diversityFiltered += inputCount - filtered.length;
    }

    // Limit results
    const output = filtered.slice(0, config.maxResults);

    // Update metrics
    this.metrics.avgInputCount = this._updateAverage(
      this.metrics.avgInputCount,
      inputCount,
      this.metrics.totalFiltered
    );
    this.metrics.avgOutputCount = this._updateAverage(
      this.metrics.avgOutputCount,
      output.length,
      this.metrics.totalFiltered
    );
    this.metrics.filterRate = this.metrics.totalFiltered > 0
      ? 1 - (this.metrics.avgOutputCount / this.metrics.avgInputCount)
      : 0;

    return output;
  }

  /**
   * Filter results by minimum score
   *
   * @private
   * @param {Array} results - Results to filter
   * @param {Object} config - Filter configuration
   * @returns {Array} Score-filtered results
   */
  _filterByScore(results, config) {
    return results.filter(result => {
      // Check combined score
      if (result.combinedScore !== undefined) {
        // Hybrid results have higher threshold
        if (result.searchType === 'hybrid') {
          return result.combinedScore >= config.minHybridScore;
        }
        return result.combinedScore >= config.minScore;
      }

      // Fallback to individual scores
      const vectorScore = result.vectorScore ?? result.score ?? 0;
      const keywordScore = result.keywordScore ?? 0;

      return vectorScore >= config.minScore || keywordScore >= config.minScore;
    });
  }

  /**
   * Filter results by diversity (remove near-duplicates)
   *
   * @private
   * @param {Array} results - Results to filter
   * @param {Object} config - Filter configuration
   * @returns {Array} Diversity-filtered results
   */
  _filterByDiversity(results, config) {
    const diverse = [];
    const seenVectors = [];

    for (const result of results) {
      const vector = result.vector || result._vector || [];

      // Skip if no vector available
      if (vector.length === 0) {
        diverse.push(result);
        continue;
      }

      // Check against seen vectors
      let isDuplicate = false;
      for (const seenVector of seenVectors) {
        const similarity = this._cosineSimilarity(vector, seenVector);
        if (similarity > config.diversityThreshold) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        diverse.push(result);
        seenVectors.push(vector);
      }
    }

    return diverse;
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
   * Update running average
   *
   * @private
   * @param {number} current - Current average
   * @param {number} newValue - New value
   * @param {number} count - Count of values
   * @returns {number} Updated average
   */
  _updateAverage(current, newValue, count) {
    return count <= 1 ? newValue : (current * (count - 1) + newValue) / count;
  }

  /**
   * Get quality metrics
   *
   * @returns {Object} Metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      config: {
        minScore: this.config.minScore,
        minHybridScore: this.config.minHybridScore,
        diversityThreshold: this.config.diversityThreshold,
        maxResults: this.config.maxResults
      }
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      totalFiltered: 0,
      scoreFiltered: 0,
      diversityFiltered: 0,
      avgInputCount: 0,
      avgOutputCount: 0,
      filterRate: 0
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
 * Custom error class for quality gate operations
 */
export class QualityGateError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'QualityGateError';
    this.details = details;
  }
}

export default QualityGate;
