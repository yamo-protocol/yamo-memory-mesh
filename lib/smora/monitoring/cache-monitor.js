/**
 * S-MORA Cache Monitor
 * Monitors cache performance with hit rates, eviction tracking, and statistics
 * @module smora/monitoring/cache-monitor
 */

import { QueryCache } from '../cache/index.js';

/**
 * Cache performance monitor
 */
export class CacheMonitor {
  /**
   * @param {QueryCache} cache - The cache instance to monitor
   */
  constructor(cache) {
    this.cache = cache;
    this.startTime = Date.now();
  }

  /**
   * Get comprehensive cache statistics
   *
   * @returns {Object} Cache statistics
   */
  getStats() {
    const cacheStats = this.cache.getStats();
    const elapsedSeconds = (Date.now() - this.startTime) / 1000;

    // Get internal metrics if available
    const metrics = this.cache.metrics || { hits: 0, misses: 0 };

    const total = metrics.hits + metrics.misses;

    return {
      // Current cache state
      size: cacheStats.size,
      maxSize: cacheStats.maxSize,
      utilization: cacheStats.size / cacheStats.maxSize,

      // Performance metrics
      hits: metrics.hits,
      misses: metrics.misses,
      total: total,
      hitRate: total > 0 ? metrics.hits / total : 0,
      missRate: total > 0 ? metrics.misses / total : 0,

      // Timing metrics (if available)
      hitLatencies: metrics.hitLatencies || [],
      missLatencies: metrics.missLatencies || [],

      // Calculate percentiles for latencies
      avgHitLatency: this._average(metrics.hitLatencies),
      avgMissLatency: this._average(metrics.missLatencies),
      p50HitLatency: this._percentile(metrics.hitLatencies, 50),
      p95HitLatency: this._percentile(metrics.hitLatencies, 95),
      p50MissLatency: this._percentile(metrics.missLatencies, 50),
      p95MissLatency: this._percentile(metrics.missLatencies, 95),

      // Rate metrics
      opsPerSecond: elapsedSeconds > 0 ? total / elapsedSeconds : 0,

      // Cache keys
      keys: cacheStats.keys
    };
  }

  /**
   * Get formatted cache report for CLI output
   *
   * @returns {string} Formatted cache report
   */
  getReport() {
    const stats = this.getStats();
    const lines = [];

    lines.push('=== Cache Performance Report ===');
    lines.push('');
    lines.push('📦 Cache State:');
    lines.push(`   Size: ${stats.size}/${stats.maxSize} entries (${(stats.utilization * 100).toFixed(1)}% utilized)`);
    lines.push('');
    lines.push('🎯 Performance:');
    lines.push(`   Hits: ${stats.hits} (${(stats.hitRate * 100).toFixed(1)}%)`);
    lines.push(`   Misses: ${stats.misses} (${(stats.missRate * 100).toFixed(1)}%)`);
    lines.push(`   Total Ops: ${stats.total}`);
    lines.push(`   Throughput: ${stats.opsPerSecond.toFixed(1)} ops/sec`);
    lines.push('');

    if (stats.avgHitLatency > 0) {
      lines.push('⚡ Hit Latency:');
      lines.push(`   Avg: ${stats.avgHitLatency.toFixed(2)}ms`);
      lines.push(`   P50: ${stats.p50HitLatency.toFixed(2)}ms`);
      lines.push(`   P95: ${stats.p95HitLatency.toFixed(2)}ms`);
    }

    if (stats.avgMissLatency > 0) {
      lines.push('🐌 Miss Latency:');
      lines.push(`   Avg: ${stats.avgMissLatency.toFixed(2)}ms`);
      lines.push(`   P50: ${stats.p50MissLatency.toFixed(2)}ms`);
      lines.push(`   P95: ${stats.p95MissLatency.toFixed(2)}ms`);
    }

    return lines.join('\n');
  }

  /**
   * Calculate average of array
   *
   * @private
   * @param {Array<number>} values - Array of values
   * @returns {number} Average
   */
  _average(values) {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  /**
   * Calculate percentile of array
   *
   * @private
   * @param {Array<number>} values - Array of values
   * @param {number} percentile - Percentile (0-100)
   * @returns {number} Percentile value
   */
  _percentile(values, percentile) {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.floor((percentile / 100) * sorted.length);
    return sorted[Math.min(index, sorted.length - 1)];
  }
}
