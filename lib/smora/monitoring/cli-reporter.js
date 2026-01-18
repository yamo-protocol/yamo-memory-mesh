/**
 * S-MORA CLI Reporter
 * Formats and displays metrics for console output
 * @module smora/monitoring/cli-reporter
 */

/**
 * CLI Metrics Reporter
 */
export class CLIReporter {
  /**
   * Print formatted metrics to console
   *
   * @param {Object} metrics - Metrics object from orchestrator
   */
  static printMetrics(metrics) {
    const lines = [];

    lines.push('');
    lines.push('╔════════════════════════════════════════════════════════════╗');
    lines.push('║           S-MORA Performance Metrics                     ║');
    lines.push('╚════════════════════════════════════════════════════════════╝');
    lines.push('');

    // Configuration
    if (metrics.config) {
      lines.push('⚙️  Configuration:');
      lines.push(`   S-MORA: ${metrics.config.enabled ? '✅ Enabled' : '❌ Disabled'}`);
      lines.push(`   HyDE: ${metrics.config.hydeEnabled ? '✅ Enabled' : '❌ Disabled'}`);
      lines.push(`   Compression: ${metrics.config.compressionEnabled ? '✅ Enabled' : '❌ Disabled'}`);
      lines.push(`   Cache: ${metrics.cache?.enabled ? '✅ Enabled' : '❌ Disabled'}`);
      lines.push('');
    }

    // Cache metrics
    if (metrics.cache?.enabled) {
      lines.push('📦 Cache Performance:');
      const cache = metrics.cache;
      const total = cache.hits + cache.misses;
      const hitRate = total > 0 ? (cache.hits / total * 100).toFixed(1) : '0.0';

      lines.push(`   Hit Rate: ${hitRate}% (${cache.hits}/${total})`);
      lines.push(`   Size: ${cache.size}/${cache.maxSize} entries`);

      if (cache.hitLatencies && cache.hitLatencies.length > 0) {
        lines.push(`   Hit Latency:`);
        lines.push(`     P50: ${this._percentile(cache.hitLatencies, 50).toFixed(0)}ms`);
        lines.push(`     P95: ${this._percentile(cache.hitLatencies, 95).toFixed(0)}ms`);
        lines.push(`     P99: ${this._percentile(cache.hitLatencies, 99).toFixed(0)}ms`);
      }
      lines.push('');
    }

    // Orchestrator metrics
    if (metrics.orchestrator) {
      lines.push('📊 Orchestrator:');
      const orch = metrics.orchestrator;
      const summary = orch.summary || {};

      if (summary.retrieve) {
        const retrieve = summary.retrieve;
        lines.push(`   Retrieve:`);
        lines.push(`     Total: ${retrieve.count} calls`);
        lines.push(`     Avg: ${retrieve.avgLatency?.toFixed(1) || 'N/A'}ms`);
        lines.push(`     P50: ${retrieve.p50?.toFixed(1) || 'N/A'}ms`);
        lines.push(`     P95: ${retrieve.p95?.toFixed(1) || 'N/A'}ms`);
        lines.push(`     P99: ${retrieve.p99?.toFixed(1) || 'N/A'}ms`);
      }

      if (summary.batch) {
        const batch = summary.batch;
        lines.push(`   Batch:`);
        lines.push(`     Total: ${batch.count} calls`);
        lines.push(`     Avg: ${batch.avgLatency?.toFixed(1) || 'N/A'}ms`);
      }
      lines.push('');
    }

    // Assembly metrics
    if (metrics.assembly) {
      lines.push('🔧 Context Assembly:');
      lines.push(`   Format Strategy: ${metrics.assembly.structure || 'N/A'}`);
      lines.push(`   Citations: ${metrics.assembly.includeCitations ? '✅' : '❌'}`);
      lines.push(`   With Summary: ${metrics.assembly.includeSummary ? '✅' : '❌'}`);
      lines.push('');
    }

    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('');

    console.log(lines.join('\n'));
  }

  /**
   * Print cache-specific report
   *
   * @param {Object} cacheReport - Cache report from CacheMonitor
   */
  static printCacheReport(cacheReport) {
    console.log(cacheReport);
  }

  /**
   * Create a summary table of all operations
   *
   * @param {Object} metrics - Metrics object
   * @returns {string} Formatted table
   */
  static createSummaryTable(metrics) {
    const lines = [];

    lines.push('┌─────────────────────────────────────────────────────────────────┐');
    lines.push('│ Operation                    │ Calls  │ P50     │ P95     │ P99     │');
    lines.push('├─────────────────────────────────────────────────────────────────┤');

    if (metrics.orchestrator?.summary) {
      for (const [op, stats] of Object.entries(metrics.orchestrator.summary)) {
        const name = op.padEnd(28);
        const count = stats.count.toString().padEnd(7);
        const p50 = (stats.p50?.toFixed(1) || 'N/A').padEnd(7);
        const p95 = (stats.p95?.toFixed(1) || 'N/A').padEnd(7);
        const p99 = (stats.p99?.toFixed(1) || 'N/A').padEnd(7);

        lines.push(`│ ${name} │ ${count} │ ${p50} │ ${p95} │ ${p99} │`);
      }
    }

    lines.push('└─────────────────────────────────────────────────────────────────┘');

    return lines.join('\n');
  }

  /**
   * Calculate percentile from array
   *
   * @private
   * @param {Array<number>} values - Array of values
   * @param {number} percentile - Percentile (0-100)
   * @returns {number} Percentile value
   */
  static _percentile(values, percentile) {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.floor((percentile / 100) * sorted.length);
    return sorted[Math.min(index, sorted.length - 1)];
  }
}
