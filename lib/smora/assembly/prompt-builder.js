/**
 * S-MORA Context Assembler
 *
 * Assembles retrieved context into structured, auditable format
 * optimized for small model consumption.
 *
 * @module smora/assembly/prompt-builder
 */

/**
 * Context Assembler for Structured Prompt Building
 *
 * Orchestrates the assembly of query, hypothetical answers,
 * summaries, and evidence into optimized prompts.
 */
export class ContextAssembler {
  constructor(options = {}) {
    this.config = {
      maxContextLength: options.maxContextLength || 4096,
      structure: options.structure || 'structured',
      includeCitations: options.includeCitations !== false,
      includeHypothetical: options.includeHypothetical !== false,
      includeSummary: options.includeSummary !== false,
      instructionTemplate: options.instructionTemplate || 'default',
      compressionMarker: options.compressionMarker || '[...]',
      ...options
    };

    this.instructionTemplates = {
      default: `Answer the user's question using only the information provided in the context below. If the context doesn't contain enough information to answer the question, say so.`,
      concise: `Using the provided context, give a brief and direct answer.`,
      analytical: `Analyze the provided context to answer the question. Support your answer with specific evidence.`,
      creative: `Using the provided context as inspiration, craft a response.`,
      none: ''
    };

    this.metrics = {
      contextsBuilt: 0,
      totalTokens: 0,
      avgTokenUsage: 0,
      truncations: 0
    };
  }

  /**
   * Build structured context from retrieval results
   *
   * @param {Object} params - Build parameters
   * @returns {Promise<Object>} Assembled context
   */
  async build(params) {
    const {
      query,
      chunks = [],
      hypotheticalAnswer = null,
      maxTokens = this.config.maxContextLength,
      summary = null
    } = params;

    // Build sections
    const sections = {
      query: this._formatQuery(query),
      hypothetical: this.config.includeHypothetical && hypotheticalAnswer
        ? this._formatHypothetical(hypotheticalAnswer)
        : null,
      summary: this.config.includeSummary && summary
        ? this._formatSummary(summary)
        : this._extractSummaryFromChunks(chunks),
      evidence: this._formatEvidence(chunks),
      instructions: this._formatInstructions()
    };

    // Assemble based on structure type
    const assembled = this._assembleStructured(sections);

    // Optimize for token limit
    const optimized = this._optimizeTokens(assembled, maxTokens);

    // Update metrics
    this.metrics.contextsBuilt++;
    this.metrics.totalTokens += optimized.tokenCount;
    this.metrics.avgTokenUsage = this.metrics.totalTokens / this.metrics.contextsBuilt;
    if (optimized.wasTruncated) {
      this.metrics.truncations++;
    }

    return {
      formattedContext: optimized.text,
      tokenCount: optimized.tokenCount,
      sections,
      structure: this.config.structure,
      wasTruncated: optimized.wasTruncated,
      originalLength: optimized.originalLength
    };
  }

  /**
   * Format query section
   *
   * @private
   * @param {string} query - User query
   * @returns {string} Formatted query
   */
  _formatQuery(query) {
    return query.trim();
  }

  /**
   * Format hypothetical answer section
   *
   * @private
   * @param {string} hypothetical - Hypothetical answer
   * @returns {string} Formatted hypothetical
   */
  _formatHypothetical(hypothetical) {
    return hypothetical.trim();
  }

  /**
   * Format summary section
   *
   * @private
   * @param {string} summary - Summary text
   * @returns {string} Formatted summary
   */
  _formatSummary(summary) {
    if (!summary) return '';
    return summary.trim();
  }

