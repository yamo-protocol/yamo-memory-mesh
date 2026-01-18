/**
 * HyDE-Lite (Hypothetical Document Embeddings - Lite)
 *
 * A lightweight implementation of HyDE for small local models.
 * Generates hypothetical answers before embedding to improve retrieval quality.
 *
 * @module smora/query-understanding/hyde-lite
 */

import { LLMAdapter } from '../adapters/llm-adapter.js';
import { TemplateEngine } from './template-engine.js';
import { QualityValidator } from './quality-validator.js';

/**
 * Custom error class for HyDE-Lite operations
 */
export class HyDELiteError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'HyDELiteError';
    this.details = details;
  }
}

/**
 * HyDE-Lite: Query Understanding for Small Models
 *
 * Enhances queries by generating hypothetical answers before embedding.
 * Optimized for 7B-14B local models with quality validation and fallback.
 */
export class HyDELite {
  constructor(llmClient, embeddings, options = {}) {
    this.llmClient = llmClient;
    this.embeddings = embeddings;
    this.templateEngine = new TemplateEngine(options.templateConfig);
    this.qualityValidator = new QualityValidator(options.qualityConfig);

    this.config = {
      enabled: options.enabled !== false,
      maxRetries: options.maxRetries ?? 2,
      fallbackToQuery: options.fallbackToQuery !== false,
      cacheHypotheticals: options.cacheHypotheticals !== false,
      cacheSize: options.cacheSize ?? 100,
      model: options.model || null,
      ...options
    };

    // Simple LRU cache for hypotheticals
    this.cache = new Map();
    this.metrics = {
      totalQueries: 0,
      hydeGenerated: 0,
      fallbackToQuery: 0,
      cacheHits: 0,
      qualityScores: []
    };
  }

  /**
   * Initialize HyDE-Lite
   */
  async init() {
    if (this.llmClient && typeof this.llmClient.init === 'function') {
      await this.llmClient.init();
    }

    if (this.config.model) {
      this.templateEngine.setModel(this.config.model);
    }
  }

  /**
   * Enhance a query with HyDE
   *
   * @param {string} query - The user's query
   * @param {Object} options - Enhancement options
   * @returns {Promise<Object>} Enhanced query with metadata
   */
  async enhanceQuery(query, options = {}) {
    if (!this.config.enabled) {
      return this._fallbackResult(query, 'disabled');
    }

    this.metrics.totalQueries++;

    // Check cache
    const cacheKey = this._getCacheKey(query, options);
    if (this.config.cacheHypotheticals && this.cache.has(cacheKey)) {
      this.metrics.cacheHits++;
      const cached = this.cache.get(cacheKey);

      // Return cached result
      return {
        query,
        enhancedQuery: cached.hypothetical,
        embedding: cached.embedding,
        source: 'hyde',
        quality: 'cached',
        hypothetical: cached.hypothetical,
        templateType: options.templateType || this.templateEngine.selectTemplate(query),
        metadata: {
          cacheHit: true,
          generationAttempts: 0,
          fallbackReason: null
        }
      };
    }

    // Select template and generate hypothetical
    const templateType = options.templateType ||
                         this.templateEngine.selectTemplate(query, options.context);
    const template = this.templateEngine.getTemplate(templateType);

    // Generate with retry logic
    const result = await this._generateWithRetry(query, template, options);

    // Generate embedding
    const textToEmbed = result.fallback ? query : result.hypothetical;
    const embedding = await this._generateEmbedding(textToEmbed);

    const enhanced = {
      query,
      enhancedQuery: textToEmbed,
      embedding,
      source: result.fallback ? 'query' : 'hyde',
      quality: result.quality,
      hypothetical: result.fallback ? null : result.hypothetical,
      templateType,
      metadata: {
        cacheHit: false,
        generationAttempts: result.attempts,
        fallbackReason: result.fallbackReason
      }
    };

    // Update metrics
    if (result.fallback) {
      this.metrics.fallbackToQuery++;
    } else {
      this.metrics.hydeGenerated++;
      this.metrics.qualityScores.push(result.quality);

      // Cache successful generations
      if (this.config.cacheHypotheticals) {
        this._setCached(cacheKey, enhanced);
      }
    }

    return enhanced;
  }

  /**
   * Generate hypothetical answer with retry
   * @private
   */
  async _generateWithRetry(query, template, options, attempt = 0) {
    const maxAttempts = this.config.maxRetries + 1;

    try {
      // Build prompt
      const prompt = this.templateEngine.applyTemplate(template, query);

      // Generate hypothetical
      const hypothetical = await this.llmClient.generate(prompt, {
        maxTokens: template.maxTokens,
        temperature: template.temperature
      });

      // Clean the hypothetical
      const cleaned = this._cleanHypothetical(hypothetical, template);

      // Validate quality
      const validation = this.qualityValidator.validate(cleaned, query);

      if (!validation.isValid && attempt < maxAttempts - 1) {
        // Retry
        return await this._generateWithRetry(query, template, options, attempt + 1);
      }

      if (!validation.isValid) {
        // All retries exhausted, check fallback
        if (this.config.fallbackToQuery) {
          return {
            hypothetical: null,
            quality: 'low',
            fallback: true,
            fallbackReason: validation.reason,
            attempts: attempt + 1
          };
        }

        throw new HyDELiteError(
          `Failed to generate valid hypothetical after ${attempt + 1} attempts`,
          { query, templateType: template.name, reason: validation.reason }
        );
      }

      return {
        hypothetical: cleaned,
        quality: validation.quality,
        score: validation.score,
        fallback: false,
        attempts: attempt + 1
      };

    } catch (error) {
      if (attempt < maxAttempts - 1) {
        return await this._generateWithRetry(query, template, options, attempt + 1);
      }

      // All retries exhausted
      if (this.config.fallbackToQuery) {
        return {
          hypothetical: null,
          quality: 'error',
          fallback: true,
          fallbackReason: error.message,
          attempts: attempt + 1
        };
      }

      throw new HyDELiteError(
        `HyDE generation failed: ${error.message}`,
        { query, templateType: template.name, error }
      );
    }
  }

