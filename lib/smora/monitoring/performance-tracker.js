/**
 * S-MORA Performance Tracker
 * Tracks latency metrics, percentiles, throughput, and error rates
 * @module smora/monitoring/performance-tracker
 */

/**
 * Performance tracker for S-MORA operations
 */
export class PerformanceTracker {
  /**
   * @param {Object} options - Configuration options
   * @param {number} options.windowSize - Max samples to keep per operation (default: 1000)
   */
  constructor(options = {}) {
    this.windowSize = options.windowSize || 1000;

    // Metrics map: operation -> { latencies, errors, startTime }
    this.metrics = new Map();
  }

  /**
   * Record a successful operation latency
   *
   * @param {string} operation - Operation name (e.g., 'retrieve', 'batch')
   * @param {number} latency - Latency in milliseconds
   */
  recordLatency(operation, latency) {
    if (!this.metrics.has(operation)) {
      this.metrics.set(operation, {
        latencies: [],
        count: 0,
        totalLatency: 0,
        errors: 0,
        errorMessages: [],
        startTime: Date.now()
      });
    }

    const metric = this.metrics.get(operation);

    // Add latency and enforce window size
    metric.latencies.push(latency);
    metric.count++;
    metric.totalLatency += latency;

    if (metric.latencies.length > this.windowSize) {
      metric.latencies.shift(); // Remove oldest
    }
  }

  /**
   * Record an error for an operation
   *
   * @param {string} operation - Operation name
   * @param {string} error - Error message
   */
  recordError(operation, error) {
    if (!this.metrics.has(operation)) {
      this.metrics.set(operation, {
        latencies: [],
        count: 0,
        totalLatency: 0,
        errors: 0,
        errorMessages: [],
        startTime: Date.now()
      });
    }

    const metric = this.metrics.get(operation);
    metric.errors++;
    metric.errorMessages.push(error);

    // Keep only recent errors (same limit as latencies)
    if (metric.errorMessages.length > this.windowSize) {
      metric.errorMessages.shift();
    }
  }

  /**
   * Get performance summary for all operations
   *
   * @returns {Object} Performance summary
   */
  getSummary() {
    const summary = {};

    for (const [operation, metric] of this.metrics.entries()) {
      const elapsedSeconds = (Date.now() - metric.startTime) / 1000;

      summary[operation] = {
        count: metric.count,
        errorCount: metric.errors,
        errorRate: metric.count > 0 ? metric.errors / metric.count : 0,
        avgLatency: metric.count > 0 ? metric.totalLatency / metric.count : 0,
        throughput: elapsedSeconds > 0 ? metric.count / elapsedSeconds : 0,
        ...this.getPercentiles(operation)
      };
    }

    return summary;
  }

  /**
   * Get percentile statistics for an operation
   *
   * @param {string} operation - Operation name
   * @returns {Object} Percentile statistics
   */
  getPercentiles(operation) {
    if (!this.metrics.has(operation)) {
      return {
        p50: 0,
        p95: 0,
        p99: 0,
        min: 0,
        max: 0
      };
    }

    const metric = this.metrics.get(operation);
    const latencies = [...metric.latencies].sort((a, b) => a - b);

    if (latencies.length === 0) {
      return {
        p50: 0,
        p95: 0,
        p99: 0,
        min: 0,
        max: 0
      };
    }

    return {
      p50: this._calculatePercentile(latencies, 50),
      p95: this._calculatePercentile(latencies, 95),
      p99: this._calculatePercentile(latencies, 99),
      min: latencies[0],
      max: latencies[latencies.length - 1]
    };
  }

  /**
   * Calculate percentile from sorted array using linear interpolation
   *
   * @private
   * @param {Array<number>} sorted - Sorted array of values
   * @param {number} percentile - Percentile to calculate (0-100)
   * @returns {number} Percentile value
   */
  _calculatePercentile(sorted, percentile) {
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0];

    const index = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.min(Math.ceil(index), sorted.length - 1);
    const weight = index - lower;

    const result = sorted[lower] * (1 - weight) + sorted[upper] * weight;

    // Round to handle floating point precision issues
    return Math.round(result * 100) / 100;
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.metrics.clear();
  }
}