  /**
   * Extract summary from chunks if available
   *
   * @private
   * @param {Array} chunks - Retrieved chunks
   * @returns {string|null} Extracted summary
   */
  _extractSummaryFromChunks(chunks) {
    if (!chunks || chunks.length === 0) return null;

    // Look for summary chunks (higher level in tree)
    const summaryChunks = chunks.filter(c => c.isSummary || c.chunkType !== 'chunk');

    if (summaryChunks.length > 0) {
      // Combine multiple summaries
      return summaryChunks
        .map(c => c.content || c.text)
        .join('\n\n');
    }

    return null;
  }

  /**
   * Format evidence section
   *
   * @private
   * @param {Array} chunks - Evidence chunks
   * @returns {string} Formatted evidence
   */
  _formatEvidence(chunks) {
    if (!chunks || chunks.length === 0) return '[SUPPORTING EVIDENCE]\nNo evidence available.';

    // Separate summaries from actual chunks
    const summaries = chunks.filter(c => c.isSummary || c.chunkType !== 'chunk');
    const evidenceChunks = chunks.filter(c => !c.isSummary && c.chunkType === 'chunk');

    let evidence = '';

    if (summaries.length > 0) {
      evidence += '[SUMMARIES]\n';
      evidence += summaries
        .map((s, i) => `${i + 1}. ${s.content || s.text}${this.config.includeCitations && s.source ? ` (Source: ${s.source})` : ''}`)
        .join('\n');
      evidence += '\n\n';
    }

    evidence += '[SUPPORTING EVIDENCE]\n';
    if (evidenceChunks.length === 0) {
      evidence += 'No evidence available.';
    } else {
      evidence += evidenceChunks
        .map((c, i) => {
          const citation = this.config.includeCitations && c.source ? ` [Source: ${c.source}]` : '';
          const content = c.content || c.text || '';
          return `${i + 1}. ${content}${citation}`;
        })
        .join('\n\n');
    }

    return evidence.trim();
  }

  /**
   * Format instructions section
   *
   * @private
   * @returns {string} Formatted instructions
   */
  _formatInstructions() {
    const template = this.instructionTemplates[this.config.instructionTemplate] ||
                      this.instructionTemplates.default;

    if (this.config.instructionTemplate === 'none') {
      return '';
    }

    return template.trim();
  }

  /**
   * Assemble structured context
   *
   * @private
   * @param {Object} sections - All sections
   * @returns {string} Assembled context
   */
  _assembleStructured(sections) {
    const parts = [];

    // Query section (always first)
    if (sections.query) {
      parts.push('[QUERY]\n' + sections.query);
    }

    // Hypothetical answer (optional)
    if (sections.hypothetical) {
      parts.push('\n[HYPOTHETICAL ANSWER]\n' + sections.hypothetical);
    }

    // Summary section (optional)
    if (sections.summary) {
      parts.push('\n[SUMMARY]\n' + sections.summary);
    }

    // Evidence section (always included, may be empty)
    if (sections.evidence) {
      parts.push('\n' + sections.evidence);
    }

    // Instructions section (always last)
    if (sections.instructions) {
      parts.push('\n[INSTRUCTIONS]\n' + sections.instructions);
    }

    return parts.join('\n');
  }

  /**
   * Assemble compact context (no section headers)
   *
   * @private
   * @param {Object} sections - All sections
   * @returns {string} Assembled context
   */
  _assembleCompact(sections) {
    const parts = [];

    parts.push('Question: ' + sections.query);

    if (sections.hypothetical) {
      parts.push('\n\n' + sections.hypothetical);
    }

    if (sections.summary) {
      parts.push('\n\nSummary: ' + sections.summary);
    }

    if (sections.evidence) {
      parts.push('\n\n' + sections.evidence);
    }

    if (sections.instructions) {
      parts.push('\n\n' + sections.instructions);
    }

    return parts.join('');
  }

