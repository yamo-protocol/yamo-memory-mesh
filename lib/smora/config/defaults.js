/**
 * S-MORA Configuration Defaults
 *
 * Default configuration values for S-MORA components
 *
 * @module smora/config/defaults
 */

/**
 * Default S-MORA configuration
 */
export const defaultConfig = {
  // Master switches
  enabled: false,

  // Layer 1: HyDE-Lite Query Enhancement
  hyde: {
    enabled: false,
    model: 'local',
    maxTokens: 256,
    temperature: 0.3,
    fallbackToQuery: true,
    cacheHypotheticals: true,
    cacheSize: 100
  },

  // Layer 2: Hybrid Retrieval
  retrieval: {
    alpha: 0.5,  // 0=pure vector, 1=pure keyword
    vectorLimit: 30,
    keywordLimit: 30,
    finalLimit: 10,
    enableReranking: false,
    enableQualityGate: true,
    minScore: 0.1,
    diversityThreshold: 0.85
  },

  // Layer 3: Context Compression
  compression: {
    enabled: false,
    maxChunkSize: 500,
    chunkOverlap: 50,
    summaryCompressionRatio: 0.3,
    maxTreeDepth: 3,
    sectionSize: 5,
    cacheTrees: true,
    cacheSize: 100,
    cacheMemoryMB: 50
  },

  // Layer 4: Context Assembly
  assembly: {
    maxTokens: 4000,
    reservedTokens: 512,
    safetyMargin: 100,
    targetUtilization: 0.95,
    structure: 'structured',
    includeCitations: true,
    includeHypothetical: true,
    includeSummary: true,
    instructionTemplate: 'default'
  },

  // Phase 6: Performance & Scalability
  cache: {
    enabled: false,
    maxSize: 100,
    ttl: 300000
  },

  batch: {
    concurrency: 10
  },

  monitoring: {
    enabled: false,
    windowSize: 1000
  }
};

/**
 * Load S-MORA configuration from environment variables
 *
 * Falls back to defaults for any missing values
 *
 * @returns {Object} Complete S-MORA configuration
 */
