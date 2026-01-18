/**
 * Embedding Adapter for S-MORA
 *
 * Provides a unified interface to embedding services
 *
 * @module smora/adapters/embedding-adapter
 */

/**
 * Embedding Adapter
 */
export class EmbeddingAdapter {
  constructor(config = {}) {
    this.config = {
      provider: config.provider || 'local',
      model: config.model || 'Xenova/all-MiniLM-L6-v2',
      dimensions: config.dimensions || 384
    };
    this.initialized = false;
  }

  /**
   * Initialize the adapter
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // Use existing YAMO EmbeddingFactory
      const { default: EmbeddingFactory } = await import('../../embeddings/factory.js');
      this.factory = new EmbeddingFactory();

      // Configure based on provider
      const configs = [];
      if (this.config.provider === 'local' || this.config.provider === 'ollama') {
        configs.push({
          modelType: 'local',
          modelName: this.config.model || 'Xenova/all-MiniLM-L6-v2',
          priority: 1
        });
      } else if (this.config.provider === 'openai') {
        configs.push({
          modelType: 'openai',
          modelName: this.config.model || 'text-embedding-3-small',
          priority: 1
        });
      }

      this.factory.configure(configs);
      await this.factory.init();

      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize embedding service: ${error.message}`);
    }
  }

  /**
   * Generate embedding for text
   *
   * @param {string} text - Text to embed
   * @returns {Promise<Array<number>>} Embedding vector
   */
  async embed(text) {
    await this.initialize();
    return await this.factory.embed(text);
  }

  /**
   * Generate embeddings for multiple texts
   *
   * @param {Array<string>} texts - Texts to embed
   * @returns {Promise<Array<Array<number>>>} Embedding vectors
   */
  async embedBatch(texts) {
    await this.initialize();
    return Promise.all(texts.map(text => this.embed(text)));
  }

  /**
   * Embed using Ollama
   *
   * @private
   * @param {string} text - Text to embed
   * @returns {Promise<Array<number>>} Embedding vector
   */
  async _embedOllama(text) {
    try {
      // Try to use existing embedding service
      const { EmbeddingService } = await import('../../embeddings/service.js');
      const service = new EmbeddingService();
      return await service.embed(text);
    } catch (error) {
      throw new Error(`Ollama embedding failed: ${error.message}`);
    }
  }

  /**
   * Embed using OpenAI
   *
   * @private
   * @param {string} text - Text to embed
   * @returns {Promise<Array<number>>} Embedding vector
   */
  async _embedOpenAI(text) {
    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: this.config.model,
          input: text
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data[0].embedding;
    } catch (error) {
      throw new Error(`OpenAI embedding failed: ${error.message}`);
    }
  }

  /**
   * Health check
   *
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    try {
      await this.initialize();
      const testEmbedding = await this.embed('test');
      return {
        status: 'healthy',
        provider: this.config.provider,
        model: this.config.model,
        dimensions: testEmbedding.length
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        provider: this.config.provider,
        error: error.message
      };
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    this.initialized = false;
  }
}

/**
 * Create an embedding adapter instance
 *
 * @param {Object} config - Configuration
 * @returns {EmbeddingAdapter} Adapter instance
 */
export function createEmbeddingAdapter(config) {
  return new EmbeddingAdapter(config);
}

export default EmbeddingAdapter;
