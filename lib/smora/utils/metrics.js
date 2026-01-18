/**
 * S-MORA Metrics Collector
 *
 * Collects and aggregates metrics from all S-MORA components
 *
 * @module smora/utils/metrics
 */

/**
 * Metrics Collector for S-MORA
 */
export class MetricsCollector {
  constructor() {
    this.metrics = {
      counts: {},
      timings: {},
      gauges: {}
    };
  }

  /**
   * Record a metric event
   *
   * @param {string} component - Component name (e.g., 'orchestrator', 'retrieval')
   * @param {string} event - Event name (e.g., 'retrieve', 'query_understanding')
   * @param {Object} data - Event data
   */
  record(component, event, data = {}) {
    const key = `${component}.${event}`;

    // Initialize counters if needed
    if (!this.metrics.counts[key]) {
      this.metrics.counts[key] = { success: 0, error: 0 };
    }

    // Record success/error counts
    if (data.success !== undefined) {
      if (data.success) {
        this.metrics.counts[key].success++;
      } else {
        this.metrics.counts[key].error++;
      }
    }

    // Record timing data
    if (data.duration !== undefined) {
      if (!this.metrics.timings[key]) {
        this.metrics.timings[key] = [];
      }
      this.metrics.timings[key].push(data.duration);
    }

    // Record gauge values
    if (data.value !== undefined) {
      this.metrics.gauges[key] = data.value;
    }
  }

  /**
   * Get metrics summary
   *
   * @returns {Object} Metrics summary
   */
  getSummary() {
    const summary = {
      counts: {},
      timings: {},
      gauges: { ...this.metrics.gauges }
    };

    // Summarize counts
    for (const [key, counts] of Object.entries(this.metrics.counts)) {
      summary.counts[key] = {
        ...counts,
        total: counts.success + counts.error,
        successRate: counts.success + counts.error > 0
          ? counts.success / (counts.success + counts.error)
          : 0
      };
    }

    // Summarize timings
    for (const [key, timings] of Object.entries(this.metrics.timings)) {
      if (timings.length > 0) {
        const sorted = [...timings].sort((a, b) => a - b);
        summary.timings[key] = {
          count: timings.length,
          min: sorted[0],
          max: sorted[sorted.length - 1],
          avg: timings.reduce((a, b) => a + b, 0) / timings.length,
          p50: sorted[Math.floor(sorted.length * 0.5)],
          p95: sorted[Math.floor(sorted.length * 0.95)],
          p99: sorted[Math.floor(sorted.length * 0.99)]
        };
      }
    }

    return summary;
  }

  /**
   * Get metrics for a specific component
   *
   * @param {string} component - Component name
   * @returns {Object} Component metrics
   */
  getComponentMetrics(component) {
    const summary = this.getSummary();
    const result = {};

    for (const [key, value] of Object.entries(summary.counts)) {
      if (key.startsWith(`${component}.`)) {
        result.counts = result.counts || {};
        result.counts[key] = value;
      }
    }

    for (const [key, value] of Object.entries(summary.timings)) {
      if (key.startsWith(`${component}.`)) {
        result.timings = result.timings || {};
        result.timings[key] = value;
      }
    }

    for (const [key, value] of Object.entries(summary.gauges)) {
      if (key.startsWith(`${component}.`)) {
        result.gauges = result.gauges || {};
        result.gauges[key] = value;
      }
    }

    return result;
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.metrics = {
      counts: {},
      timings: {},
      gauges: {}
    };
  }

  /**
   * Reset metrics for a specific component
   *
   * @param {string} component - Component name
   */
  resetComponent(component) {
    const prefix = `${component}.`;

    for (const key of Object.keys(this.metrics.counts)) {
      if (key.startsWith(prefix)) {
        delete this.metrics.counts[key];
      }
    }

    for (const key of Object.keys(this.metrics.timings)) {
      if (key.startsWith(prefix)) {
        delete this.metrics.timings[key];
      }
    }

    for (const key of Object.keys(this.metrics.gauges)) {
      if (key.startsWith(prefix)) {
        delete this.metrics.gauges[key];
      }
    }
  }

  /**
   * Export metrics as JSON
   *
   * @returns {string} JSON string of metrics
   */
  toJSON() {
    return JSON.stringify(this.getSummary(), null, 2);
  }

  /**
   * Get metrics formatted for logging
   *
   * @returns {Object} Formatted metrics
   */
  toLog() {
    const summary = this.getSummary();
    const formatted = {};

    for (const [key, counts] of Object.entries(summary.counts)) {
      const [component, event] = key.split('.');
      if (!formatted[component]) {
        formatted[component] = {};
      }
      formatted[component][event] = {
        success: counts.success,
        error: counts.error,
        total: counts.total,
        successRate: (counts.successRate * 100).toFixed(1) + '%'
      };
    }

    return formatted;
  }
}

export default MetricsCollector;