  /**
   * Clean hypothetical answer
   * @private
   */
  _cleanHypothetical(hypothetical, template) {
    // Handle object return from OpenAI/ZAI adapters
    let text = typeof hypothetical === 'object' ? hypothetical.text : hypothetical;
    let cleaned = text.trim();

    // Remove common prefixes that models add
    const prefixesToRemove = [
      /^(Here's|Here is|I think|Based on|The answer is:?)\s*/i,
      /^(The answer is:?)\s*/i,
      /^(According to|In response to)\s*/i
    ];

    for (const prefix of prefixesToRemove) {
      cleaned = cleaned.replace(prefix, '');
    }

    // Normalize whitespace
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // Truncate to max length
    if (cleaned.length > template.maxLength) {
      cleaned = cleaned.substring(0, template.maxLength);
      // Truncate at last complete sentence
      const lastPeriod = cleaned.lastIndexOf('.');
      const lastNewline = cleaned.lastIndexOf('\n');
      const breakPoint = Math.max(lastPeriod, lastNewline);

      if (breakPoint > cleaned.length * 0.8) {
        cleaned = cleaned.substring(0, breakPoint + 1);
      }
    }

    return cleaned.trim();
  }

  /**
   * Generate embedding
   * @private
   */
  async _generateEmbedding(text) {
    if (this.embeddings && typeof this.embeddings.embed === 'function') {
      return await this.embeddings.embed(text);
    }

    throw new HyDELiteError('Embeddings not configured');
  }

  /**
   * Create fallback result
   * @private
   */
  async _fallbackResult(query, reason) {
    const embedding = await this._generateEmbedding(query);

    return {
      query,
      enhancedQuery: query,
      embedding,
      source: 'query',
      quality: 'bypassed',
      hypothetical: null,
      templateType: null,
      metadata: {
        cacheHit: false,
        fallbackReason: reason
      }
    };
  }

  /**
   * Get cache key
   * @private
   */
  _getCacheKey(query, options) {
    const templateType = options.templateType || 'auto';
    return `hyde:${query}:${templateType}`;
  }

  /**
   * Set cached value
   * @private
   */
  _setCached(key, value) {
    // Simple LRU cache
    if (this.cache.size >= this.config.cacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, {
      hypothetical: value.hypothetical,
      embedding: value.embedding,
      timestamp: Date.now()
    });
  }

  /**
   * Process query (alias for enhanceQuery for orchestrator compatibility)
   *
   * @param {string} query - Query to process
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Enhanced query result
   */
  async process(query, options = {}) {
    return this.enhanceQuery(query, options);
  }

  /**
   * Get performance metrics
   */
  getMetrics() {
    const avgQuality = this.metrics.qualityScores.length > 0
      ? this.metrics.qualityScores.reduce((a, b) =>
          a + (b === 'high' ? 3 : b === 'good' ? 2 : b === 'medium' ? 1 : 0), 0) /
        this.metrics.qualityScores.length
      : 0;

    return {
      ...this.metrics,
      cacheSize: this.cache.size,
      hydeSuccessRate: this.metrics.totalQueries > 0
        ? this.metrics.hydeGenerated / this.metrics.totalQueries
        : 0,
      fallbackRate: this.metrics.totalQueries > 0
        ? this.metrics.fallbackToQuery / this.metrics.totalQueries
        : 0,
      cacheHitRate: this.metrics.totalQueries > 0
        ? this.metrics.cacheHits / this.metrics.totalQueries
        : 0,
      averageQuality: avgQuality
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      totalQueries: 0,
      hydeGenerated: 0,
      fallbackToQuery: 0,
      cacheHits: 0,
      qualityScores: []
    };
    this.qualityValidator.resetMetrics();
  }

  /**
   * Update configuration
   */
  updateConfig(options) {
    Object.assign(this.config, options);

    if (options.qualityConfig) {
      this.qualityValidator.updateConfig(options.qualityConfig);
    }
  }
}

/**
 * Create a HyDE-Lite instance with auto-detection
 */
export async function createHyDELite(embeddings, options = {}) {
  // Create LLM adapter if not provided
  let llmClient = options.llmClient;

  if (!llmClient) {
    const { createLLMAdapter } = await import('../adapters/llm-adapter.js');
    llmClient = await createLLMAdapter({
      provider: options.llmProvider,
      model: options.llmModel
    });
  }

  const hydeLite = new HyDELite(llmClient, embeddings, options);
  await hydeLite.init();

  return hydeLite;
}

export default HyDELite;
