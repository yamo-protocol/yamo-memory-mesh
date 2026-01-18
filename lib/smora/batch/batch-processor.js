/**
 * S-MORA Batch Processor
 * Processes multiple queries in parallel with configurable concurrency
 * @module smora/batch/batch-processor
 */

/**
 * Batch Processor for parallel query execution
 */
export class BatchProcessor {
  /**
   * @param {Object} orchestrator - S-MORA Orchestrator instance
   * @param {Object} options - Configuration options
   * @param {number} options.concurrency - Max parallel queries (default: 10)
   */
  constructor(orchestrator, options = {}) {
    this.orchestrator = orchestrator;
    this.concurrency = options.concurrency || 10;

    // Statistics
    this.stats = {
      totalProcessed: 0,
      totalBatches: 0,
      totalLatency: 0,
      errors: 0
    };
  }

  /**
   * Process multiple queries in parallel batches
   *
   * @param {Array<string>} queries - Array of queries to process
   * @param {Object} options - Processing options
   * @param {Function} options.onProgress - Progress callback (completed, total)
   * @returns {Promise<Array>} Array of results
   */
  async process(queries, options = {}) {
    if (queries.length === 0) {
      return [];
    }

    const { onProgress } = options;
    const results = new Array(queries.length);
    let completed = 0;

    // Process in batches to respect concurrency limit
    for (let i = 0; i < queries.length; i += this.concurrency) {
      const batch = queries.slice(i, i + this.concurrency);
      const batchStartIndex = i;

      // Process batch in parallel
      const batchResults = await Promise.all(
        batch.map(async (query, batchIndex) => {
          const globalIndex = batchStartIndex + batchIndex;
          const start = Date.now();

          try {
            const result = await this.orchestrator.retrieve(query);
            const latency = Date.now() - start;

            this.stats.totalProcessed++;
            this.stats.totalLatency += latency;

            completed++;

            // Call progress callback if provided
            if (onProgress) {
              onProgress(completed, queries.length);
            }

            return { index: globalIndex, result, error: null };
          } catch (error) {
            this.stats.totalProcessed++;
            this.stats.errors++;

            completed++;

            // Call progress callback if provided (even for errors)
            if (onProgress) {
              onProgress(completed, queries.length);
            }

            return {
              index: globalIndex,
              result: {
                query,
                context: null,
                chunks: [],
                metadata: { error: error.message },
                success: false
              },
              error: error.message
            };
          }
        })
      );

      // Place results in correct order
      for (const { index, result, error } of batchResults) {
        results[index] = error ? { ...result, error, success: false } : result;
      }

      this.stats.totalBatches++;
    }

    return results;
  }

  /**
   * Get batch processor statistics
   *
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      totalProcessed: this.stats.totalProcessed,
      totalBatches: this.stats.totalBatches,
      errors: this.stats.errors,
      avgLatency: this.stats.totalProcessed > 0
        ? this.stats.totalLatency / this.stats.totalProcessed
        : 0
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalProcessed: 0,
      totalBatches: 0,
      totalLatency: 0,
      errors: 0
    };
  }
}
