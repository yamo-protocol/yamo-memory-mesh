/**
 * HyDE Quality Scorer
 * Scores hypothetical document quality on 0-1 scale using weighted components:
 * - 40% semantic relevance (query-hypothetical token overlap)
 * - 30% informativeness (unique tokens, specificity)
 * - 20% coherence (structure, grammar)
 * - 10% length normalized
 *
 * Replaces negative filtering with positive quality scoring.
 * Quality threshold: 0.6 (fallback to raw query if below)
 */
export class HyDEQualityScorer {
  constructor(config = {}) {
    this.qualityThreshold = config.qualityThreshold || 0.6;
    this.weights = {
      semanticRelevance: 0.4,
      informativeness: 0.3,
      coherence: 0.2,
      length: 0.1
    };
  }

  /**
   * Score hypothetical quality
   * @param {string} query - Original query
   * @param {string} hypothetical - Generated hypothetical
   * @returns {number} Quality score (0-1)
   */
  scoreHypothetical(query, hypothetical) {
    const semanticScore = this.semanticRelevance(query, hypothetical);
    const informativenessScore = this.informativeness(hypothetical);
    const coherenceScore = this.coherence(hypothetical);
    const lengthScore = this.lengthNormalized(hypothetical);

    return (
      this.weights.semanticRelevance * semanticScore +
      this.weights.informativeness * informativenessScore +
      this.weights.coherence * coherenceScore +
      this.weights.length * lengthScore
    );
  }

  /**
   * Calculate semantic relevance via token overlap
   * @param {string} query - Original query
   * @param {string} hypothetical - Generated hypothetical
   * @returns {number} Relevance score (0-1)
   */
  semanticRelevance(query, hypothetical) {
    const queryTokens = new Set(this.tokenize(query.toLowerCase()));
    const hypTokens = new Set(this.tokenize(hypothetical.toLowerCase()));

    // Calculate Jaccard similarity
    const intersection = new Set([...queryTokens].filter(t => hypTokens.has(t)));
    const union = new Set([...queryTokens, ...hypTokens]);

    if (union.size === 0) return 0;

    return intersection.size / union.size;
  }

  /**
   * Calculate informativeness (unique token ratio + specificity)
   * @param {string} hypothetical - Generated hypothetical
   * @returns {number} Informativeness score (0-1)
   */
  informativeness(hypothetical) {
    const tokens = this.tokenize(hypothetical);
    const uniqueTokens = new Set(tokens);

    // Unique token ratio
    const uniqueRatio = uniqueTokens.size / tokens.length;

    // Check for generic refusal phrases (penalty)
    const genericPhrases = [
      'I am not sure',
      'I don\'t know',
      'I cannot',
      'I\'m not sure',
      'I can\'t',
      'maybe',
      'perhaps',
      'possibly'
    ];

    const hasGeneric = genericPhrases.some(phrase =>
      hypothetical.toLowerCase().includes(phrase.toLowerCase())
    );

    // Check for technical specificity (bonus)
    const technicalIndicators = [
      /\b[A-Z]{2,}\b/, // Acronyms
      /\b\w+\.\w+\b/,  // Dotted notation (e.g., file.js, API.method)
      /\b\d+\b/,       // Numbers
      /[{}\[\]()]/     // Code-like syntax
    ];

    const hasTechnical = technicalIndicators.some(regex => regex.test(hypothetical));

    let score = uniqueRatio;
    if (hasGeneric) score *= 0.2; // Very heavy penalty for refusals (was 0.3)
    if (hasTechnical) score *= 1.2; // Moderate bonus for specificity

    return Math.min(score, 1.0);
  }

  /**
   * Calculate coherence (sentence structure + repetition check)
   * @param {string} hypothetical - Generated hypothetical
   * @returns {number} Coherence score (0-1)
   */
  coherence(hypothetical) {
    // Split into sentences
    const sentences = hypothetical.split(/[.!?]+/).filter(s => s.trim().length > 0);

    if (sentences.length === 0) return 0;

    // Check capitalization
    const hasCapitalization = sentences.every(s => /^[A-Z\s]/.test(s.trim()));

    // Check for excessive word repetition
    const tokens = this.tokenize(hypothetical.toLowerCase());
    const tokenCounts = {};
    tokens.forEach(t => {
      tokenCounts[t] = (tokenCounts[t] || 0) + 1;
    });

    const maxRepeat = Math.max(...Object.values(tokenCounts));
    const excessiveRepetition = maxRepeat > tokens.length * 0.25; // >25% repetition (was 30%)

    // Check for sentence variety (different lengths)
    const sentenceLengths = sentences.map(s => this.tokenize(s).length);
    const avgLength = sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length;
    const variance = sentenceLengths.reduce((sum, len) => sum + Math.pow(len - avgLength, 2), 0) / sentenceLengths.length;
    const hasVariety = variance > 10; // Some variety in sentence lengths

    let score = 0.5; // Base score

    if (hasCapitalization) score += 0.2;
    if (!excessiveRepetition) score += 0.2;
    if (hasVariety) score += 0.1;

    return Math.min(score, 1.0);
  }

  /**
   * Calculate length-normalized score
   * @param {string} hypothetical - Generated hypothetical
   * @returns {number} Length score (0-1)
   */
  lengthNormalized(hypothetical) {
    const length = hypothetical.length;

    // Ideal range: 100-400 characters
    if (length < 20) return 0.2;      // Too short
    if (length > 500) return 0.6;     // Too long
    if (length >= 100 && length <= 400) return 1.0; // Ideal

    // Gradual scoring for intermediate lengths
    if (length < 100) {
      return 0.2 + 0.8 * (length / 100); // 20-100 chars: 0.2-1.0
    } else {
      return 1.0 - 0.4 * ((length - 400) / 100); // 400-500 chars: 1.0-0.6
    }
  }

  /**
   * Determine if fallback to raw query is needed
   * @param {number} score - Quality score
   * @returns {boolean} True if should fallback
   */
  shouldFallback(score) {
    return score < this.qualityThreshold;
  }

  /**
   * Tokenize text (simple whitespace split + punctuation removal)
   * @param {string} text - Text to tokenize
   * @returns {string[]} Tokens
   */
  tokenize(text) {
    return text
      .replace(/[^\w\s]/g, ' ') // Remove punctuation
      .split(/\s+/)              // Split on whitespace
      .filter(t => t.length > 0); // Remove empty tokens
  }

  /**
   * Get scoring breakdown for debugging
   * @param {string} query - Original query
   * @param {string} hypothetical - Generated hypothetical
   * @returns {Object} Detailed scoring breakdown
   */
  getScoreBreakdown(query, hypothetical) {
    const semanticScore = this.semanticRelevance(query, hypothetical);
    const informativenessScore = this.informativeness(hypothetical);
    const coherenceScore = this.coherence(hypothetical);
    const lengthScore = this.lengthNormalized(hypothetical);

    const totalScore = this.scoreHypothetical(query, hypothetical);

    return {
      semantic: {
        score: semanticScore,
        weight: this.weights.semanticRelevance,
        contribution: semanticScore * this.weights.semanticRelevance
      },
      informativeness: {
        score: informativenessScore,
        weight: this.weights.informativeness,
        contribution: informativenessScore * this.weights.informativeness
      },
      coherence: {
        score: coherenceScore,
        weight: this.weights.coherence,
        contribution: coherenceScore * this.weights.coherence
      },
      length: {
        score: lengthScore,
        weight: this.weights.length,
        contribution: lengthScore * this.weights.length
      },
      total: totalScore,
      shouldFallback: this.shouldFallback(totalScore)
    };
  }
}
