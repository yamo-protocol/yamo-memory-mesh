/**
 * Quality Metrics Tracking for S-MORA
 * Records quality measurements across all layers
 *
 * Tracks:
 * - Layer 0 (Scrubber): Signal-to-noise ratio, boilerplate removal
 * - Layer 1 (HyDE): Relevance scores, fallback rate
 * - Layer 2 (Retrieval): Precision, recall, diversity
 * - Layer 3 (Compression): Retention, compression ratio
 * - Layer 4 (Assembly): Token utilization, clarity
 */
export class QualityMetrics {
  constructor() {
    this.scrubberMetrics = [];
    this.hydeMetrics = [];
    this.retrievalMetrics = [];
    this.compressionMetrics = [];
    this.assemblyMetrics = [];
  }

  /**
   * Record scrubber quality metrics
   * @param {Object} metrics - { signalRatio, boilerplateRemoved, deterministic }
   */
  recordScrubberQuality({ signalRatio, boilerplateRemoved, deterministic }) {
    this.scrubberMetrics.push({
      signalRatio,
      boilerplateRemoved,
      deterministic,
      timestamp: Date.now()
    });
  }

  /**
   * Record HyDE quality metrics
   * @param {Object} metrics - { relevanceScore, fallback, templateType }
   */
  recordHyDEQuality({ relevanceScore, fallback, templateType }) {
    this.hydeMetrics.push({
      relevanceScore,
      fallback,
      templateType,
      timestamp: Date.now()
    });
  }

  /**
   * Record retrieval quality metrics
   * @param {Object} metrics - { precision5, recall10, diversity }
   */
  recordRetrievalQuality({ precision5, recall10, diversity }) {
    this.retrievalMetrics.push({
      precision5,
      recall10,
      diversity,
      timestamp: Date.now()
    });
  }

  /**
   * Record compression quality metrics
   * @param {Object} metrics - { retention, ratio, coherence }
   */
  recordCompressionQuality({ retention, ratio, coherence }) {
    this.compressionMetrics.push({
      retention,
      ratio,
      coherence,
      timestamp: Date.now()
    });
  }

  /**
   * Record assembly quality metrics
   * @param {Object} metrics - { tokenUtilization, clarityScore, citationAccuracy }
   */
  recordAssemblyQuality({ tokenUtilization, clarityScore, citationAccuracy }) {
    this.assemblyMetrics.push({
      tokenUtilization,
      clarityScore,
      citationAccuracy,
      timestamp: Date.now()
    });
  }

  /**
   * Get scrubber statistics
   * @returns {Object} { avgSignalRatio, avgBoilerplateRemoved, deterministicRate }
   */
  getScrubberStats() {
    if (this.scrubberMetrics.length === 0) {
      return { avgSignalRatio: 0, avgBoilerplateRemoved: 0, deterministicRate: 0 };
    }

    const sum = this.scrubberMetrics.reduce((acc, m) => acc + m.signalRatio, 0);
    const boilerplateSum = this.scrubberMetrics.reduce((acc, m) => acc + (m.boilerplateRemoved || 0), 0);
    const deterministicCount = this.scrubberMetrics.filter(m => m.deterministic).length;

    return {
      avgSignalRatio: sum / this.scrubberMetrics.length,
      avgBoilerplateRemoved: boilerplateSum / this.scrubberMetrics.length,
      deterministicRate: deterministicCount / this.scrubberMetrics.length
    };
  }

  /**
   * Get HyDE statistics
   * @returns {Object} { avgRelevance, fallbackRate, byTemplate }
   */
  getHyDEStats() {
    if (this.hydeMetrics.length === 0) {
      return { avgRelevance: 0, fallbackRate: 0 };
    }

    const relevanceSum = this.hydeMetrics.reduce((acc, m) => acc + m.relevanceScore, 0);
    const fallbackCount = this.hydeMetrics.filter(m => m.fallback).length;

    return {
      avgRelevance: relevanceSum / this.hydeMetrics.length,
      fallbackRate: fallbackCount / this.hydeMetrics.length
    };
  }