export function loadSMORAConfig() {
  return {
    // Master switches
    enabled: process.env.SMORA_ENABLED === 'true',

    // LanceDB configuration
    lancedb: {
      uri: process.env.LANCEDB_URI || process.env.LANCEDB_URL || 'lancedb://./data/lancedb',
      apiKey: process.env.LANCEDB_API_KEY || null,
      region: process.env.LANCEDB_REGION || null
    },

    // Embedding configuration
    embedding: {
      provider: process.env.EMBEDDING_PROVIDER || 'local',
      model: process.env.EMBEDDING_MODEL || 'bge-small-en-v1.5',
      dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '384')
    },

    // LLM configuration
    llm: {
      provider: process.env.LLM_PROVIDER || 'ollama',
      model: process.env.LLM_MODEL || 'llama3.1:8b',
      baseUrl: process.env.LLM_BASE_URL || 'http://localhost:11434',
      apiKey: process.env.LLM_API_KEY || null,
      timeout: parseInt(process.env.LLM_TIMEOUT || '30000')
    },

    // Layer 1: HyDE-Lite
    hyde: {
      enabled: process.env.SMORA_HYDE_ENABLED === 'true',
      model: process.env.SMORA_HYDE_MODEL || 'local',
      maxTokens: parseInt(process.env.SMORA_HYDE_MAX_TOKENS || '256'),
      temperature: parseFloat(process.env.SMORA_HYDE_TEMPERATURE || '0.3'),
      fallbackToQuery: process.env.SMORA_HYDE_FALLBACK !== 'false',
      cacheHypotheticals: process.env.SMORA_HYDE_CACHE !== 'false',
      cacheSize: parseInt(process.env.SMORA_HYDE_CACHE_SIZE || '100')
    },

    // Layer 2: Hybrid Retrieval
    retrieval: {
      alpha: parseFloat(process.env.SMORA_HYBRID_ALPHA || '0.5'),
      vectorLimit: parseInt(process.env.SMORA_VECTOR_LIMIT || '30'),
      keywordLimit: parseInt(process.env.SMORA_KEYWORD_LIMIT || '30'),
      finalLimit: parseInt(process.env.SMORA_FINAL_LIMIT || '10'),
      enableReranking: process.env.SMORA_ENABLE_RERANKING === 'true',
      enableQualityGate: process.env.SMORA_ENABLE_QUALITY_GATE !== 'false',
      minScore: parseFloat(process.env.SMORA_MIN_SCORE || '0.1'),
      diversityThreshold: parseFloat(process.env.SMORA_DIVERSITY_THRESHOLD || '0.85')
    },

    // Layer 3: Context Compression
    compression: {
      enabled: process.env.SMORA_COMPRESSION_ENABLED === 'true',
      level: process.env.SMORA_COMPRESSION_LEVEL || 'medium',
      maxChunkSize: parseInt(process.env.SMORA_MAX_CHUNK_SIZE || '500'),
      chunkOverlap: parseInt(process.env.SMORA_CHUNK_OVERLAP || '50'),
      summaryCompressionRatio: parseFloat(process.env.SMORA_SUMMARY_RATIO || '0.3'),
      maxTreeDepth: parseInt(process.env.SMORA_TREE_DEPTH || '3'),
      sectionSize: parseInt(process.env.SMORA_SECTION_SIZE || '5'),
      cacheTrees: process.env.SMORA_CACHE_TREES !== 'false',
      cacheSize: parseInt(process.env.SMORA_TREE_CACHE_SIZE || '100')
    },

    // Layer 4: Context Assembly
    assembly: {
      maxTokens: parseInt(process.env.SMORA_MAX_CONTEXT_TOKENS || '4000'),
      reservedTokens: parseInt(process.env.SMORA_RESERVED_TOKENS || '512'),
      safetyMargin: parseInt(process.env.SMORA_SAFETY_MARGIN || '100'),
      targetUtilization: parseFloat(process.env.SMORA_TARGET_UTILIZATION || '0.95'),
      structure: process.env.SMORA_ASSEMBLY_STRUCTURE || 'structured',
      includeCitations: process.env.SMORA_INCLUDE_CITATIONS !== 'false',
      includeHypothetical: process.env.SMORA_INCLUDE_HYPOTHETICAL !== 'false',
      includeSummary: process.env.SMORA_INCLUDE_SUMMARY !== 'false',
      instructionTemplate: process.env.SMORA_INSTRUCTION_TEMPLATE || 'default'
    },

    // Phase 6: Performance & Scalability
    cache: {
      enabled: process.env.SMORA_CACHE__ENABLED === 'true',
      maxSize: parseInt(process.env.SMORA_CACHE__MAX_SIZE || '100'),
      ttl: parseInt(process.env.SMORA_CACHE__TTL || '300000')
    },

    batch: {
      concurrency: parseInt(process.env.SMORA_BATCH__CONCURRENCY || '10')
    },

    monitoring: {
      enabled: process.env.SMORA_MONITORING__ENABLED === 'true',
      windowSize: parseInt(process.env.SMORA_MONITORING__WINDOW_SIZE || '1000')
    }
  };
}

/**
 * Validate S-MORA configuration
 *
 * @param {Object} config - Configuration to validate
 * @returns {Object} Validation result with valid flag and errors array
 */
export function validateSMORAConfig(config) {
  const errors = [];

  // Validate retrieval configuration
  if (config.retrieval) {
    if (config.retrieval.alpha < 0 || config.retrieval.alpha > 1) {
      errors.push('retrieval.alpha must be between 0 and 1');
    }
    if (config.retrieval.vectorLimit < 1) {
      errors.push('retrieval.vectorLimit must be positive');
    }
    if (config.retrieval.keywordLimit < 1) {
      errors.push('retrieval.keywordLimit must be positive');
    }
    if (config.retrieval.finalLimit < 1) {
      errors.push('retrieval.finalLimit must be positive');
    }
  }

  // Validate compression configuration
  if (config.compression) {
    if (config.compression.maxChunkSize < 100) {
      errors.push('compression.maxChunkSize must be at least 100');
    }
    if (config.compression.summaryCompressionRatio <= 0 || config.compression.summaryCompressionRatio > 1) {
      errors.push('compression.summaryCompressionRatio must be between 0 and 1');
    }
    if (config.compression.maxTreeDepth < 1 || config.compression.maxTreeDepth > 5) {
      errors.push('compression.maxTreeDepth must be between 1 and 5');
    }
  }

  // Validate assembly configuration
  if (config.assembly) {
    if (config.assembly.maxTokens < 512) {
      errors.push('assembly.maxTokens must be at least 512');
    }
    if (!['structured', 'compact', 'natural'].includes(config.assembly.structure)) {
      errors.push('assembly.structure must be one of: structured, compact, natural');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export default {
  defaultConfig,
  loadSMORAConfig,
  validateSMORAConfig
};
