/**
 * A/B Testing Framework for S-MORA Configurations
 *
 * Compares two configurations on same query set to measure:
 * - Latency improvements
 * - Quality improvements
 * - Statistical significance
 *
 * Enables evidence-based optimization decisions.
 */

import { SMORAOrchestrator } from '../orchestrator.js';

export class ABTestFramework {
  constructor(config = {}) {
    this.significanceThreshold = config.significanceThreshold || 0.05; // p-value threshold
  }

  /**
   * Run A/B test comparing two configurations
   *
   * @param {Object} configA - Configuration A (baseline)
   * @param {Object} configB - Configuration B (treatment)
   * @param {string[]} queries - Test queries
   * @param {Object} groundTruth - Optional ground truth for quality measurement
   * @returns {Promise<Object>} Test results with winner determination
   */
  async runTest(configA, configB, queries, groundTruth = null) {
    console.log(`🧪 Running A/B test on ${queries.length} queries...`);
    console.log('📊 Config A (Baseline) vs Config B (Treatment)\n');

    // Run config A
    console.log('Running Config A...');
    const orchA = new SMORAOrchestrator({ ...configA, qualityTracking: true });
    await orchA.initialize();
    const resultsA = await this.runQueries(orchA, queries, groundTruth);
    await orchA.shutdown();

    // Run config B
    console.log('Running Config B...');
    const orchB = new SMORAOrchestrator({ ...configB, qualityTracking: true });
    await orchB.initialize();
    const resultsB = await this.runQueries(orchB, queries, groundTruth);
    await orchB.shutdown();

    // Compare metrics
    const comparison = this.compareMetrics(resultsA, resultsB);

    // Calculate statistical significance
    let significance = null;
    if (resultsA.latencies.length > 1 && resultsB.latencies.length > 1) {
      significance = this.calculateSignificance(resultsA.latencies, resultsB.latencies);
    }

    return {
      configA: resultsA,
      configB: resultsB,
      comparison,
      significance,
      winner: comparison.winner
    };
  }

  /**
   * Run queries through orchestrator and collect metrics
   *
   * @param {SMORAOrchestrator} orchestrator - Initialized orchestrator
   * @param {string[]} queries - Queries to run
   * @param {Object} groundTruth - Optional ground truth
   * @returns {Promise<Object>} Results with metrics
   */
  async runQueries(orchestrator, queries, groundTruth) {
    const results = [];
    const latencies = [];
    const qualityScores = [];

    for (const query of queries) {
      try {
        const startTime = Date.now();
        const result = await orchestrator.retrieve(query);
        const latency = Date.now() - startTime;

        latencies.push(latency);
        results.push(result);

        // Calculate quality if ground truth provided
        if (groundTruth && groundTruth[query]) {
          const quality = this.calculateQuality(result, groundTruth[query]);
          qualityScores.push(quality);
        }
      } catch (error) {
        console.warn(`Query failed: ${query.substring(0, 50)}... - ${error.message}`);
      }
    }

    return {
      results,
      latencies,
      qualityScores,
      metrics: {
        avgLatency: this.mean(latencies),
        p50Latency: this.percentile(latencies, 50),
        p95Latency: this.percentile(latencies, 95),
        avgQuality: qualityScores.length > 0 ? this.mean(qualityScores) : null,
        queryCount: queries.length,
        successCount: results.length,
        failureCount: queries.length - results.length
      }
    };
  }

  /**
   * Compare metrics between two configurations
   *
   * @param {Object} resultsA - Results from config A
   * @param {Object} resultsB - Results from config B
   * @returns {Object} Comparison with winner
   */
  compareMetrics(resultsA, resultsB) {
    const metricsA = resultsA.metrics;
    const metricsB = resultsB.metrics;

    // Calculate improvements (positive = B is better)
    const latencyImprovement = ((metricsA.avgLatency - metricsB.avgLatency) / metricsA.avgLatency) * 100;

    const qualityImprovement = metricsA.avgQuality && metricsB.avgQuality
      ? ((metricsB.avgQuality - metricsA.avgQuality) / metricsA.avgQuality) * 100
      : null;

    // Determine winner based on quality first, then latency
    let winner = 'tie';

    if (qualityImprovement !== null) {
      if (qualityImprovement > 5) {
        winner = 'configB'; // 5% quality improvement threshold
      } else if (qualityImprovement < -5) {
        winner = 'configA';
      } else if (Math.abs(qualityImprovement) <= 5) {
        // Quality is similar, use latency as tiebreaker
        if (latencyImprovement > 10) {
          winner = 'configA'; // A is faster
        } else if (latencyImprovement < -10) {
          winner = 'configB'; // B is faster
        }
      }
    } else {
      // No quality data, use latency only
      if (latencyImprovement > 10) {
        winner = 'configA';
      } else if (latencyImprovement < -10) {
        winner = 'configB';
      }
    }

    return {
      latencyImprovement: `${latencyImprovement.toFixed(1)}%`,
      qualityImprovement: qualityImprovement ? `${qualityImprovement.toFixed(1)}%` : 'N/A',
      winner,
      details: {
        configA: metricsA,
        configB: metricsB
      }
    };
  }

