/**
 * EmbeddingFactory - Multi-provider embedding with automatic fallback
 * Manages primary and fallback embedding services
 */

import EmbeddingService from "./service.js";
import { ConfigurationError, EmbeddingError } from "../lancedb/errors.js";

class EmbeddingFactory {
  constructor() {
    this.primaryService = null;
    this.fallbackServices = [];
    this.configured = false;
  }

  /**
   * Configure embedding services with fallback chain
   * @param {Array} configs - Array of { modelType, modelName, priority, apiKey }
   * @returns {Object} Success status
   */
  configure(configs) {
    // Sort by priority (lower = higher priority)
    configs.sort((a, b) => a.priority - b.priority);

    this.primaryService = new EmbeddingService(configs[0]);

    if (configs.length > 1) {
      this.fallbackServices = configs.slice(1).map(c => new EmbeddingService(c));
    }

    this.configured = true;
    return { success: true };
  }

  /**
   * Initialize all configured services
   * @returns {Promise<Object>} Initialization status
   */
  async init() {
    if (!this.configured) {
      throw new ConfigurationError('EmbeddingFactory not configured. Call configure() first.');
    }

    // Initialize primary service
    if (this.primaryService && !this.primaryService.initialized) {
      await this.primaryService.init();
    }

    // Initialize fallback services lazily (on first use)
    return {
      success: true,
      primary: this.primaryService ? this.primaryService.modelName : null,
      fallbacks: this.fallbackServices.map(s => s.modelName)
    };
  }

  /**
   * Generate embedding with automatic fallback
   * @param {string} text - Text to embed
   * @param {Object} options - Options
   * @returns {Promise<number[]>} Embedding vector
   */
  async embed(text, options = {}) {
    if (!this.configured || !this.primaryService) {
      throw new ConfigurationError('EmbeddingFactory not configured');
    }

    // Try primary service
    try {
      if (!this.primaryService.initialized) {
        await this.primaryService.init();
      }
      return await this.primaryService.embed(text, options);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`[EmbeddingFactory] Primary service failed: ${errorMessage}`);

      // Try fallback services in order
      for (const fallback of this.fallbackServices) {
        try {
          if (!fallback.initialized) {
            await fallback.init();
          }
          console.log(`[EmbeddingFactory] Using fallback: ${fallback.modelName}`);
          return await fallback.embed(text, options);
        } catch (fallbackError) {
          const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          console.warn(`[EmbeddingFactory] Fallback ${fallback.modelName} failed: ${fallbackErrorMessage}`);
        }
      }

      throw new EmbeddingError('All embedding services failed', {
        primaryError: errorMessage,
        fallbackCount: this.fallbackServices.length
      });
    }
  }

  /**
   * Generate embeddings for batch of texts
   * @param {string[]} texts - Texts to embed
   * @param {Object} options - Options
   * @returns {Promise<number[][]>} Array of embedding vectors
   */
  async embedBatch(texts, options = {}) {
    if (!this.configured || !this.primaryService) {
      throw new ConfigurationError('EmbeddingFactory not configured');
    }

    // Try primary service
    try {
      if (!this.primaryService.initialized) {
        await this.primaryService.init();
      }
      return await this.primaryService.embedBatch(texts, options);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`[EmbeddingFactory] Primary batch failed: ${errorMessage}`);
      // Fallback to individual embedding with fallback services
      const results = [];
      for (const text of texts) {
        results.push(await this.embed(text, options));
      }
      return results;
    }
  }

  /**
   * Get factory statistics
   * @returns {Object} Statistics
   */
  getStats() {
    const stats = {
      configured: this.configured,
      primary: this.primaryService?.getStats() || null,
      fallbacks: this.fallbackServices.map(s => s.getStats())
    };
    return stats;
  }

  /**
   * Clear all caches
   */
  clearCache() {
    this.primaryService?.clearCache();
    this.fallbackServices.forEach(s => s.clearCache());
  }
}

export default EmbeddingFactory;
