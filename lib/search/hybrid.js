/**
 * HybridSearch - Combines vector and keyword search
 */

import { QueryError } from "../lancedb/errors.js";

class HybridSearch {
  constructor(client, embeddingFactory, options = {}) {
    this.client = client;
    this.embeddingFactory = embeddingFactory;
    this.alpha = options.alpha !== undefined
      ? options.alpha
      : parseFloat(process.env.HYBRID_SEARCH_ALPHA || '0.5');
    this.rrfK = options.rrfK || 60;
  }

  async search(query, options = {}) {
    // @ts-ignore
    const limit = options.limit || 10;
    // @ts-ignore
    const alpha = options.alpha !== undefined ? options.alpha : this.alpha;

    try {
      const [vectorResults, keywordResults] = await Promise.all([
        // @ts-ignore
        this._vectorSearch(query, limit * 2, options.filter),
        // @ts-ignore
        this._keywordSearch(query, limit * 2, options.filter)
      ]);

      const mergedResults = this._reciprocalRankFusion(
        vectorResults,
        keywordResults,
        alpha,
        this.rrfK
      );

      return mergedResults.slice(0, limit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new QueryError('Hybrid search failed', {
        query,
        alpha,
        originalError: message
      });
    }
  }

  async _vectorSearch(query, limit, filter = null) {
    const embedding = await this.embeddingFactory.embed(query);
    const searchOptions = { limit, metric: 'cosine' };
    if (filter) searchOptions.filter = filter;

    const result = await this.client.search(embedding, searchOptions);
    return result.map(r => ({
      ...r,
      score: 1 - (r.score || 0),
      searchType: 'vector'
    }));
  }

  async _keywordSearch(query, limit, filter = null) {
    try {
      const embedding = await this.embeddingFactory.embed(query);
      const searchOptions = { limit: limit * 3, metric: 'cosine' };
      if (filter) searchOptions.filter = filter;

      const result = await this.client.search(embedding, searchOptions);
      const queryTerms = query.toLowerCase().split(/\s+/);

      return result
        .filter(r => {
          const content = r.content.toLowerCase();
          return queryTerms.some(term => content.includes(term));
        })
        .slice(0, limit)
        .map(r => ({
          ...r,
          score: r.score || 0,
          searchType: 'keyword'
        }));
    } catch (error) {
      return [];
    }
  }

  _reciprocalRankFusion(vectorResults, keywordResults, alpha, k = 60) {
    const scores = new Map();
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

    keywordResults.forEach((result, index) => {
      const rr = 1 / (k + index + 1);
      if (scores.has(result.id)) {
        const entry = scores.get(result.id);
        entry.keywordScore = rr * alpha;
        entry.keywordRank = index + 1;
      } else {
        scores.set(result.id, {
          result,
          vectorScore: 0,
          keywordScore: rr * alpha,
          vectorRank: null,
          keywordRank: index + 1
        });
      }
    });

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

  getStats() {
    return { alpha: this.alpha, rrfK: this.rrfK, type: 'hybrid' };
  }
}

export default HybridSearch;