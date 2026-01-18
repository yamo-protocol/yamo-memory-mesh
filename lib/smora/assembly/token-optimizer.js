/**
 * S-MORA Token Optimizer
 *
 * Manages token budget and optimizes context
 * for small model context windows.
 *
 * @module smora/assembly/token-optimizer
 */

/**
 * Token Optimizer for Budget Management
 *
 * Ensures context fits within model's context window
 * while maximizing information density.
 */
export class TokenOptimizer {
  constructor(options = {}) {
    this.config = {
      maxTokens: options.maxTokens || 4096,
      reservedTokens: options.reservedTokens || 512,
      safetyMargin: options.safetyMargin || 100,
      targetUtilization: options.targetUtilization || 0.95,
      compressionMarker: options.compressionMarker || ' [...]',
      ...options
    };

    this.metrics = {
      optimized: 0,
      totalSaved: 0,
      avgCompression: 0,
      truncations: 0
    };
  }

  /**
   * Optimize context to fit token budget
   *
   * @param {string} context - Full context text
   * @param {Object} options - Optimization options
   * @returns {Object} Optimized context with metadata
   */
  optimize(context, options = {}) {
    const {
      maxTokens = this.config.maxTokens,
      preserveStructure = true,
      priority = ['instructions', 'summary', 'query', 'evidence']
    } = options;

    const effectiveBudget = maxTokens - this.config.reservedTokens - this.config.safetyMargin;
    const currentTokens = this._estimateTokens(context);

    if (currentTokens <= effectiveBudget) {
      return {
        optimizedContext: context,
        tokenCount: currentTokens,
        wasCompressed: false,
        wasTruncated: false,
        utilization: currentTokens / maxTokens
      };
    }

    // Need to compress/truncate
    const optimized = this._compressByPriority(context, effectiveBudget, preserveStructure, priority);

    // Update metrics
    this.metrics.optimized++;
    this.metrics.totalSaved += currentTokens - optimized.tokenCount;
    this.metrics.avgCompression = this.metrics.totalSaved / this.metrics.optimized;
    if (optimized.wasTruncated) {
      this.metrics.truncations++;
    }

    return optimized;
  }

  /**
   * Compress context by priority sections
   *
   * @private
   * @param {string} context - Full context
   * @param {number} budget - Token budget
   * @param {boolean} preserveStructure - Keep section headers
   * @param {Array} priority - Section priority order
   * @returns {Object} Compressed context
   */
  _compressByPriority(context, budget, preserveStructure, priority) {
    const lines = context.split('\n');
    const sections = this._identifySections(lines);

    // Build compressed context based on priority
    const compressedLines = [];
    let currentTokens = 0;

    for (const sectionName of priority) {
      if (!sections[sectionName] || sections[sectionName].length === 0) continue;

      const section = sections[sectionName];
      const headerLine = section.startLine;

      // Add section header if preserving structure
      if (preserveStructure && headerLine >= 0) {
        const headerText = lines[headerLine];
        const headerTokens = this._estimateTokens(headerText + '\n');

        if (currentTokens + headerTokens > budget) {
          break; // Budget exhausted
        }

        compressedLines.push(headerText);
        currentTokens += headerTokens;
      }

      // Add section content (may truncate)
      const contentStart = preserveStructure ? section.startLine + 1 : section.startLine;
      const contentEnd = section.endLine;

      for (let i = contentStart; i <= contentEnd; i++) {
        const line = lines[i];
        const lineTokens = this._estimateTokens(line + '\n');

        if (currentTokens + lineTokens > budget) {
          // Add truncation marker and stop
          if (sectionName === 'evidence' && preserveStructure) {
            compressedLines.push(this.config.compressionMarker);
          }
          break;
        }

        compressedLines.push(line);
        currentTokens += lineTokens;
      }

      if (currentTokens >= budget * this.config.targetUtilization) {
        break; // Good enough utilization
      }
    }

    const compressed = compressedLines.join('\n');

    return {
      optimizedContext: compressed,
      tokenCount: currentTokens,
      wasCompressed: true,
      wasTruncated: true,
      utilization: currentTokens / budget
    };
  }

  /**
   * Identify sections in context
   *
   * @private
   * @param {Array} lines - Context lines
   * @returns {Object} Section boundaries
   */
  _identifySections(lines) {
    const sections = {
      query: { startLine: -1, endLine: -1 },
      hypothetical: { startLine: -1, endLine: -1 },
      summary: { startLine: -1, endLine: -1 },
      evidence: { startLine: -1, endLine: -1 },
      instructions: { startLine: -1, endLine: -1 }
    };

    let currentSection = null;
    const sectionHeaders = {
      '[QUERY]': 'query',
      '[HYPOTHETICAL ANSWER]': 'hypothetical',
      '[SUMMARY]': 'summary',
      '[SUPPORTING EVIDENCE]': 'evidence',
      '[INSTRUCTIONS]': 'instructions',
      '[SUMMARIES]': 'summary'
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Check for section header
      if (sectionHeaders[line]) {
        currentSection = sectionHeaders[line];
        sections[currentSection].startLine = i;
      } else if (currentSection && sections[currentSection].startLine >= 0) {
        // Continue current section
        sections[currentSection].endLine = i;
      }
    }

    // Ensure end lines are set
    for (const sectionName of Object.keys(sections)) {
      if (sections[sectionName].startLine >= 0 && sections[sectionName].endLine === -1) {
        sections[sectionName].endLine = lines.length - 1;
      }
    }

    return sections;
  }