  /**
   * Get retrieval statistics
   * @returns {Object} { avgPrecision5, avgRecall10, avgDiversity }
   */
  getRetrievalStats() {
    if (this.retrievalMetrics.length === 0) {
      return { avgPrecision5: 0, avgRecall10: 0, avgDiversity: 0 };
    }

    const p5Sum = this.retrievalMetrics.reduce((acc, m) => acc + m.precision5, 0);
    const r10Sum = this.retrievalMetrics.reduce((acc, m) => acc + m.recall10, 0);
    const diversitySum = this.retrievalMetrics.reduce((acc, m) => acc + (m.diversity || 0), 0);

    return {
      avgPrecision5: p5Sum / this.retrievalMetrics.length,
      avgRecall10: r10Sum / this.retrievalMetrics.length,
      avgDiversity: diversitySum / this.retrievalMetrics.length
    };
  }

  /**
   * Get compression statistics
   * @returns {Object} { avgRetention, avgRatio, avgCoherence }
   */
  getCompressionStats() {
    if (this.compressionMetrics.length === 0) {
      return { avgRetention: 0, avgRatio: 0, avgCoherence: 0 };
    }

    const retentionSum = this.compressionMetrics.reduce((acc, m) => acc + m.retention, 0);
    const ratioSum = this.compressionMetrics.reduce((acc, m) => acc + m.ratio, 0);
    const coherenceSum = this.compressionMetrics.reduce((acc, m) => acc + (m.coherence || 0), 0);

    return {
      avgRetention: retentionSum / this.compressionMetrics.length,
      avgRatio: ratioSum / this.compressionMetrics.length,
      avgCoherence: coherenceSum / this.compressionMetrics.length
    };
  }

  /**
   * Get assembly statistics
   * @returns {Object} { avgTokenUtilization, avgClarityScore, avgCitationAccuracy }
   */
  getAssemblyStats() {
    if (this.assemblyMetrics.length === 0) {
      return { avgTokenUtilization: 0, avgClarityScore: 0, avgCitationAccuracy: 0 };
    }

    const tokenSum = this.assemblyMetrics.reduce((acc, m) => acc + m.tokenUtilization, 0);
    const claritySum = this.assemblyMetrics.reduce((acc, m) => acc + (m.clarityScore || 0), 0);
    const citationSum = this.assemblyMetrics.reduce((acc, m) => acc + (m.citationAccuracy || 0), 0);

    return {
      avgTokenUtilization: tokenSum / this.assemblyMetrics.length,
      avgClarityScore: claritySum / this.assemblyMetrics.length,
      avgCitationAccuracy: citationSum / this.assemblyMetrics.length
    };
  }

  /**
   * Get all statistics
   * @returns {Object} All layer statistics
   */
  getAllStats() {
    return {
      scrubber: this.getScrubberStats(),
      hyde: this.getHyDEStats(),
      retrieval: this.getRetrievalStats(),
      compression: this.getCompressionStats(),
      assembly: this.getAssemblyStats()
    };
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.scrubberMetrics = [];
    this.hydeMetrics = [];
    this.retrievalMetrics = [];
    this.compressionMetrics = [];
    this.assemblyMetrics = [];
  }

  /**
   * Get raw metrics for export/analysis
   * @returns {Object} All raw metrics
   */
  getRawMetrics() {
    return {
      scrubber: this.scrubberMetrics,
      hyde: this.hydeMetrics,
      retrieval: this.retrievalMetrics,
      compression: this.compressionMetrics,
      assembly: this.assemblyMetrics
    };
  }

  /**
   * Get metric count
   * @returns {number} Total metrics recorded
   */
  getCount() {
    return (
      this.scrubberMetrics.length +
      this.hydeMetrics.length +
      this.retrievalMetrics.length +
      this.compressionMetrics.length +
      this.assemblyMetrics.length
    );
  }
}
