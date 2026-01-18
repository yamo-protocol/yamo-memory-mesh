/**
 * Template Engine for HyDE-Lite
 *
 * Manages prompt templates for query enhancement.
 * Supports model-specific adaptations and query type detection.
 *
 * @module smora/query-understanding/template-engine
 */

/**
 * Template definitions
 */
export const templates = {
  general: {
    name: 'general',
    description: 'General-purpose query enhancement',
    prompt: (query) => `Based on the question below, generate a brief, factual answer (50-100 words).

Question: ${query}

Answer:`,
    maxTokens: 256,
    temperature: 0.3,
    maxLength: 500
  },

  technical: {
    name: 'technical',
    description: 'Technical and code-related queries',
    prompt: (query) => `Based on this technical question, provide a concise answer focusing on implementation details.

Question: ${query}

Answer:`,
    maxTokens: 256,
    temperature: 0.3,
    maxLength: 500
  },

  conversational: {
    name: 'conversational',
    description: 'Natural language, conversational queries',
    prompt: (query) => `Generate a helpful, conversational response to this question.

Question: ${query}

Answer:`,
    maxTokens: 200,
    temperature: 0.4,
    maxLength: 400
  },

  memory: {
    name: 'memory',
    description: 'Memory and recall related queries',
    prompt: (query) => `Recall information about: ${query}

Provide a concise summary of what you remember about this topic:`,
    maxTokens: 200,
    temperature: 0.4,
    maxLength: 400
  },

  configuration: {
    name: 'configuration',
    description: 'Configuration and setup related queries',
    prompt: (query) => `Provide a clear, step-by-step answer to this configuration question.

Question: ${query}

Answer:`,
    maxTokens: 300,
    temperature: 0.3,
    maxLength: 600
  },

  troubleshooting: {
    name: 'troubleshooting',
    description: 'Problem-solving and debugging queries',
    prompt: (query) => `Analyze this problem and provide a solution approach.

Problem: ${query}

Solution:`,
    maxTokens: 300,
    temperature: 0.3,
    maxLength: 600
  }
};

/**
 * Model-specific template adaptations
 */
export const modelAdaptations = {
  llama: {
    name: 'llama',
    patterns: [/llama/i, /llama2/i, /llama3/i, 'llama3.1', 'llama3.2'],
    adaptations: {
      temperature: 0.3,
      maxTokens: 256,
      systemPrompt: 'You are a helpful assistant. Provide concise, accurate answers.'
    }
  },

  mistral: {
    name: 'mistral',
    patterns: [/mistral/i, 'mixtral'],
    adaptations: {
      temperature: 0.2,
      maxTokens: 256,
      systemPrompt: 'Answer briefly and accurately.'
    }
  },

  qwen: {
    name: 'qwen',
    patterns: [/qwen/i],
    adaptations: {
      temperature: 0.3,
      maxTokens: 256,
      systemPrompt: 'Provide clear, concise technical answers.'
    }
  },

  deepseek: {
    name: 'deepseek',
    patterns: [/deepseek/i, 'deepseek-coder'],
    adaptations: {
      temperature: 0.2,
      maxTokens: 300,
      systemPrompt: 'Give precise, well-structured responses.'
    }
  },

  generic: {
    name: 'generic',
    patterns: [],
    adaptations: {
      temperature: 0.3,
      maxTokens: 256,
      systemPrompt: 'Provide helpful, concise answers.'
    }
  }
};

/**
 * Template Engine
 */
export class TemplateEngine {
  constructor(options = {}) {
    this.config = {
      defaultTemplate: options.defaultTemplate || 'general',
      enableModelAdaptation: options.enableModelAdaptation !== false,
      ...options
    };

    this.currentModel = null;
    this.currentAdaptation = null;
  }

