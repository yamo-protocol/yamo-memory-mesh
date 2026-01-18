/**
 * HybridSearch - Combines vector and keyword search
 * Implements reciprocal rank fusion (RRF) for result merging
 *
 * RRF Formula: score(d) = Σ (1 / (k + rank_i(d)))
 * Where k is a constant (typically 60) and rank_i is the rank in list i
 */

import { QueryError } from "../lancedb/errors.js";

class HybridSearch {
  /**
   * Create a new HybridSearch instance
   * @param {Object} client - LanceDBClient instance
   * @param {Object} embeddingFactory - EmbeddingFactory instance
   * @param {Object} options - Configuration options
   */
  constructor(client, embeddingFactory, options = {}) {
    this.client = client;
    this.embeddingFactory = embeddingFactory;
    this.alpha = options.alpha !== undefined
      ? options.alpha
      : parseFloat(process.env.HYBRID_SEARCH_ALPHA || '0.5'); // 0 = pure vector, 1 = pure keyword
    this.rrfK = options.rrfK || 60; // RRF constant
  }

  /**
   * Execute hybrid search combining vector and keyword results
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @param {number} options.limit - Maximum results (default: 10)
   * @param {number} options.alpha - Balance between vector and keyword (default: 0.5)
   * @param {string} options.filter - Metadata filter expression
   * @returns {Promise<Array>} Ranked and merged results
   */
  async search(query, options = {}) {
    const limit = options.limit || 10;
    const alpha = options.alpha !== undefined ? options.alpha : this.alpha;

    try {
      // Execute both searches in parallel for performance
      const [vectorResults, keywordResults] = await Promise.all([
        this._vectorSearch(query, limit * 2, options.filter),
        this._keywordSearch(query, limit * 2, options.filter)
      ]);

      // Merge using reciprocal rank fusion
      const mergedResults = this._reciprocalRankFusion(
        vectorResults,
        keywordResults,
        alpha,
        this.rrfK
      );

      return mergedResults.slice(0, limit);
    } catch (error) {
      throw new QueryError('Hybrid search failed', {
        query,
        alpha,
        originalError: error.message
      });
    }
  }

  /**
   * Perform vector similarity search
   * @private
   * @param {string} query - Search query
   * @param {number} limit - Result limit
   * @param {string} filter - Optional filter
   * @returns {Promise<Array>} Vector search results
   */
  async _vectorSearch(query, limit, filter = null) {
    // Generate query embedding
    const embedding = await this.embeddingFactory.embed(query);

    // Perform vector search
    const searchOptions = { limit, metric: 'cosine' };
    if (filter) {
      searchOptions.filter = filter;
    }

    const result = await this.client.search(embedding, searchOptions);

    // Convert distance to similarity (1 - distance for cosine)
    // Note: client.search() returns an array directly, not wrapped in a results object
    return result.map(r => ({
      ...r,
      score: 1 - (r.score || 0), // Handle case where score is undefined
      searchType: 'vector'
    }));
  }

  /**
   * Perform keyword/full-text search
   * @private
   * @param {string} query - Search query
   * @param {number} limit - Result limit
   * @param {string} filter - Optional filter
   * @returns {Promise<Array>} Keyword search results
   */
  async _keywordSearch(query, limit, filter = null) {
    // Note: LanceDB's full-text search capabilities are limited
    // This is a simplified implementation that uses content filtering
    // In production, consider integrating a dedicated FTS engine

    try {
      // For now, perform a broader vector search with lower threshold
      // This approximates keyword search by using a higher result limit
      const embedding = await this.embeddingFactory.embed(query);

      const searchOptions = {
        limit: limit * 3, // Get more candidates
        metric: 'cosine'
      };

      if (filter) {
        searchOptions.filter = filter;
      }

      const result = await this.client.search(embedding, searchOptions);

      // Filter for content containing query terms (keyword matching)
      const queryTerms = query.toLowerCase().split(/\s+/);

      return result.results
        .filter(r => {
          const content = r.content.toLowerCase();
          return queryTerms.some(term => content.includes(term));
        })
        .slice(0, limit)
        .map(r => ({
          ...r,
          score: r._distance || 0, // Use original distance
          searchType: 'keyword'
        }));
    } catch (error) {
      // Fallback: return empty array if keyword search fails
      return [];
    }
  }

  /**
   * Reciprocal Rank Fusion (RRF) algorithm
   * Combines multiple ranked lists into a single ranking
   *
   * @private
   * @param {Array} vectorResults - Results from vector search
   * @param {Array} keywordResults - Results from keyword search
   * @param {number} alpha - Weight for keyword results (0-1)
   * @param {number} k - RRF constant (default: 60)
   * @returns {Array} Fused and ranked results
   */
  _reciprocalRankFusion(vectorResults, keywordResults, alpha, k = 60) {
    const scores = new Map();

    // Score vector results (weighted by 1 - alpha)
    vectorResults.forEach((result, index) => {
      const rr = 1 / (k + index + 1);
      scores.set(result.id, {
        result,
        vectorScore: rr * (1 - alpha),
        keywordScore: 0,
        vectorRank: index + 1,
        keywordRank: null
      });
    });

    // Score keyword results (weighted by alpha)
    keywordResults.forEach((result, index) => {
      const rr = 1 / (k + index + 1);

      if (scores.has(result.id)) {
        // Document exists in both lists - merge scores
        const entry = scores.get(result.id);
        entry.keywordScore = rr * alpha;
        entry.keywordRank = index + 1;
      } else {
        // Document only in keyword list
        scores.set(result.id, {
          result,
          vectorScore: 0,
          keywordScore: rr * alpha,
          vectorRank: null,
          keywordRank: index + 1
        });
      }
    });

    // Combine scores and sort by combined score
    return Array.from(scores.values())
      .map(({ result, vectorScore, keywordScore, vectorRank, keywordRank }) => ({
        ...result,
        combinedScore: vectorScore + keywordScore,
        vectorScore,
        keywordScore,
        vectorRank,
        keywordRank,
        searchType: vectorRank !== null && keywordRank !== null
          ? 'hybrid'
          : vectorRank !== null ? 'vector' : 'keyword'
      }))
      .sort((a, b) => b.combinedScore - a.combinedScore);
  }

  /**
   * Get search statistics
   * @returns {Object} Search configuration and stats
   */
  getStats() {
    return {
      alpha: this.alpha,
      rrfK: this.rrfK,
      type: 'hybrid'
    };
  }
}

export default HybridSearch;
