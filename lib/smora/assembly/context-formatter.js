/**
 * S-MORA Context Formatter
 *
 * Formats context blocks for different model types
 * and maintains structure/audibility.
 *
 * @module smora/assembly/context-formatter
 */

/**
 * Context Formatter for Model-Specific Formatting
 *
 * Applies model-specific templates and formatting
 * to ensure optimal compatibility.
 */
export class ContextFormatter {
  constructor(options = {}) {
    this.config = {
      defaultModel: options.defaultModel || 'generic',
      includeSpecialTokens: options.includeSpecialTokens !== false,
      preserveWhitespace: options.preserveWhitespace !== false,
      ...options
    };

    // Model-specific formatting templates
    this.formatters = {
      llama: this._formatLlama.bind(this),
      llama3: this._formatLlama3.bind(this),
      mistral: this._formatMistral.bind(this),
      mixtral: this._formatMixtral.bind(this),
      qwen: this._formatQwen.bind(this),
      qwen2: this._formatQwen2.bind(this),
      deepseek: this._formatDeepSeek.bind(this),
      phi: this._formatPhi.bind(this),
      gemma: this._formatGemma.bind(this),
      generic: this._formatGeneric.bind(this)
    };

    this.metrics = {
      formatted: 0,
      byModel: {}
    };
  }

  /**
   * Format context for specific model
   *
   * @param {string} context - Structured context
   * @param {string} model - Model name
   * @returns {string} Formatted context
   */
  format(context, model = null) {
    const targetModel = model || this.config.defaultModel;
    const formatter = this._getFormatter(targetModel);

    const formatted = formatter(context);

    // Update metrics
    this.metrics.formatted++;
    this.metrics.byModel[targetModel] = (this.metrics.byModel[targetModel] || 0) + 1;

    return formatted;
  }

  /**
   * Format context with chat messages format
   *
   * @param {Object} message - Message object
   * @param {string} model - Model name
   * @returns {string} Formatted message
   */
  formatMessage(message, model = null) {
    const { role, content } = message;

    if (role === 'system') {
      return this._formatSystemMessage(content, model);
    } else if (role === 'user') {
      return this._formatUserMessage(content, model);
    } else if (role === 'assistant') {
      return this._formatAssistantMessage(content, model);
    }

    return content;
  }

  /**
   * Format conversation history
   *
   * @param {Array} messages - Conversation messages
   * @param {string} model - Model name
   * @returns {string} Formatted conversation
   */
  formatConversation(messages, model = null) {
    const targetModel = model || this.config.defaultModel;
    const formatter = this._getFormatter(targetModel);

    return messages.map(msg => this.formatMessage(msg, targetModel)).join('\n');
  }

  /**
   * Get formatter for model
   *
   * @private
   * @param {string} model - Model name
   * @returns {Function} Formatter function
   */
  _getFormatter(model) {
    // Normalize model name
    const normalized = model.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Try to find matching formatter
    for (const [key, formatter] of Object.entries(this.formatters)) {
      if (normalized.includes(key)) {
        return formatter;
      }
    }

    return this.formatters.generic;
  }

  /**
   * Format for Llama models
   *
   * @private
   * @param {string} context - Context text
   * @returns {string} Formatted context
   */
  _formatLlama(context) {
    if (!this.config.includeSpecialTokens) {
      return context;
    }
    return `<|begin_of_text|><|start_header_id|>user<|end_header_id|>\n\n${context}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n`;
  }

  /**
   * Format for Llama 3 models
   *
   * @private
   * @param {string} context - Context text
   * @returns {string} Formatted context
   */
  _formatLlama3(context) {
    if (!this.config.includeSpecialTokens) {
      return context;
    }
    return `<|begin_of_text|><|start_header_id|>user<|end_header_id|>\n\n${context}<|eot_id|><|start_header_id_id|>assistant<|end_header_id|>\n\n`;
  }

  /**
   * Format for Mistral models
   *
   * @private
   * @param {string} context - Context text
   * @returns {string} Formatted context
   */
  _formatMistral(context) {
    if (!this.config.includeSpecialTokens) {
      return context;
    }
    return `[INST] ${context} [/INST]`;
  }

  /**
   * Format for Mixtral models
   *
   * @private
   * @param {string} context - Context text
   * @returns {string} Formatted context
   */
  _formatMixtral(context) {
    // Mixtral uses same format as Mistral
    return this._formatMistral(context);
  }

  /**
   * Format for Qwen models
   *
   * @private
   * @param {string} context - Context text
   * @returns {string} Formatted context
   */
  _formatQwen(context) {
    if (!this.config.includeSpecialTokens) {
      return context;
    }
    return `<|im_start|>user\n${context}<|im_end|>\n<|im_start|>assistant\n`;
  }

