/**
 * LanceDB Configuration Loader
 * Loads and validates configuration from environment variables
 */

import path from "path";

/**
 * Default configuration values
 */
export const DEFAULTS = {
  // LanceDB Configuration
  LANCEDB_URI: "./runtime/data/lancedb",
  LANCEDB_MEMORY_TABLE: "memory_entries",
  LANCEDB_MAX_CACHE_SIZE: "2GB",

  // Embedding Model Configuration
  EMBEDDING_MODEL_TYPE: "local",
  EMBEDDING_MODEL_NAME: "Xenova/all-MiniLM-L6-v2",
  EMBEDDING_DIMENSION: "384",
  EMBEDDING_BATCH_SIZE: "32",
  EMBEDDING_NORMALIZE: "true",

  // API-based Embeddings
  OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",

  // Search Configuration
  DEFAULT_TOP_K: "10",
  DEFAULT_SIMILARITY_THRESHOLD: "0.7",
  ENABLE_HYBRID_SEARCH: "true",
  HYBRID_SEARCH_ALPHA: "0.5",

  // Performance Tuning
  VECTOR_INDEX_TYPE: "ivf_pq",
  IVF_PARTITIONS: "256",
  PQ_BITS: "8",
  ENABLE_QUERY_CACHE: "true",
  QUERY_CACHE_TTL: "300",
} as const;

export type ConfigKey = keyof typeof DEFAULTS;
export type Config = Record<ConfigKey, string>;

/**
 * Memory system configuration defaults
 */
export const MEMORY_DEFAULTS = {
  // Feature flags
  MEMORY_ENABLED: "true",
  MEMORY_AUTO_CAPTURE: "true",
  MEMORY_AUTO_RECALL: "true",

  // Recall settings
  MEMORY_MAX_CONTEXT: "5",
  MEMORY_RELEVANCE_THRESHOLD: "0.7",
  MEMORY_IMPORTANCE_BOOST: "1.5",
  MEMORY_RECENCY_WEIGHT: "0.3",

  // Capture settings
  MEMORY_MIN_IMPORTANCE: "0.3",
  MEMORY_DEDUP_THRESHOLD: "0.9",
  MEMORY_CAPTURE_TOOL_RESULTS: "true",
  MEMORY_CAPTURE_FILE_OPS: "true",

  // Retention settings
  MEMORY_RETENTION_ENABLED: "true",
  MEMORY_RETENTION_DAYS: "90",
  MEMORY_MAX_PER_SESSION: "100",
  MEMORY_MIN_IMPORTANCE_TO_KEEP: "0.5",

  // Privacy settings
  MEMORY_REDACT_PII: "false",
  MEMORY_ENCRYPTION_ENABLED: "false",
} as const;

export interface MemoryConfig {
  enabled: boolean;
  autoCapture: boolean;
  autoRecall: boolean;
  maxContext: number;
  relevanceThreshold: number;
  importanceBoost: number;
  recencyWeight: number;
  minImportance: number;
  dedupThreshold: number;
  captureToolResults: boolean;
  captureFileOps: boolean;
  retention: {
    enabled: boolean;
    days: number;
    maxPerSession: number;
    minImportanceToKeep: number;
  };
  privacy: {
    redactPii: boolean;
    encryptionEnabled: boolean;
  };
}

/**
 * Load configuration with validation
 */
export function loadConfig(): Config {
  const config: Partial<Config> = {};

  for (const [key, defaultValue] of Object.entries(DEFAULTS)) {
    config[key as ConfigKey] = process.env[key] || defaultValue;
  }

  // Resolve relative paths to absolute relative to package root
  if (
    config.LANCEDB_URI &&
    (config.LANCEDB_URI.startsWith("./") ||
      config.LANCEDB_URI.startsWith("../"))
  ) {
    const currentFileUrl = import.meta.url;
    const currentFilePath = new URL(currentFileUrl).pathname;
    // config.ts is in lib/brain/adapters, so package root is ../../../
    const packageRoot = path.resolve(
      path.dirname(currentFilePath),
      "../../../",
    );
    config.LANCEDB_URI = path.resolve(packageRoot, config.LANCEDB_URI);
  }

  return config as Config;
}

/**
 * Load memory-specific configuration
 * @returns {Object} Memory configuration object
 */