  /**
   * Calculate statistical significance using t-test
   *
   * @param {number[]} metricsA - Metrics from config A
   * @param {number[]} metricsB - Metrics from config B
   * @returns {Object} Significance test results
   */
  calculateSignificance(metricsA, metricsB) {
    const meanA = this.mean(metricsA);
    const meanB = this.mean(metricsB);
    const stdA = this.stdDev(metricsA);
    const stdB = this.stdDev(metricsB);

    const n = Math.min(metricsA.length, metricsB.length);

    // Pooled standard deviation
    const pooledStd = Math.sqrt((stdA ** 2 + stdB ** 2) / 2);

    // Avoid division by zero
    if (pooledStd === 0) {
      return {
        tStat: 0,
        pValue: 1.0,
        significant: false
      };
    }

    // t-statistic
    const tStat = (meanB - meanA) / (pooledStd * Math.sqrt(2 / n));

    // Approximate p-value (simplified for small samples)
    // For more accurate results, use a proper t-distribution library
    const absTStat = Math.abs(tStat);
    let pValue;
    if (absTStat > 2.576) pValue = 0.01;       // 99% confidence
    else if (absTStat > 1.96) pValue = 0.05;   // 95% confidence
    else if (absTStat > 1.645) pValue = 0.10;  // 90% confidence
    else pValue = 0.20;                        // Not significant

    return {
      tStat,
      pValue,
      significant: pValue < this.significanceThreshold
    };
  }

  /**
   * Calculate quality score for a result vs ground truth
   *
   * @param {Object} result - Retrieval result
   * @param {Object} groundTruth - Ground truth data
   * @returns {number} Quality score (0-1)
   */
  calculateQuality(result, groundTruth) {
    // Extract result IDs (assuming result has chunks with IDs)
    const retrieved = new Set();
    if (result.chunks) {
      result.chunks.forEach(chunk => {
        if (chunk.id) retrieved.add(chunk.id);
      });
    }

    // Ground truth relevant IDs
    const relevant = new Set(groundTruth.relevantIds || []);

    if (relevant.size === 0) return 0;

    // Calculate precision and recall
    const intersection = new Set([...retrieved].filter(id => relevant.has(id)));

    const precision = retrieved.size > 0 ? intersection.size / retrieved.size : 0;
    const recall = intersection.size / relevant.size;

    // F0.5 score (favors precision slightly)
    const beta = 0.5;
    if (precision + recall === 0) return 0;

    return ((1 + beta ** 2) * precision * recall) / ((beta ** 2 * precision) + recall);
  }

  /**
   * Calculate mean of array
   *
   * @param {number[]} arr - Array of numbers
   * @returns {number} Mean
   */
  mean(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  /**
   * Calculate standard deviation
   *
   * @param {number[]} arr - Array of numbers
   * @returns {number} Standard deviation
   */
  stdDev(arr) {
    if (arr.length === 0) return 0;
    const avg = this.mean(arr);
    const squareDiffs = arr.map(val => (val - avg) ** 2);
    return Math.sqrt(this.mean(squareDiffs));
  }

  /**
   * Calculate percentile
   *
   * @param {number[]} arr - Array of numbers
   * @param {number} p - Percentile (0-100)
   * @returns {number} Value at percentile
   */
  percentile(arr, p) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Print formatted test results
   *
   * @param {Object} results - Test results from runTest()
   */
  printResults(results) {
    console.log('\n' + '='.repeat(60));
    console.log('📊 A/B Test Results');
    console.log('='.repeat(60));

    console.log('\n🔵 Config A (Baseline):');
    console.log(`  Avg Latency: ${results.configA.metrics.avgLatency.toFixed(1)}ms`);
    console.log(`  P95 Latency: ${results.configA.metrics.p95Latency.toFixed(1)}ms`);
    if (results.configA.metrics.avgQuality !== null) {
      console.log(`  Avg Quality: ${(results.configA.metrics.avgQuality * 100).toFixed(1)}%`);
    }

    console.log('\n🟢 Config B (Treatment):');
    console.log(`  Avg Latency: ${results.configB.metrics.avgLatency.toFixed(1)}ms`);
    console.log(`  P95 Latency: ${results.configB.metrics.p95Latency.toFixed(1)}ms`);
    if (results.configB.metrics.avgQuality !== null) {
      console.log(`  Avg Quality: ${(results.configB.metrics.avgQuality * 100).toFixed(1)}%`);
    }

    console.log('\n📈 Improvements:');
    console.log(`  Latency: ${results.comparison.latencyImprovement}`);
    console.log(`  Quality: ${results.comparison.qualityImprovement}`);

    if (results.significance) {
      console.log('\n📉 Statistical Significance:');
      console.log(`  t-statistic: ${results.significance.tStat.toFixed(3)}`);
      console.log(`  p-value: ${results.significance.pValue.toFixed(3)}`);
      console.log(`  Significant: ${results.significance.significant ? '✅ Yes' : '❌ No'}`);
    }

    console.log('\n🏆 Winner:', results.winner.toUpperCase());
    console.log('='.repeat(60) + '\n');
  }
}
