/**
 * LLM Adapter for S-MORA
 *
 * Provides a lightweight interface for LLM generation,
 * primarily designed for local model usage (Ollama).
 * Optimized for HyDE-Lite query enhancement.
 *
 * @module smora/adapters/llm-adapter
 */

import fs from 'fs';

/**
 * Custom error class for LLM operations
 */
export class LLMAdapterError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'LLMAdapterError';
    this.details = details;
  }
}

/**
 * LLM Adapter - Simple interface for LLM generation
 *
 * Supports:
 * - Ollama (local models)
 * - OpenAI API (fallback)
 * - Mock mode for testing
 */
export class LLMAdapter {
  constructor(config = {}) {
    this.config = {
      provider: config.provider || process.env.OLLAMA_BASE_URL ? 'ollama' : 'openai',
      model: config.model || process.env.SMORA_HYDE_MODEL || 'llama3.1:8b',
      baseUrl: config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      timeout: config.timeout || 30000,
      maxRetries: config.maxRetries || 2,
      ...config
    };

    this.initialized = false;
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalTokens: 0,
      averageLatency: 0
    };
  }

  /**
   * Initialize the adapter
   */
  async init() {
    if (this.initialized) return;

    if (this.config.provider === 'ollama') {
      await this._initOllama();
    } else if (this.config.provider === 'openai' || this.config.provider === 'zai') {
      await this._initOpenAI();
    } else if (this.config.provider === 'mock') {
      // Mock mode for testing
      this.initialized = true;
    } else {
      throw new LLMAdapterError(`Unsupported provider: ${this.config.provider}`);
    }

    this.initialized = true;
  }

  /**
   * Generate text completion
   *
   * @param {string} prompt - The prompt to generate from
   * @param {Object} options - Generation options
   * @returns {Promise<string>} Generated text
   */
  async generate(prompt, options = {}) {
    await this.init();

    const startTime = Date.now();
    this.metrics.totalRequests++;

    try {
      let result;

      if (this.config.provider === 'ollama') {
        result = await this._generateOllama(prompt, options);
      } else if (this.config.provider === 'openai' || this.config.provider === 'zai') {
        result = await this._generateOpenAI(prompt, options);
      } else if (this.config.provider === 'mock') {
        result = await this._generateMock(prompt, options);
      } else {
        throw new LLMAdapterError(`Unsupported provider: ${this.config.provider}`);
      }

      const latency = Date.now() - startTime;
      this.metrics.successfulRequests++;
      this.metrics.averageLatency =
        (this.metrics.averageLatency * (this.metrics.successfulRequests - 1) + latency) /
        this.metrics.successfulRequests;

      return result;

    } catch (error) {
      this.metrics.failedRequests++;
      throw new LLMAdapterError(
        `Generation failed: ${error.message}`,
        { prompt: prompt.substring(0, 100), error }
      );
    }
  }

  /**
   * Initialize Ollama connection
   * @private
   */
  async _initOllama() {
    try {
      // Check if Ollama is running
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}`);
      }

      const data = await response.json();
      if (data.models && data.models.length > 0) {
        // Check if configured model exists
        const modelAvailable = data.models.some(m =>
          m.name.includes(this.config.model) ||
          m.name.startsWith(this.config.model.split(':')[0])
        );

        if (!modelAvailable) {
          console.warn(`[LLMAdapter] Model ${this.config.model} not found. Available models:`,
            data.models.map(m => m.name).join(', '));
        }
      }
    } catch (error) {
      throw new LLMAdapterError(
        `Failed to connect to Ollama at ${this.config.baseUrl}: ${error.message}`,
        { error }
      );
    }
  }

  /**
   * Initialize OpenAI connection
   * @private
   */
  async _initOpenAI() {
    const apiKey = process.env.ZAI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new LLMAdapterError('ZAI_API_KEY or OPENAI_API_KEY not set');
    }
    this.apiKey = apiKey;
  }

  /**
   * Generate using Ollama
   * @private
   */
  async _generateOllama(prompt, options = {}) {
    const payload = {
      model: this.config.model,
      prompt: prompt,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.3,
        num_predict: options.maxTokens ?? 256,
        top_p: options.topP ?? 0.9,
        frequency_penalty: options.frequencyPenalty ?? 0,
        presence_penalty: options.presencePenalty ?? 0
      }
    };

    const response = await fetch(`${this.config.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.config.timeout)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama error ${response.status}: ${error}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    // Track tokens if available
    if (data.prompt_eval_count && data.eval_count) {
      this.metrics.totalTokens += data.prompt_eval_count + data.eval_count;
    }

    return data.response;
  }

  /**
   * Generate using OpenAI (placeholder)
   * @private
   */
  async _generateOpenAI(prompt, options = {}) {
    const endpoint = this.config.endpoint ||
      (this.config.provider === 'zai'
        ? 'https://api.z.ai/api/coding/paas/v4/chat/completions'
        : 'https://api.openai.com/v1/chat/completions');

    const payload = {
      model: this.config.model || (this.config.provider === 'zai' ? 'glm-4.7' : 'gpt-4'),
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 256,
      stream: false
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.config.timeout || 30000)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.config.provider.toUpperCase()} error ${response.status}: ${error}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message || data.error);
    }

    // GLM-4.7 uses reasoning_content field
    const choice = data.choices?.[0];
    let text = choice?.message?.content || '';
    if (!text && choice?.message?.reasoning_content) {
      text = choice.message.reasoning_content;
    }

    this.metrics.totalTokens += data.usage?.total_tokens || 0;

    return {
      text: text.trim(),
      model: data.model,
      usage: data.usage
    };
  }

  /**
   * Generate mock response for testing
   * @private
   */
  async _generateMock(prompt, options = {}) {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 50));

    // Return a simple mock response
    return `This is a mock response for testing HyDE-Lite. In production, this would be generated by the actual LLM model.`;
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      await this.init();

      if (this.config.provider === 'ollama') {
        const response = await fetch(`${this.config.baseUrl}/api/tags`, {
          signal: AbortSignal.timeout(5000)
        });
        return {
          status: response.ok ? 'healthy' : 'degraded',
          provider: this.config.provider,
          model: this.config.model
        };
      }

      return {
        status: 'healthy',
        provider: this.config.provider,
        model: this.config.model
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
   * Get performance metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      successRate: this.metrics.totalRequests > 0
        ? this.metrics.successfulRequests / this.metrics.totalRequests
        : 0
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalTokens: 0,
      averageLatency: 0
    };
  }
}

/**
 * Create an LLM adapter with auto-detection
 *
 * Detects available providers and returns an appropriate adapter
 */
export async function createLLMAdapter(config = {}) {
  // Priority: Ollama > OpenAI > Mock
  let provider = config.provider;

  if (!provider) {
    // Auto-detect
    try {
      const response = await fetch('http://localhost:11434/api/tags', {
        signal: AbortSignal.timeout(2000)
      });
      if (response.ok) {
        provider = 'ollama';
      }
    } catch (error) {
      // Ollama not available
    }

    if (!provider && process.env.OPENAI_API_KEY) {
      provider = 'openai';
    }

    if (!provider) {
      provider = 'mock';
      console.warn('[LLMAdapter] No provider detected, using mock mode');
    }
  }

  const adapter = new LLMAdapter({ ...config, provider });
  await adapter.init();

  return adapter;
}

export default LLMAdapter;
