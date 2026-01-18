/**
 * S-MORA (Small-Model-Optimized Retrieval Architecture)
 *
 * Main entry point for S-MORA functionality.
 *
 * @module smora
 */

// Query Understanding (Layer 1)
export {
  HyDELite,
  createHyDELite,
  TemplateEngine,
  QualityValidator,
  templates,
  modelAdaptations
} from './query-understanding/index.js';

// Adapters
export {
  LLMAdapter,
  createLLMAdapter
} from './adapters/index.js';

// Retrieval (Layer 2)
export {
  HybridRetrieval,
  HybridRetrievalError,
  KeywordSearch,
  KeywordSearchError,
  ResultFusion,
  ResultFusionError,
  QualityGate,
  QualityGateError
} from './retrieval/index.js';

// Compression (Layer 3)
export {
  TreeBuilder,
  TreeBuilderError,
  TreeTraverser,
  TreeTraverserError,
  SummaryCache,
  SummaryCacheError,
  ContextCompressor,
  ContextCompressorError
} from './compression/index.js';

// Assembly (Layer 4)
export {
  ContextAssembler,
  ContextAssemblerError,
  ContextFormatter,
  ContextFormatterError,
  TokenOptimizer,
  TokenOptimizerError
} from './assembly/index.js';

/**
 * S-MORA version
 */
export const VERSION = '1.0.0-alpha';

/**
 * S-MORA configuration defaults
 */
export const DEFAULTS = {
  // Layer 1: HyDE-Lite
  hyde: {
    enabled: false,
    model: 'llama3.1:8b',
    maxTokens: 256,
    temperature: 0.3,
    fallbackToQuery: true,
    maxRetries: 2,
    cacheHypotheticals: true,
    cacheSize: 100
  },

  // Layer 2: Hybrid Retrieval
  retrieval: {
    alpha: 0.5,
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
  }
};