export function loadMemoryConfig(): MemoryConfig {
  return {
    enabled: process.env.MEMORY_ENABLED !== "false",
    autoCapture: process.env.MEMORY_AUTO_CAPTURE !== "false",
    autoRecall: process.env.MEMORY_AUTO_RECALL !== "false",
    maxContext: parseInt(process.env.MEMORY_MAX_CONTEXT || "5"),
    relevanceThreshold: parseFloat(
      process.env.MEMORY_RELEVANCE_THRESHOLD || "0.7",
    ),
    importanceBoost: parseFloat(process.env.MEMORY_IMPORTANCE_BOOST || "1.5"),
    recencyWeight: parseFloat(process.env.MEMORY_RECENCY_WEIGHT || "0.3"),
    minImportance: parseFloat(process.env.MEMORY_MIN_IMPORTANCE || "0.3"),
    dedupThreshold: parseFloat(process.env.MEMORY_DEDUP_THRESHOLD || "0.9"),
    captureToolResults: process.env.MEMORY_CAPTURE_TOOL_RESULTS !== "false",
    captureFileOps: process.env.MEMORY_CAPTURE_FILE_OPS !== "false",
    retention: {
      enabled: process.env.MEMORY_RETENTION_ENABLED !== "false",
      days: parseInt(process.env.MEMORY_RETENTION_DAYS || "90"),
      maxPerSession: parseInt(process.env.MEMORY_MAX_PER_SESSION || "100"),
      minImportanceToKeep: parseFloat(
        process.env.MEMORY_MIN_IMPORTANCE_TO_KEEP || "0.5",
      ),
    },
    privacy: {
      redactPii: process.env.MEMORY_REDACT_PII === "true",
      encryptionEnabled: process.env.MEMORY_ENCRYPTION_ENABLED === "true",
    },
  };
}

/**
 * Validate configuration
 */
export function validateConfig(config: Config): string[] {
  const errors: string[] = [];

  // Validate embedding model type
  const validModelTypes = ["local", "openai", "cohere", "voyage"];
  if (!validModelTypes.includes(config.EMBEDDING_MODEL_TYPE)) {
    errors.push(`Invalid EMBEDDING_MODEL_TYPE: ${config.EMBEDDING_MODEL_TYPE}`);
  }

  // Validate numeric values
  const dimension = parseInt(config.EMBEDDING_DIMENSION);
  if (isNaN(dimension) || dimension <= 0) {
    errors.push(`Invalid EMBEDDING_DIMENSION: ${config.EMBEDDING_DIMENSION}`);
  }

  const topK = parseInt(config.DEFAULT_TOP_K);
  if (isNaN(topK) || topK <= 0) {
    errors.push(`Invalid DEFAULT_TOP_K: ${config.DEFAULT_TOP_K}`);
  }

  // Validate boolean strings
  const boolFields: (keyof Config)[] = [
    "EMBEDDING_NORMALIZE",
    "ENABLE_HYBRID_SEARCH",
    "ENABLE_QUERY_CACHE",
  ];
  for (const field of boolFields) {
    const value = config[field].toLowerCase();
    if (value !== "true" && value !== "false") {
      errors.push(`Invalid ${field}: must be 'true' or 'false'`);
    }
  }

  // Validate similarity threshold (0-1 range)
  const threshold = parseFloat(config.DEFAULT_SIMILARITY_THRESHOLD);
  if (isNaN(threshold) || threshold < 0 || threshold > 1) {
    errors.push(
      `Invalid DEFAULT_SIMILARITY_THRESHOLD: must be between 0 and 1`,
    );
  }

  // Validate hybrid search alpha (0-1 range)
  const alpha = parseFloat(config.HYBRID_SEARCH_ALPHA);
  if (isNaN(alpha) || alpha < 0 || alpha > 1) {
    errors.push(`Invalid HYBRID_SEARCH_ALPHA: must be between 0 and 1`);
  }

  // Validate positive integers
  const positiveIntFields: (keyof Config)[] = [
    "EMBEDDING_BATCH_SIZE",
    "IVF_PARTITIONS",
    "PQ_BITS",
    "QUERY_CACHE_TTL",
  ];
  for (const field of positiveIntFields) {
    const value = parseInt(config[field]);
    if (isNaN(value) || value <= 0) {
      errors.push(`Invalid ${field}: must be a positive integer`);
    }
  }

  // Validate cache size format (e.g., "2GB", "500MB")
  const cacheSizePattern = /^\d+(\.\d+)?(KB|MB|GB|TB)$/;
  if (!cacheSizePattern.test(config.LANCEDB_MAX_CACHE_SIZE)) {
    errors.push(
      `Invalid LANCEDB_MAX_CACHE_SIZE: must match pattern like "2GB", "500MB"`,
    );
  }

  return errors;
}

/**
 * Get validated configuration
 */
export function getConfig(): Config {
  const config = loadConfig();
  const errors = validateConfig(config);

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join("\n")}`);
  }

  return config;
}

export default {
  loadConfig,
  validateConfig,
  getConfig,
  loadMemoryConfig,
  DEFAULTS,
  MEMORY_DEFAULTS,
};
