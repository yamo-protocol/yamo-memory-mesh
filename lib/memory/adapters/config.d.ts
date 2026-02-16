/**
 * LanceDB Configuration Loader
 * Loads and validates configuration from environment variables
 */
/**
 * Default configuration values
 */
export declare const DEFAULTS: {
    readonly LANCEDB_URI: "./runtime/data/lancedb";
    readonly LANCEDB_MEMORY_TABLE: "memory_entries";
    readonly LANCEDB_MAX_CACHE_SIZE: "2GB";
    readonly EMBEDDING_MODEL_TYPE: "local";
    readonly EMBEDDING_MODEL_NAME: "Xenova/all-MiniLM-L6-v2";
    readonly EMBEDDING_DIMENSION: "384";
    readonly EMBEDDING_BATCH_SIZE: "32";
    readonly EMBEDDING_NORMALIZE: "true";
    readonly OPENAI_EMBEDDING_MODEL: "text-embedding-3-small";
    readonly DEFAULT_TOP_K: "10";
    readonly DEFAULT_SIMILARITY_THRESHOLD: "0.7";
    readonly ENABLE_HYBRID_SEARCH: "true";
    readonly HYBRID_SEARCH_ALPHA: "0.5";
    readonly VECTOR_INDEX_TYPE: "ivf_pq";
    readonly IVF_PARTITIONS: "256";
    readonly PQ_BITS: "8";
    readonly ENABLE_QUERY_CACHE: "true";
    readonly QUERY_CACHE_TTL: "300";
};
export type ConfigKey = keyof typeof DEFAULTS;
export type Config = Record<ConfigKey, string>;
/**
 * Memory system configuration defaults
 */
export declare const MEMORY_DEFAULTS: {
    readonly MEMORY_ENABLED: "true";
    readonly MEMORY_AUTO_CAPTURE: "true";
    readonly MEMORY_AUTO_RECALL: "true";
    readonly MEMORY_MAX_CONTEXT: "5";
    readonly MEMORY_RELEVANCE_THRESHOLD: "0.7";
    readonly MEMORY_IMPORTANCE_BOOST: "1.5";
    readonly MEMORY_RECENCY_WEIGHT: "0.3";
    readonly MEMORY_MIN_IMPORTANCE: "0.3";
    readonly MEMORY_DEDUP_THRESHOLD: "0.9";
    readonly MEMORY_CAPTURE_TOOL_RESULTS: "true";
    readonly MEMORY_CAPTURE_FILE_OPS: "true";
    readonly MEMORY_RETENTION_ENABLED: "true";
    readonly MEMORY_RETENTION_DAYS: "90";
    readonly MEMORY_MAX_PER_SESSION: "100";
    readonly MEMORY_MIN_IMPORTANCE_TO_KEEP: "0.5";
    readonly MEMORY_REDACT_PII: "false";
    readonly MEMORY_ENCRYPTION_ENABLED: "false";
};
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
export declare function loadConfig(): Config;
/**
 * Load memory-specific configuration
 * @returns {Object} Memory configuration object
 */
export declare function loadMemoryConfig(): MemoryConfig;
/**
 * Validate configuration
 */
export declare function validateConfig(config: Config): string[];
/**
 * Get validated configuration
 */
export declare function getConfig(): Config;
declare const _default: {
    loadConfig: typeof loadConfig;
    validateConfig: typeof validateConfig;
    getConfig: typeof getConfig;
    loadMemoryConfig: typeof loadMemoryConfig;
    DEFAULTS: {
        readonly LANCEDB_URI: "./runtime/data/lancedb";
        readonly LANCEDB_MEMORY_TABLE: "memory_entries";
        readonly LANCEDB_MAX_CACHE_SIZE: "2GB";
        readonly EMBEDDING_MODEL_TYPE: "local";
        readonly EMBEDDING_MODEL_NAME: "Xenova/all-MiniLM-L6-v2";
        readonly EMBEDDING_DIMENSION: "384";
        readonly EMBEDDING_BATCH_SIZE: "32";
        readonly EMBEDDING_NORMALIZE: "true";
        readonly OPENAI_EMBEDDING_MODEL: "text-embedding-3-small";
        readonly DEFAULT_TOP_K: "10";
        readonly DEFAULT_SIMILARITY_THRESHOLD: "0.7";
        readonly ENABLE_HYBRID_SEARCH: "true";
        readonly HYBRID_SEARCH_ALPHA: "0.5";
        readonly VECTOR_INDEX_TYPE: "ivf_pq";
        readonly IVF_PARTITIONS: "256";
        readonly PQ_BITS: "8";
        readonly ENABLE_QUERY_CACHE: "true";
        readonly QUERY_CACHE_TTL: "300";
    };
    MEMORY_DEFAULTS: {
        readonly MEMORY_ENABLED: "true";
        readonly MEMORY_AUTO_CAPTURE: "true";
        readonly MEMORY_AUTO_RECALL: "true";
        readonly MEMORY_MAX_CONTEXT: "5";
        readonly MEMORY_RELEVANCE_THRESHOLD: "0.7";
        readonly MEMORY_IMPORTANCE_BOOST: "1.5";
        readonly MEMORY_RECENCY_WEIGHT: "0.3";
        readonly MEMORY_MIN_IMPORTANCE: "0.3";
        readonly MEMORY_DEDUP_THRESHOLD: "0.9";
        readonly MEMORY_CAPTURE_TOOL_RESULTS: "true";
        readonly MEMORY_CAPTURE_FILE_OPS: "true";
        readonly MEMORY_RETENTION_ENABLED: "true";
        readonly MEMORY_RETENTION_DAYS: "90";
        readonly MEMORY_MAX_PER_SESSION: "100";
        readonly MEMORY_MIN_IMPORTANCE_TO_KEEP: "0.5";
        readonly MEMORY_REDACT_PII: "false";
        readonly MEMORY_ENCRYPTION_ENABLED: "false";
    };
};
export default _default;