  /**
   * Optimize context for token budget
   *
   * @private
   * @param {string} text - Full context text
   * @param {number} maxTokens - Maximum tokens
   * @returns {Object} Optimized context
   */
  _optimizeTokens(text, maxTokens) {
    const currentTokens = this._estimateTokens(text);

    if (currentTokens <= maxTokens) {
      return {
        text,
        tokenCount: currentTokens,
        wasTruncated: false,
        originalLength: text.length
      };
    }

    // Need to truncate - prioritize sections
    const lines = text.split('\n');
    const evidenceStart = this._findSectionStart(lines, '[SUPPORTING EVIDENCE]');
    const instructionsStart = this._findSectionStart(lines, '[INSTRUCTIONS]');

    // Keep everything before evidence, plus instructions
    const keepLines = [];
    let currentSection = 'before';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Track current section
      if (line === '[SUPPORTING EVIDENCE]') {
        currentSection = 'evidence';
        continue;
      } else if (line === '[INSTRUCTIONS]') {
        currentSection = 'instructions';
        keepLines.push(line); // Always keep instructions header
        continue;
      }

      // Skip evidence content if needed
      if (currentSection === 'evidence' && this._shouldSkipForBudget(currentTokens, maxTokens, keepLines)) {
        if (i === evidenceStart + 1) {
          // First truncated line - add marker
          keepLines.push(this.config.compressionMarker);
        }
        continue;
      }

      keepLines.push(line);
    }

    const optimized = keepLines.join('\n');
    return {
      text: optimized,
      tokenCount: this._estimateTokens(optimized),
      wasTruncated: true,
      originalLength: text.length
    };
  }

  /**
   * Find section start line index
   *
   * @private
   * @param {Array} lines - All lines
   * @param {string} sectionName - Section header to find
   * @returns {number} Line index or -1
   */
  _findSectionStart(lines, sectionName) {
    return lines.findIndex(l => l === sectionName);
  }

  /**
   * Determine if we should skip content for budget
   *
   * @private
   * @param {number} currentTokens - Current token count
   * @param {number} maxTokens - Maximum tokens
   * @param {Array} keepLines - Lines we're keeping
   * @returns {boolean} Whether to skip
   */
  _shouldSkipForBudget(currentTokens, maxTokens, keepLines) {
    const estimatedCurrent = this._estimateTokens(keepLines.join('\n'));
    return estimatedCurrent >= maxTokens * 0.9; // Stop at 90% of budget
  }

  /**
   * Estimate token count for text
   *
   * @private
   * @param {string} text - Text to measure
   * @returns {number} Estimated tokens
   */
  _estimateTokens(text) {
    if (!text) return 0;
    // Rough estimate: 1 token per 4 characters
    return Math.ceil(text.length / 4);
  }

  /**
   * Build context without structure (natural format)
   *
   * @param {Object} params - Build parameters
   * @returns {Promise<Object>} Assembled context
   */
  async buildNatural(params) {
    const { query, chunks = [], hypotheticalAnswer = null } = params;

    const parts = [];

    parts.push('Question: ' + query);

    if (hypotheticalAnswer) {
      parts.push('\n\n' + hypotheticalAnswer);
    }

    if (chunks && chunks.length > 0) {
      parts.push('\n\nRelevant information:\n');

      const content = chunks
        .map((c, i) => {
          const source = c.source ? ` (from ${c.source})` : '';
          return `- ${c.content || c.text}${source}`;
        })
        .join('\n');

      parts.push(content);
    }

    const text = parts.join('');

    return {
      formattedContext: text,
      tokenCount: this._estimateTokens(text),
      structure: 'natural',
      wasTruncated: false
    };
  }

  /**
   * Get assembler metrics
   *
   * @returns {Object} Metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      config: {
        maxContextLength: this.config.maxContextLength,
        structure: this.config.structure,
        includeCitations: this.config.includeCitations
      }
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      contextsBuilt: 0,
      totalTokens: 0,
      avgTokenUsage: 0,
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
 * Custom error class for context assembler operations
 */
export class ContextAssemblerError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ContextAssemblerError';
    this.details = details;
  }
}

export default ContextAssembler;
