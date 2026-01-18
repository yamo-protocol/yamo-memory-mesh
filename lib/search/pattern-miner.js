/**
 * PatternMiner - Analyzes search results for patterns and insights
 * Implements clustering, theme extraction, and deduplication
 */

import crypto from "crypto";

class PatternMiner {
  /**
   * Create a new PatternMiner
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    this.similarityThreshold = options.similarityThreshold || 0.8;
    this.minClusterSize = options.minClusterSize || 2;
    this.maxThemes = options.maxThemes || 10;
    this.minWordLength = options.minWordLength || 4;
  }

  /**
   * Mine patterns from search results
   * @param {Array} results - Search results to analyze
   * @param {Object} options - Analysis options
   * @param {boolean} options.extractEntities - Extract entities (default: false)
   * @param {boolean} options.deduplicate - Remove duplicates (default: true)
   * @returns {Promise<Object>} Pattern analysis results
   */
  async minePatterns(results, options = {}) {
    const { extractEntities = false, deduplicate = true } = options;

    let workingResults = [...results];

    // Deduplicate if requested
    if (deduplicate) {
      workingResults = this.deduplicate(workingResults);
    }

    const patterns = {
      originalCount: results.length,
      uniqueCount: workingResults.length,
      duplicatesRemoved: results.length - workingResults.length,
      clusters: [],
      themes: [],
      entities: [],
      summary: ''
    };

    // Cluster similar results
    patterns.clusters = this._clusterResults(workingResults);

    // Extract common themes
    patterns.themes = this._extractThemes(workingResults);

    // Identify entities (if enabled)
    if (extractEntities) {
      patterns.entities = await this._extractEntities(workingResults);
    }

    // Generate summary
    patterns.summary = this._generateSummary(patterns);

    return patterns;
  }

  /**
   * Cluster similar results together
   * @private
   * @param {Array} results - Results to cluster
   * @returns {Array} Clusters
   */
  _clusterResults(results) {
    const clusters = [];
    const used = new Set();

    for (let i = 0; i < results.length; i++) {
      if (used.has(i)) continue;

      const cluster = {
        representative: results[i],
        members: [results[i]],
        similarityScore: 1.0
      };

      // Find similar items
      for (let j = i + 1; j < results.length; j++) {
        if (used.has(j)) continue;

        const similarity = this._calculateSimilarity(results[i], results[j]);

        if (similarity >= this.similarityThreshold) {
          cluster.members.push(results[j]);
          used.add(j);
          cluster.similarityScore = Math.min(cluster.similarityScore, similarity);
        }
      }

      // Only include clusters with minimum size
      if (cluster.members.length >= this.minClusterSize || cluster.members.length === 1) {
        used.add(i);
        clusters.push(cluster);
      }
    }

    return clusters;
  }

  /**
   * Calculate similarity between two results
   * @private
   * @param {Object} result1 - First result
   * @param {Object} result2 - Second result
   * @returns {number} Similarity score (0-1)
   */
  _calculateSimilarity(result1, result2) {
    let score = 0;
    let factors = 0;

    // Score similarity (weighted heavily)
    if (result1.score !== undefined && result2.score !== undefined) {
      const scoreDiff = Math.abs(result1.score - result2.score);
      const scoreSim = Math.max(0, 1 - scoreDiff);
      score += scoreSim * 0.5;
      factors += 0.5;
    }

    // Metadata type similarity
    if (result1.metadata?.type && result2.metadata?.type) {
      const typeMatch = result1.metadata.type === result2.metadata.type ? 1 : 0;
      score += typeMatch * 0.25;
      factors += 0.25;
    }

    // Source agent similarity
    if (result1.metadata?.source_agent && result2.metadata?.source_agent) {
      const sourceMatch = result1.metadata.source_agent === result2.metadata.source_agent ? 1 : 0;
      score += sourceMatch * 0.15;
      factors += 0.15;
    }

    // Content overlap (Jaccard-like)
    const contentSim = this._contentOverlap(result1.content, result2.content);
    score += contentSim * 0.1;
    factors += 0.1;

    return factors > 0 ? score / factors : 0;
  }

