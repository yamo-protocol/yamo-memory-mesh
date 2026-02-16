/**
 * Default configuration values
 */
export declare const DEFAULTS: {
    LANCEDB_URI: string;
    LANCEDB_MEMORY_TABLE: string;
    LANCEDB_MAX_CACHE_SIZE: string;
    EMBEDDING_MODEL_TYPE: string;
    EMBEDDING_MODEL_NAME: string;
    EMBEDDING_DIMENSION: string;
    EMBEDDING_BATCH_SIZE: string;
    EMBEDDING_NORMALIZE: string;
    OPENAI_EMBEDDING_MODEL: string;
    DEFAULT_TOP_K: string;
    DEFAULT_SIMILARITY_THRESHOLD: string;
    ENABLE_HYBRID_SEARCH: string;
    HYBRID_SEARCH_ALPHA: string;
    VECTOR_INDEX_TYPE: string;
    IVF_PARTITIONS: string;
    PQ_BITS: string;
    ENABLE_QUERY_CACHE: string;
    QUERY_CACHE_TTL: string;
};
/**
 * Memory system configuration defaults
 */
export declare const MEMORY_DEFAULTS: {
    MEMORY_ENABLED: string;
    MEMORY_AUTO_CAPTURE: string;
    MEMORY_AUTO_RECALL: string;
    MEMORY_MAX_CONTEXT: string;
    MEMORY_RELEVANCE_THRESHOLD: string;
    MEMORY_IMPORTANCE_BOOST: string;
    MEMORY_RECENCY_WEIGHT: string;
    MEMORY_MIN_IMPORTANCE: string;
    MEMORY_DEDUP_THRESHOLD: string;
    MEMORY_CAPTURE_TOOL_RESULTS: string;
    MEMORY_CAPTURE_FILE_OPS: string;
    MEMORY_RETENTION_ENABLED: string;
    MEMORY_RETENTION_DAYS: string;
    MEMORY_MAX_PER_SESSION: string;
    MEMORY_MIN_IMPORTANCE_TO_KEEP: string;
    MEMORY_REDACT_PII: string;
    MEMORY_ENCRYPTION_ENABLED: string;
};
/**
 * Load configuration with validation
 */
export declare function loadConfig(): {};
/**
 * Load memory-specific configuration
 * @returns {Object} Memory configuration object
 */
export declare function loadMemoryConfig(): {
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
};
/**
 * Validate configuration
 */
export declare function validateConfig(config: any): any[];
/**
 * Get validated configuration
 */
export declare function getConfig(): {};
declare const _default: {
    loadConfig: typeof loadConfig;
    validateConfig: typeof validateConfig;
    getConfig: typeof getConfig;
    loadMemoryConfig: typeof loadMemoryConfig;
    DEFAULTS: {
        LANCEDB_URI: string;
        LANCEDB_MEMORY_TABLE: string;
        LANCEDB_MAX_CACHE_SIZE: string;
        EMBEDDING_MODEL_TYPE: string;
        EMBEDDING_MODEL_NAME: string;
        EMBEDDING_DIMENSION: string;
        EMBEDDING_BATCH_SIZE: string;
        EMBEDDING_NORMALIZE: string;
        OPENAI_EMBEDDING_MODEL: string;
        DEFAULT_TOP_K: string;
        DEFAULT_SIMILARITY_THRESHOLD: string;
        ENABLE_HYBRID_SEARCH: string;
        HYBRID_SEARCH_ALPHA: string;
        VECTOR_INDEX_TYPE: string;
        IVF_PARTITIONS: string;
        PQ_BITS: string;
        ENABLE_QUERY_CACHE: string;
        QUERY_CACHE_TTL: string;
    };
    MEMORY_DEFAULTS: {
        MEMORY_ENABLED: string;
        MEMORY_AUTO_CAPTURE: string;
        MEMORY_AUTO_RECALL: string;
        MEMORY_MAX_CONTEXT: string;
        MEMORY_RELEVANCE_THRESHOLD: string;
        MEMORY_IMPORTANCE_BOOST: string;
        MEMORY_RECENCY_WEIGHT: string;
        MEMORY_MIN_IMPORTANCE: string;
        MEMORY_DEDUP_THRESHOLD: string;
        MEMORY_CAPTURE_TOOL_RESULTS: string;
        MEMORY_CAPTURE_FILE_OPS: string;
        MEMORY_RETENTION_ENABLED: string;
        MEMORY_RETENTION_DAYS: string;
        MEMORY_MAX_PER_SESSION: string;
        MEMORY_MIN_IMPORTANCE_TO_KEEP: string;
        MEMORY_REDACT_PII: string;
        MEMORY_ENCRYPTION_ENABLED: string;
    };
};
export default _default;
