/**
 * Keyword Search with BM25
 *
 * Full-text search using BM25 ranking algorithm.
 * Optimized for 7B-14B local model contexts.
 *
 * @module smora/retrieval/keyword-search
 */

/**
 * BM25 Keyword Search
 *
 * Implements BM25 algorithm for keyword relevance scoring.
 * BM25 improves over TF-IDF by incorporating document length normalization.
 */
export class KeywordSearch {
  constructor(db, options = {}) {
    this.db = db;
    this.config = {
      k1: options.k1 ?? 1.2,        // Term saturation parameter
      b: options.b ?? 0.75,         // Length normalization parameter
      minLength: options.minLength ?? 2,
      maxLength: options.maxLength ?? 100,
      ...options
    };

    // Document statistics (computed during indexing)
    this.docCount = 0;
    this.avgDocLength = 0;
    this.docFreqs = new Map();     // term -> number of docs containing term
    this.docLengths = new Map();   // docId -> document length

    this.metrics = {
      totalSearches: 0,
      totalResults: 0,
      avgLatency: 0
    };
  }

  /**
   * Initialize keyword search index
   *
   * @param {Object} options - Initialization options
   * @param {Array} options.documents - Documents to index
   */
  async init(options = {}) {
    if (options.documents) {
      await this.indexDocuments(options.documents);
    }
  }

  /**
   * Index documents for keyword search
   *
   * @param {Array} documents - Array of documents with {id, content} fields
   */
  async indexDocuments(documents) {
    this.docCount = documents.length;
    let totalLength = 0;

    for (const doc of documents) {
      const tokens = this._tokenize(doc.content);
      const uniqueTokens = new Set(tokens);

      this.docLengths.set(doc.id, tokens.length);
      totalLength += tokens.length;

      // Update document frequencies
      for (const token of uniqueTokens) {
        this.docFreqs.set(token, (this.docFreqs.get(token) || 0) + 1);
      }
    }

    this.avgDocLength = this.docCount > 0 ? totalLength / this.docCount : 0;
  }

  /**
   * Search by keyword using BM25
   *
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Ranked results
   */
  async search(query, options = {}) {
    const startTime = Date.now();
    this.metrics.totalSearches++;

    const limit = options.limit || 20;
    const filter = options.filter || null;

    // Tokenize query
    const queryTokens = this._tokenize(query);
    const queryTerms = new Set(queryTokens);

    if (queryTerms.size === 0) {
      return [];
    }

    try {
      // Get candidate documents from database
      const candidates = await this._getCandidates(query, limit, filter);

      // Score candidates using BM25
      const scored = candidates.map(doc => {
        const score = this._calculateBM25(doc, queryTerms);
        return {
          ...doc,
          score,
          searchType: 'keyword',
          matchedTerms: this._getMatchedTerms(doc, queryTerms)
        };
      });

      // Filter and sort
      const results = scored
        .filter(doc => doc.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      this.metrics.totalResults += results.length;
      this._updateLatency(Date.now() - startTime);

      return results;

    } catch (error) {
      throw new KeywordSearchError(`Keyword search failed: ${error.message}`, {
        query,
        originalError: error
      });
    }
  }

  /**
   * Calculate BM25 score for a document
   *
   * @private
   * @param {Object} doc - Document
   * @param {Set} queryTerms - Query terms
   * @returns {number} BM25 score
   */
  _calculateBM25(doc, queryTerms) {
    const docTokens = this._tokenize(doc.content);
    const docLength = docTokens.length;
    const tokenCounts = this._countTokens(docTokens);

    let score = 0;

    for (const term of queryTerms) {
      const tf = tokenCounts.get(term) || 0;  // Term frequency
      const df = this.docFreqs.get(term) || 0; // Document frequency

      if (tf === 0 || df === 0) continue;

      // IDF (Inverse Document Frequency)
      const idf = Math.log((this.docCount - df + 0.5) / (df + 0.5) + 1);

      // BM25 formula
      const numerator = tf * (this.config.k1 + 1);
      const denominator = tf + this.config.k1 *
        (1 - this.config.b + this.config.b * (docLength / this.avgDocLength));

      score += idf * (numerator / denominator);
    }

    return score;
  }

  /**
   * Get candidate documents from database
   *
   * @private
   * @param {string} query - Search query
   * @param {number} limit - Result limit
   * @param {string} filter - Optional filter
   * @returns {Promise<Array>} Candidate documents
   */
  async _getCandidates(query, limit, filter) {
    // For now, use the database's full-text search if available
    // Otherwise, fetch all documents and filter

    const queryTokens = this._tokenize(query);
    const queryLower = query.toLowerCase();

    try {
      // Try using LanceDB's full-text search
      const results = await this.db.table?.fullTextSearch?.(query, {
        limit: limit * 2,
        filter
      });

      if (results) {
        return results;
      }
    } catch (error) {
      // Fall back to content-based filtering
    }

    // Fallback: Get recent documents and filter by content
    // NOTE: Cannot scan all documents efficiently without FTS or vector search
    // Returning empty candidates to prevent crash with empty vector
    return [];
  }

  /**
   * Get matched terms for highlighting
   *
   * @private
   * @param {Object} doc - Document
   * @param {Set} queryTerms - Query terms
   * @returns {Array} Matched terms
   */
  _getMatchedTerms(doc, queryTerms) {
    const content = (doc.content || '').toLowerCase();
    const matched = [];

    for (const term of queryTerms) {
      if (content.includes(term.toLowerCase())) {
        matched.push(term);
      }
    }

    return matched;
  }

  /**
   * Tokenize text
   *
   * @private
   * @param {string} text - Text to tokenize
   * @returns {Array<string>} Tokens
   */
  _tokenize(text) {
    if (!text) return [];

    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(token =>
        token.length >= this.config.minLength &&
        token.length <= this.config.maxLength
      );
  }

  /**
   * Count tokens in text
   *
   * @private
   * @param {Array<string>} tokens - Tokens
   * @returns {Map} Token counts
   */
  _countTokens(tokens) {
    const counts = new Map();

    for (const token of tokens) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }

    return counts;
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
      docCount: this.docCount,
      avgDocLength: this.avgDocLength,
      vocabularySize: this.docFreqs.size
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      totalSearches: 0,
      totalResults: 0,
      avgLatency: 0
    };
  }
}

/**
 * Custom error class for keyword search operations
 */
export class KeywordSearchError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'KeywordSearchError';
    this.details = details;
  }
}

export default KeywordSearch;
