/**
 * PatternMiner - Analyzes search results for patterns and insights
 */

import crypto from "crypto";

class PatternMiner {
  constructor(options = {}) {
    // @ts-ignore
    this.similarityThreshold = options.similarityThreshold || 0.8;
    // @ts-ignore
    this.minClusterSize = options.minClusterSize || 2;
    // @ts-ignore
    this.maxThemes = options.maxThemes || 10;
    // @ts-ignore
    this.minWordLength = options.minWordLength || 4;
  }

  async minePatterns(results, options = {}) {
    // @ts-ignore
    const { extractEntities = false, deduplicate = true } = options;
    let workingResults = [...results];
    if (deduplicate) workingResults = this.deduplicate(workingResults);

    const patterns = {
      originalCount: results.length,
      uniqueCount: workingResults.length,
      duplicatesRemoved: results.length - workingResults.length,
      clusters: [],
      themes: [],
      entities: [],
      summary: ''
    };

    // @ts-ignore
    patterns.clusters = this._clusterResults(workingResults);
    // @ts-ignore
    patterns.themes = this._extractThemes(workingResults);

    if (extractEntities) {
      // @ts-ignore
      patterns.entities = await this._extractEntities(workingResults);
    }

    patterns.summary = this._generateSummary(patterns);
    return patterns;
  }

  _clusterResults(results) {
    const clusters = [];
    const used = new Set();
    for (let i = 0; i < results.length; i++) {
      if (used.has(i)) continue;
      const cluster = { representative: results[i], members: [results[i]], similarityScore: 1.0 };
      for (let j = i + 1; j < results.length; j++) {
        if (used.has(j)) continue;
        const similarity = this._calculateSimilarity(results[i], results[j]);
        if (similarity >= this.similarityThreshold) {
          cluster.members.push(results[j]);
          used.add(j);
          cluster.similarityScore = Math.min(cluster.similarityScore, similarity);
        }
      }
      if (cluster.members.length >= this.minClusterSize || cluster.members.length === 1) {
        used.add(i);
        clusters.push(cluster);
      }
    }
    return clusters;
  }

  _calculateSimilarity(result1, result2) {
    let score = 0;
    let factors = 0;
    if (result1.score !== undefined && result2.score !== undefined) {
      const scoreDiff = Math.abs(result1.score - result2.score);
      const scoreSim = Math.max(0, 1 - scoreDiff);
      score += scoreSim * 0.5;
      factors += 0.5;
    }
    if (result1.metadata?.type && result2.metadata?.type) {
      const typeMatch = result1.metadata.type === result2.metadata.type ? 1 : 0;
      score += typeMatch * 0.25;
      factors += 0.25;
    }
    const contentSim = this._contentOverlap(result1.content, result2.content);
    score += contentSim * 0.1;
    factors += 0.1;
    return factors > 0 ? score / factors : 0;
  }

  _contentOverlap(content1, content2) {
    const words1 = new Set(content1.toLowerCase().split(/\s+/).filter(w => w.length > this.minWordLength));
    const words2 = new Set(content2.toLowerCase().split(/\s+/).filter(w => w.length > this.minWordLength));
    if (words1.size === 0 || words2.size === 0) return 0;
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    return intersection.size / union.size;
  }

  _extractThemes(results) {
    const themeMap = new Map();
    const stopWords = new Set(['the', 'this', 'that', 'with', 'from', 'have', 'been', 'were', 'they', 'their', 'what', 'when', 'where', 'which', 'will', 'your', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'could', 'would', 'should', 'each', 'only', 'being', 'other', 'some', 'such', 'them', 'these', 'those', 'over', 'also']);
    results.forEach(result => {
      const words = result.content.toLowerCase().split(/\s+/).map(w => w.replace(/[^a-z]/g, '')).filter(w => w.length >= this.minWordLength && !stopWords.has(w));
      words.forEach(word => {
        themeMap.set(word, (themeMap.get(word) || 0) + 1);
      });
    });
    return Array.from(themeMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, this.maxThemes).map(([word, count]) => ({
      word, count, frequency: count / results.length
    }));
  }

  async _extractEntities(results) {
    const entities = [];
    results.forEach(result => {
      const emailMatches = result.content.match(/\b[\w.-]+@[\w.-]+\.\w+\b/g);
      if (emailMatches) emailMatches.forEach(e => entities.push({ type: 'email', value: e }));
    });
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

  _generateSummary(patterns) {
    return `Original results: ${patterns.originalCount}, Unique results: ${patterns.uniqueCount}`;
  }

  deduplicate(results) {
    const seen = new Set();
    const unique = [];
    results.forEach(result => {
      const hash = crypto.createHash('md5').update(result.content).digest('hex');
      if (!seen.has(hash)) {
        seen.add(hash);
        unique.push(result);
      }
    });
    return unique;
  }

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