  /**
   * Calculate content word overlap
   * @private
   * @param {string} content1 - First content
   * @param {string} content2 - Second content
   * @returns {number} Overlap score (0-1)
   */
  _contentOverlap(content1, content2) {
    const words1 = new Set(content1.toLowerCase().split(/\s+/).filter(w => w.length > this.minWordLength));
    const words2 = new Set(content2.toLowerCase().split(/\s+/).filter(w => w.length > this.minWordLength));

    if (words1.size === 0 || words2.size === 0) return 0;

    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  /**
   * Extract common themes from results
   * @private
   * @param {Array} results - Results to analyze
   * @returns {Array} Top themes
   */
  _extractThemes(results) {
    const themeMap = new Map();
    const stopWords = new Set(['the', 'this', 'that', 'with', 'from', 'have', 'been', 'were', 'they', 'their', 'what', 'when', 'where', 'which', 'will', 'your', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'could', 'would', 'should', 'each', 'only', 'being', 'other', 'some', 'such', 'them', 'these', 'those', 'over', 'also']);

    results.forEach(result => {
      const words = result.content.toLowerCase()
        .split(/\s+/)
        .map(w => w.replace(/[^a-z]/g, ''))
        .filter(w => w.length >= this.minWordLength && !stopWords.has(w));

      words.forEach(word => {
        themeMap.set(word, (themeMap.get(word) || 0) + 1);
      });
    });

    // Return top themes
    return Array.from(themeMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.maxThemes)
      .map(([word, count]) => ({
        word,
        count,
        frequency: count / results.length
      }));
  }

  /**
   * Extract named entities from results
   * @private
   * @param {Array} results - Results to analyze
   * @returns {Promise<Array>} Extracted entities
   */
  async _extractEntities(results) {
    const entities = [];

    results.forEach(result => {
      // Email addresses
      const emailMatches = result.content.match(/\b[\w.-]+@[\w.-]+\.\w+\b/g);
      if (emailMatches) {
        emailMatches.forEach(e => entities.push({ type: 'email', value: e }));
      }

      // URLs
      const urlMatches = result.content.match(/https?:\/\/[^\s]+/g);
      if (urlMatches) {
        urlMatches.forEach(u => entities.push({ type: 'url', value: u }));
      }

      // File paths
      const pathMatches = result.content.match(/\/[^\s]+\.[a-zA-Z0-9]+/g);
      if (pathMatches) {
        pathMatches.forEach(p => entities.push({ type: 'path', value: p }));
      }

      // UUIDs
      const uuidMatches = result.content.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi);
      if (uuidMatches) {
        uuidMatches.forEach(u => entities.push({ type: 'uuid', value: u }));
      }

      // Numbers (version-like patterns)
      const versionMatches = result.content.match(/\bv?\d+\.\d+\.\d+[\d.]*\b/g);
      if (versionMatches) {
        versionMatches.forEach(v => entities.push({ type: 'version', value: v }));
      }
    });

    // Deduplicate entities
    const uniqueEntities = [];
    const seen = new Set();

    entities.forEach(e => {
      const key = `${e.type}:${e.value}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueEntities.push(e);
      }
    });

    return uniqueEntities;
  }

  /**
   * Generate summary of patterns
   * @private
   * @param {Object} patterns - Pattern analysis results
   * @returns {string} Summary text
   */
  _generateSummary(patterns) {
    const lines = [];

    lines.push(`Pattern Analysis Summary`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`Original results: ${patterns.originalCount}`);
    lines.push(`Unique results: ${patterns.uniqueCount}`);
    if (patterns.duplicatesRemoved > 0) {
      lines.push(`Duplicates removed: ${patterns.duplicatesRemoved}`);
    }

    lines.push(`\nClusters: ${patterns.clusters.length}`);
    patterns.clusters.slice(0, 5).forEach((cluster, i) => {
      lines.push(`  • Cluster ${i + 1}: ${cluster.members.length} item(s)`);
    });

    if (patterns.themes.length > 0) {
      lines.push(`\nTop themes:`);
      patterns.themes.slice(0, 5).forEach(theme => {
        lines.push(`  • "${theme.word}" (${theme.count} occurrences, ${(theme.frequency * 100).toFixed(1)}%)`);
      });
    }

    if (patterns.entities.length > 0) {
      const entityCounts = {};
      patterns.entities.forEach(e => {
        entityCounts[e.type] = (entityCounts[e.type] || 0) + 1;
      });
      lines.push(`\nEntities found: ${patterns.entities.length}`);
      Object.entries(entityCounts).forEach(([type, count]) => {
        lines.push(`  • ${type}: ${count}`);
      });
    }

    return lines.join('\n');
  }

  /**
   * Deduplicate results based on content hash
   * @param {Array} results - Results to deduplicate
   * @returns {Array} Deduplicated results
   */
  deduplicate(results) {
    const seen = new Set();
    const unique = [];

    results.forEach(result => {
      const hash = crypto.createHash('md5')
        .update(result.content)
        .digest('hex');

      if (!seen.has(hash)) {
        seen.add(hash);
        unique.push(result);
      }
    });

    return unique;
  }

  /**
   * Get miner statistics
   * @returns {Object} Configuration and stats
   */
  getStats() {
    return {
      similarityThreshold: this.similarityThreshold,
      minClusterSize: this.minClusterSize,
      maxThemes: this.maxThemes,
      minWordLength: this.minWordLength
    };
  }
}

export default PatternMiner;