  /**
   * Estimate token count
   *
   * @private
   * @param {string} text - Text to measure
   * @returns {number} Estimated tokens
   */
  _estimateTokens(text) {
    if (!text) return 0;
    // Rough estimate: 1 token per 4 characters
    // More accurate would use tiktoken, but this is sufficient for budgeting
    return Math.ceil(text.length / 4);
  }

  /**
   * Calculate optimal chunk size for retrieval
   *
   * @param {number} totalContextBudget - Total budget for context
   * @param {number} resultCount - Number of results to include
   * @returns {Object} Optimal chunk configuration
   */
  calculateOptimalChunkSize(totalContextBudget, resultCount = 10) {
    // Reserve space for query, instructions, etc.
    const availableForResults = totalContextBudget -
      this.config.reservedTokens -
      this.config.safetyMargin -
      500; // Rough overhead for structure

    const perChunkBudget = Math.floor(availableForResults / resultCount);

    return {
      optimalChunkSize: perChunkBudget,
      maxResults: resultCount,
      recommendedStrategy: this._selectStrategy(perChunkBudget, resultCount)
    };
  }

  /**
   * Select compression strategy based on budget
   *
   * @private
   * @param {number} perChunkBudget - Budget per chunk
   * @param {number} resultCount - Number of results
   * @returns {string} Strategy name
   */
  _selectStrategy(perChunkBudget, resultCount) {
    if (perChunkBudget < 100) {
      return 'summaries-only';
    } else if (perChunkBudget < 300) {
      return 'summaries-preferred';
    } else if (perChunkBudget < 500) {
      return 'balanced';
    } else {
      return 'full-chunks';
    }
  }

  /**
   * Truncate evidence section intelligently
   *
   * @param {Array} evidenceItems - Evidence items
   * @param {number} maxTokens - Maximum tokens
   * @returns {Array} Truncated evidence
   */
  truncateEvidence(evidenceItems, maxTokens) {
    const truncated = [];
    let currentTokens = 0;

    for (const item of evidenceItems) {
      const itemTokens = this._estimateTokens(item);

      if (currentTokens + itemTokens > maxTokens * 0.9) {
        break;
      }

      truncated.push(item);
      currentTokens += itemTokens;
    }

    return truncated;
  }

  /**
   * Optimize multiple chunks together
   *
   * @param {Array} chunks - Content chunks
   * @param {Object} options - Optimization options
   * @returns {Object} Optimized chunks
   */
  optimizeChunks(chunks, options = {}) {
    const {
      maxTokens = this.config.maxTokens,
      strategy = 'balanced',
      preserveFirstN = 3
    } = options;

    if (strategy === 'summaries-only') {
      // Keep only summary chunks
      return {
        optimizedChunks: chunks.filter(c => c.isSummary || c.chunkType !== 'chunk'),
        method: 'summaries-only',
        tokenCount: this._estimateTokens(
          chunks.filter(c => c.isSummary).map(c => c.content || c.text).join('\n\n')
        )
      };
    } else if (strategy === 'summaries-preferred') {
      // Prioritize summaries, then add chunks as space allows
      const summaries = chunks.filter(c => c.isSummary || c.chunkType !== 'chunk');
      const regularChunks = chunks.filter(c => !c.isSummary && c.chunkType === 'chunk');

      let optimized = [...summaries];
      let currentTokens = this._estimateTokens(
        optimized.map(c => c.content || c.text).join('\n\n')
      );

      // Add regular chunks until budget
      for (const chunk of regularChunks) {
        const chunkTokens = this._estimateTokens(chunk.content || chunk.text);

        if (currentTokens + chunkTokens > maxTokens) {
          break;
        }

        optimized.push(chunk);
        currentTokens += chunkTokens;
      }

      return {
        optimizedChunks: optimized,
        method: 'summaries-preferred',
        tokenCount: currentTokens
      };
    } else if (strategy === 'balanced') {
      // Keep first N chunks (preserveFirstN) plus all summaries
      const summaries = chunks.filter(c => c.isSummary || c.chunkType !== 'chunk');
      const regularChunks = chunks.filter(c => !c.isSummary && c.chunkType === 'chunk');
      const priorityChunks = regularChunks.slice(0, preserveFirstN);

      const optimized = [...summaries, ...priorityChunks];

      return {
        optimizedChunks: optimized,
        method: 'balanced',
        tokenCount: this._estimateTokens(
          optimized.map(c => c.content || c.text).join('\n\n')
        )
      };
    } else {
      // Full chunks (no optimization)
      return {
        optimizedChunks: chunks,
        method: 'full-chunks',
        tokenCount: this._estimateTokens(
          chunks.map(c => c.content || c.text).join('\n\n')
        )
      };
    }
  }

  /**
   * Get optimizer metrics
   *
   * @returns {Object} Metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      config: {
        maxTokens: this.config.maxTokens,
        reservedTokens: this.config.reservedTokens,
        safetyMargin: this.config.safetyMargin,
        targetUtilization: this.config.targetUtilization
      }
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      optimized: 0,
      totalSaved: 0,
      avgCompression: 0,
      truncations: 0
    };
  }

  /**
   * Update configuration
   *
   * @param {Object} options - New configuration options
   */
  updateConfig(options) {
    Object.assign(this.config, options);
  }
}

/**
 * Custom error class for token optimizer operations
 */
export class TokenOptimizerError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'TokenOptimizerError';
    this.details = details;
  }
}

export default TokenOptimizer;
