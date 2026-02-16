/**
 * S-MORA Layer 0 Scrubber Default Configuration
 * @module smora/scrubber/config/defaults
 */

export interface StructuralConfig {
  stripHTML: boolean;
  normalizeMarkdown: boolean;
  collapseWhitespace: boolean;
  removeScripts: boolean;
  removeStyles: boolean;
}

export interface SemanticConfig {
  removeDuplicates: boolean;
  removeBoilerplate: boolean;
  minSignalRatio: number;
  boilerplatePatterns: string;
}

export interface NormalizationConfig {
  normalizeHeadings: boolean;
  normalizeLists: boolean;
  normalizePunctuation: boolean;
}

export interface ChunkingConfig {
  maxTokens: number;
  minTokens: number;
  hardMaxTokens: number;
  splitOnHeadings: boolean;
  preserveContext: boolean;
}

export interface MetadataConfig {
  addSource: boolean;
  addSection: boolean;
  addHeadingPath: boolean;
  addTimestamp: boolean;
  addHash: boolean;
}

export interface ValidationConfig {
  enforceMinLength: boolean;
  enforceMaxLength: boolean;
  rejectEmptyChunks: boolean;
}

export interface ScrubberConfig {
  enabled: boolean;
  structural: StructuralConfig;
  semantic: SemanticConfig;
  normalization: NormalizationConfig;
  chunking: ChunkingConfig;
  metadata: MetadataConfig;
  validation: ValidationConfig;
  logTransformations: boolean;
  cachePatterns: boolean;
}

export const defaultScrubberConfig: ScrubberConfig = {
  // Master switch - enabled by default for security (PII/sensitive data protection)
  enabled: true,

  // Stage 1: Structural Cleaning
  structural: {
    stripHTML: true,
    normalizeMarkdown: true,
    collapseWhitespace: true,
    removeScripts: true,
    removeStyles: true,
  },

  // Stage 2: Semantic Filtering
  semantic: {
    removeDuplicates: true,
    removeBoilerplate: true,
    minSignalRatio: 0.3,
    boilerplatePatterns: "default",
  },

  // Stage 3: Normalization
  normalization: {
    normalizeHeadings: true,
    normalizeLists: true,
    normalizePunctuation: true,
  },

  // Stage 4: Chunking
  chunking: {
    maxTokens: 500,
    minTokens: 10,
    hardMaxTokens: 2000,
    splitOnHeadings: true,
    preserveContext: true,
  },

  // Stage 5: Metadata Annotation
  metadata: {
    addSource: true,
    addSection: true,
    addHeadingPath: true,
    addTimestamp: true,
    addHash: true,
  },

  // Stage 6: Validation
  validation: {
    enforceMinLength: true,
    enforceMaxLength: true,
    rejectEmptyChunks: true,
  },

  // Performance
  logTransformations: false,
  cachePatterns: true,
};