  /**
   * Select the appropriate template based on query content
   *
   * @param {string} query - The user's query
   * @param {Object} context - Additional context
   * @returns {string} Template name
   */
  selectTemplate(query, context = {}) {
    // If context specifies template, use it
    if (context.templateType && templates[context.templateType]) {
      return context.templateType;
    }

    // Analyze query to determine best template
    const lowerQuery = query.toLowerCase();

    // Configuration queries
    if (this._matchesAny(lowerQuery, [
      'configure', 'setup', 'install', 'environment variable',
      'config', 'how do i set', 'how to enable'
    ])) {
      return 'configuration';
    }

    // Troubleshooting queries
    if (this._matchesAny(lowerQuery, [
      'fix', 'error', 'fail', 'not working', 'debug',
      'troubleshoot', 'solve', 'why is'
    ])) {
      return 'troubleshooting';
    }

    // Technical/code queries
    if (this._matchesAny(lowerQuery, [
      'api', 'function', 'class', 'method', 'code',
      'implement', 'syntax', 'import', 'export'
    ])) {
      return 'technical';
    }

    // Memory queries
    if (this._matchesAny(lowerQuery, [
      'recall', 'remember', 'what do you know',
      'memory', 'past conversation'
    ])) {
      return 'memory';
    }

    // Conversational queries (how, what, why questions)
    if (lowerQuery.startsWith('how ') ||
        lowerQuery.startsWith('what ') ||
        lowerQuery.startsWith('why ') ||
        lowerQuery.startsWith('can ') ||
        lowerQuery.startsWith('does ')) {
      return 'conversational';
    }

    // Default to general
    return 'general';
  }

  /**
   * Get a template by name
   *
   * @param {string} templateName - Name of the template
   * @returns {Object} Template definition
   */
  getTemplate(templateName) {
    const template = templates[templateName] || templates.general;
    return this._applyModelAdaptation(template);
  }

  /**
   * Apply a template to a query
   *
   * @param {Object|string} template - Template object or name
   * @param {string} query - The query to enhance
   * @returns {string} Formatted prompt
   */
  applyTemplate(template, query) {
    if (typeof template === 'string') {
      template = this.getTemplate(template);
    }

    return template.prompt(query);
  }

  /**
   * Set the current model for adaptation
   *
   * @param {string} modelName - Model name
   */
  setModel(modelName) {
    this.currentModel = modelName;
    this.currentAdaptation = this._detectModelAdaptation(modelName);
  }

  /**
   * Get all available template names
   *
   * @returns {Array<string>} Template names
   */
  getAvailableTemplates() {
    return Object.keys(templates);
  }

  /**
   * Check if a query matches any of the patterns
   * @private
   */
  _matchesAny(query, patterns) {
    return patterns.some(pattern => query.includes(pattern));
  }

  /**
   * Detect model adaptation based on model name
   * @private
   */
  _detectModelAdaptation(modelName) {
    if (!modelName) {
      return modelAdaptations.generic;
    }

    const lowerName = modelName.toLowerCase();

    for (const [key, adaptation] of Object.entries(modelAdaptations)) {
      if (key === 'generic') continue;

      for (const pattern of adaptation.patterns) {
        if (typeof pattern === 'string') {
          if (lowerName.includes(pattern.toLowerCase())) {
            return adaptation;
          }
        } else if (pattern instanceof RegExp) {
          if (pattern.test(lowerName)) {
            return adaptation;
          }
        }
      }
    }

    return modelAdaptations.generic;
  }

  /**
   * Apply model-specific adaptations to template
   * @private
   */
  _applyModelAdaptation(template) {
    if (!this.config.enableModelAdaptation || !this.currentAdaptation) {
      return template;
    }

    return {
      ...template,
      temperature: this.currentAdaptation.adaptations.temperature,
      maxTokens: this.currentAdaptation.adaptations.maxTokens
    };
  }
}

/**
 * Default template engine instance
 */
export const defaultTemplateEngine = new TemplateEngine();

export default TemplateEngine;
