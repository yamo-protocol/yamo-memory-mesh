/**
 * LanceDB Schema Definitions for MemoryManager
 * Uses Apache Arrow Schema format for LanceDB JavaScript SDK
 *
 * Supports dynamic vector dimensions for different embedding models:
 * - all-MiniLM-L6-v2: 384 dimensions
 * - all-mpnet-base-v2: 768 dimensions
 * - text-embedding-3-small: 1536 dimensions
 */
import * as arrow from "apache-arrow";
/**
 * Default vector dimension (all-MiniLM-L6-v2)
 */
export declare const DEFAULT_VECTOR_DIMENSION = 384;
/**
 * Common embedding model dimensions
 */
export declare const EMBEDDING_DIMENSIONS: {
    "Xenova/all-MiniLM-L6-v2": number;
    "Xenova/all-mpnet-base-v2": number;
    "Xenova/distiluse-base-multilingual-cased-v1": number;
    "sentence-transformers/all-MiniLM-L6-v2": number;
    "sentence-transformers/all-mpnet-base-v2": number;
    "openai/text-embedding-3-small": number;
    "openai/text-embedding-3-large": number;
    "cohere/embed-english-light-v3.0": number;
    "cohere/embed-english-v3.0": number;
};
/**
 * Get dimension for a given embedding model
 * @param {string} modelName - Embedding model name or path
 * @returns {number} Vector dimension
 */
export declare function getEmbeddingDimension(modelName: any): any;
/**
 * Create a memory schema with a specific vector dimension
 * @param {number} vectorDim - Vector dimension (e.g., 384, 768, 1536)
 * @returns {arrow.Schema} Arrow schema with specified dimension
 */
export declare function createMemorySchema(vectorDim?: number): arrow.Schema<any>;
/**
 * Create V2 memory schema with automatic recall fields
 * All new fields are nullable for backward compatibility
 * @param {number} vectorDim - Vector dimension (e.g., 384, 768, 1536)
 * @returns {arrow.Schema} Arrow schema with V2 fields
 */
export declare function createMemorySchemaV2(vectorDim?: number): arrow.Schema<any>;
/**
 * Create schema for synthesized skills (Recursive Skill Synthesis)
 * @param {number} vectorDim - Vector dimension for intent embedding
 * @returns {arrow.Schema} Arrow schema
 */
export declare function createSynthesizedSkillSchema(vectorDim?: number): arrow.Schema<any>;
/**
 * Check if a table is using V2 schema
 * @param {arrow.Schema} schema - Table schema to check
 * @returns {boolean} True if V2 schema detected
 */
export declare function isSchemaV2(schema: any): any;
/**
 * Migrate an existing table to V2:
 * 1. Migrate manifest paths to V2 layout (efficient versioning, idempotent)
 * 2. Add nullable V2 columns to memory_entries-style tables if not already present
 *
 * Safe to call on any table — non-memory tables skip the schema column additions.
 */
export declare function migrateTableV2(table: any): Promise<void>;
/**
 * Memory table schema using Apache Arrow format (default 384 dimensions)
 * @deprecated Use createMemorySchema(vectorDim) for dynamic dimensions
 */
export declare const MEMORY_SCHEMA: arrow.Schema<any>;
/**
 * Index configuration for memory table
 * Indices should be created after data is inserted
 */
export declare const INDEX_CONFIG: {
    vector: {
        index_type: string;
        metric: string;
        num_partitions: number;
        num_sub_vectors: number;
    };
    full_text: {
        fields: string[];
    };
};
/**
 * Creates a memory table in LanceDB with the predefined schema (384 dimensions)
 * @param {lancedb.Connection} db - LanceDB connection
 * @param {string} tableName - Name of the table to create (default: 'memory_entries')
 * @returns {Promise<lancedb.Table>} The created or opened table
 * @throws {Error} If table creation fails
 * @deprecated Use createMemoryTableWithDimension() for dynamic dimensions
 */
export declare function createMemoryTable(db: any, tableName?: string): Promise<any>;
/**
 * Creates a memory table in LanceDB with a specific vector dimension
 * @param {lancedb.Connection} db - LanceDB connection
 * @param {string} tableName - Name of the table to create
 * @param {number} vectorDim - Vector dimension (384, 768, 1536, etc.)
 * @returns {Promise<lancedb.Table>} The created or opened table
 * @throws {Error} If table creation fails
 */
export declare function createMemoryTableWithDimension(db: any, tableName: any, vectorDim: any): Promise<any>;
declare const _default: {
    MEMORY_SCHEMA: arrow.Schema<any>;
    INDEX_CONFIG: {
        vector: {
            index_type: string;
            metric: string;
            num_partitions: number;
            num_sub_vectors: number;
        };
        full_text: {
            fields: string[];
        };
    };
    createMemoryTable: typeof createMemoryTable;
    createMemoryTableWithDimension: typeof createMemoryTableWithDimension;
    createMemorySchema: typeof createMemorySchema;
    createMemorySchemaV2: typeof createMemorySchemaV2;
    isSchemaV2: typeof isSchemaV2;
    migrateTableV2: typeof migrateTableV2;
    getEmbeddingDimension: typeof getEmbeddingDimension;
    DEFAULT_VECTOR_DIMENSION: number;
    EMBEDDING_DIMENSIONS: {
        "Xenova/all-MiniLM-L6-v2": number;
        "Xenova/all-mpnet-base-v2": number;
        "Xenova/distiluse-base-multilingual-cased-v1": number;
        "sentence-transformers/all-MiniLM-L6-v2": number;
        "sentence-transformers/all-mpnet-base-v2": number;
        "openai/text-embedding-3-small": number;
        "openai/text-embedding-3-large": number;
        "cohere/embed-english-light-v3.0": number;
        "cohere/embed-english-v3.0": number;
    };
};
export default _default;