  /**
   * Format for Qwen 2 models
   *
   * @private
   * @param {string} context - Context text
   * @returns {string} Formatted context
   */
  _formatQwen2(context) {
    // Qwen 2 uses similar format to Qwen
    return this._formatQwen(context);
  }

  /**
   * Format for DeepSeek models
   *
   * @private
   * @param {string} context - Context text
   * @returns {string} Formatted context
   */
  _formatDeepSeek(context) {
    return `### Instruction:\n${context}\n\n### Response:`;
  }

  /**
   * Format for Phi models
   *
   * @private
   * @param {string} context - Context text
   * @returns {string} Formatted context
   */
  _formatPhi(context) {
    return `<|user|>\n${context}<|end|>\n<|assistant|>\n`;
  }

  /**
   * Format for Gemma models
   *
   * @private
   * @param {string} context - Context text
   * @returns {string} Formatted context
   */
  _formatGemma(context) {
    return `<start_of_turn>user\n${context}<end_of_turn>\n<start_of_turn>model\n`;
  }

  /**
   * Format for generic models (no special tokens)
   *
   * @private
   * @param {string} context - Context text
   * @returns {string} Formatted context
   */
  _formatGeneric(context) {
    return context;
  }

  /**
   * Format system message
   *
   * @private
   * @param {string} content - Message content
   * @param {string} model - Model name
   * @returns {string} Formatted message
   */
  _formatSystemMessage(content, model) {
    const normalized = model.toLowerCase();
    if (normalized.includes('llama')) {
      return `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n${content}<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n`;
    } else if (normalized.includes('mistral') || normalized.includes('mixtral')) {
      return `[INST] ${content} [/INST]`;
    } else if (normalized.includes('qwen')) {
      return `<|im_start|>system\n${content}<|im_end|>\n<|im_start|>user\n`;
    } else if (normalized.includes('phi')) {
      return `<|system|>\n${content}<|end|>\n<|user|>\n`;
    } else if (normalized.includes('gemma')) {
      return `<start_of_turn>system\n${content}<end_of_turn>\n<start_of_turn>user\n`;
    }
    return `System: ${content}\n\n`;
  }

  /**
   * Format user message
   *
   * @private
   * @param {string} content - Message content
   * @param {string} model - Model name
   * @returns {string} Formatted message
   */
  _formatUserMessage(content, model) {
    const normalized = model.toLowerCase();
    if (normalized.includes('llama')) {
      return content;
    } else if (normalized.includes('mistral') || normalized.includes('mixtral')) {
      return `[INST] ${content} [/INST]`;
    } else if (normalized.includes('qwen')) {
      return `${content}<|im_end|>\n<|im_start|>assistant\n`;
    } else if (normalized.includes('phi')) {
      return `${content}<|end|>\n<|assistant|>\n`;
    } else if (normalized.includes('gemma')) {
      return `${content}<end_of_turn>\n<start_of_turn>model\n`;
    }
    return content;
  }

  /**
   * Format assistant message
   *
   * @private
   * @param {string} content - Message content
   * @param {string} model - Model name
   * @returns {string} Formatted message
   */
  _formatAssistantMessage(content, model) {
    const normalized = model.toLowerCase();
    if (normalized.includes('llama')) {
      return content;
    } else if (normalized.includes('mistral') || normalized.includes('mixtral')) {
      return content;
    } else if (normalized.includes('qwen')) {
      return `${content}<|im_end|>\n`;
    } else if (normalized.includes('phi')) {
      return `${content}<|end|>\n`;
    } else if (normalized.includes('gemma')) {
      return `${content}<end_of_turn>\n`;
    }
    return content;
  }

  /**
   * Format context block with citations
   *
   * @param {Array} chunks - Content chunks
   * @param {Object} options - Formatting options
   * @returns {string} Formatted block
   */
  formatBlock(chunks, options = {}) {
    const {
      includeIndex = true,
      includeSource = true,
      separator = '\n\n',
      prefix = '',
      suffix = ''
    } = options;

    const formatted = chunks
      .map((chunk, i) => {
        let line = '';

        if (includeIndex) {
          line += `${i + 1}. `;
        }

        line += chunk.content || chunk.text || '';

        if (includeSource && chunk.source) {
          line += ` [Source: ${chunk.source}]`;
        }

        return line;
      })
      .join(separator);

    return prefix + formatted + suffix;
  }

  /**
   * Get formatter metrics
   *
   * @returns {Object} Metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      config: {
        defaultModel: this.config.defaultModel,
        includeSpecialTokens: this.config.includeSpecialTokens
      }
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      formatted: 0,
      byModel: {}
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
 * Custom error class for context formatter operations
 */
export class ContextFormatterError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ContextFormatterError';
    this.details = details;
  }
}

export default ContextFormatter;
