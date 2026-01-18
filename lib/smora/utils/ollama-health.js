/**
 * Ollama Health Check Utility
 *
 * Provides health checking functionality for Ollama service.
 * Implements fail-fast pattern with timeout support.
 */

export class OllamaHealthCheck {
  /**
   * Create a new OllamaHealthCheck instance
   * @param {Object} options - Configuration options
   * @param {string} options.baseUrl - Ollama base URL (default: http://localhost:11434)
   * @param {number} options.timeout - Request timeout in ms (default: 5000)
   */
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'http://localhost:11434';
    this.timeout = options.timeout || 5000;
  }

  /**
   * Check Ollama service health
   * @returns {Promise<Object>} Health check result with status, ollama_running, version, models
   */
  async checkOllama() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          status: 'unhealthy',
          ollama_running: false,
          version: null,
          models: [],
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const data = await response.json();

      return {
        status: 'healthy',
        ollama_running: true,
        version: data.version || null,
        models: data.models || [],
      };
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle different error types
      if (error.name === 'AbortError') {
        return {
          status: 'unhealthy',
          ollama_running: false,
          version: null,
          models: [],
          error: `Request timeout after ${this.timeout}ms`,
        };
      }

      if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
        return {
          status: 'unhealthy',
          ollama_running: false,
          version: null,
          models: [],
          error: `Connection refused: Ollama not running at ${this.baseUrl}`,
        };
      }

      return {
        status: 'unhealthy',
        ollama_running: false,
        version: null,
        models: [],
        error: error.message || String(error),
      };
    }
  }
}
