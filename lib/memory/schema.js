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
export const DEFAULT_VECTOR_DIMENSION = 384;
/**
 * Common embedding model dimensions
 */
export const EMBEDDING_DIMENSIONS = {
    "Xenova/all-MiniLM-L6-v2": 384,
    "Xenova/all-mpnet-base-v2": 768,
    "Xenova/distiluse-base-multilingual-cased-v1": 512,
    "sentence-transformers/all-MiniLM-L6-v2": 384,
    "sentence-transformers/all-mpnet-base-v2": 768,
    "openai/text-embedding-3-small": 1536,
    "openai/text-embedding-3-large": 3072,
    "cohere/embed-english-light-v3.0": 1024,
    "cohere/embed-english-v3.0": 1024,
};
/**
 * Get dimension for a given embedding model
 * @param {string} modelName - Embedding model name or path
 * @returns {number} Vector dimension
 */
export function getEmbeddingDimension(modelName) {
    if (!modelName) {
        return DEFAULT_VECTOR_DIMENSION;
    }
    // Check exact match
    if (EMBEDDING_DIMENSIONS[modelName]) {
        return EMBEDDING_DIMENSIONS[modelName];
    }
    // Check for partial matches
    for (const [key, dimension] of Object.entries(EMBEDDING_DIMENSIONS)) {
        if (modelName.toLowerCase().includes(key.toLowerCase())) {
            return dimension;
        }
    }
    // Fallback to default
    return DEFAULT_VECTOR_DIMENSION;
}
/**
 * Create a memory schema with a specific vector dimension
 * @param {number} vectorDim - Vector dimension (e.g., 384, 768, 1536)
 * @returns {arrow.Schema} Arrow schema with specified dimension
 */
export function createMemorySchema(vectorDim = DEFAULT_VECTOR_DIMENSION) {
    return new arrow.Schema([
        new arrow.Field("id", new arrow.Utf8(), false),
        new arrow.Field("vector", new arrow.FixedSizeList(vectorDim, new arrow.Field("item", new arrow.Float32(), true)), false),
        new arrow.Field("content", new arrow.Utf8(), false),
        new arrow.Field("metadata", new arrow.Utf8(), true), // Stored as JSON string
        new arrow.Field("created_at", new arrow.Timestamp(arrow.TimeUnit.MILLISECOND), false),
        new arrow.Field("updated_at", new arrow.Timestamp(arrow.TimeUnit.MILLISECOND), true),
    ]);
}
/**
 * Create V2 memory schema with automatic recall fields
 * All new fields are nullable for backward compatibility
 * @param {number} vectorDim - Vector dimension (e.g., 384, 768, 1536)
 * @returns {arrow.Schema} Arrow schema with V2 fields
 */
export function createMemorySchemaV2(vectorDim = DEFAULT_VECTOR_DIMENSION) {
    return new arrow.Schema([
        // ========== V1 Fields (Backward Compatible) ==========
        new arrow.Field("id", new arrow.Utf8(), false),
        new arrow.Field("vector", new arrow.FixedSizeList(vectorDim, new arrow.Field("item", new arrow.Float32(), true)), false),
        new arrow.Field("content", new arrow.Utf8(), false),
        new arrow.Field("metadata", new arrow.Utf8(), true),
        new arrow.Field("created_at", new arrow.Timestamp(arrow.TimeUnit.MILLISECOND), false),
        new arrow.Field("updated_at", new arrow.Timestamp(arrow.TimeUnit.MILLISECOND), true),
        // ========== V2 Fields (All Nullable) ==========
        new arrow.Field("session_id", new arrow.Utf8(), true), // Session association
        new arrow.Field("agent_id", new arrow.Utf8(), true), // Agent/skill that created memory
        new arrow.Field("memory_type", new arrow.Utf8(), true), // 'global', 'session', 'agent'
        new arrow.Field("importance_score", new arrow.Float32(), true), // 0.0-1.0 importance
        new arrow.Field("access_count", new arrow.Int32(), true), // Popularity tracking
        new arrow.Field("last_accessed", new arrow.Timestamp(arrow.TimeUnit.MILLISECOND), true),
    ]);
}
/**
 * Create schema for synthesized skills (Recursive Skill Synthesis)
 * @param {number} vectorDim - Vector dimension for intent embedding
 * @returns {arrow.Schema} Arrow schema
 */
export function createSynthesizedSkillSchema(vectorDim = DEFAULT_VECTOR_DIMENSION) {
    return new arrow.Schema([
        new arrow.Field("id", new arrow.Utf8(), false),
        new arrow.Field("name", new arrow.Utf8(), false),
        new arrow.Field("intent", new arrow.Utf8(), false),
        new arrow.Field("yamo_text", new arrow.Utf8(), false),
        new arrow.Field("vector", new arrow.FixedSizeList(vectorDim, new arrow.Field("item", new arrow.Float32(), true)), false),
        new arrow.Field("metadata", new arrow.Utf8(), true), // Stored as JSON: {reliability, use_count, created_at}
        new arrow.Field("created_at", new arrow.Timestamp(arrow.TimeUnit.MILLISECOND), false),
    ]);
}
/**
 * Check if a table is using V2 schema
 * @param {arrow.Schema} schema - Table schema to check
 * @returns {boolean} True if V2 schema detected
 */
export function isSchemaV2(schema) {
    return schema.fields.some((f) => f.name === "session_id");
}
/**
 * Memory table schema using Apache Arrow format (default 384 dimensions)
 * @deprecated Use createMemorySchema(vectorDim) for dynamic dimensions
 */
export const MEMORY_SCHEMA = createMemorySchema(DEFAULT_VECTOR_DIMENSION);
/**
 * Index configuration for memory table
 * Indices should be created after data is inserted
 */
export const INDEX_CONFIG = {
    vector: {
        index_type: "ivf_pq",
        metric: "cosine",
        num_partitions: 256,
        num_sub_vectors: 8,
    },
    full_text: {
        fields: ["content"],
    },
};
/**
 * Creates a memory table in LanceDB with the predefined schema (384 dimensions)
 * @param {lancedb.Connection} db - LanceDB connection
 * @param {string} tableName - Name of the table to create (default: 'memory_entries')
 * @returns {Promise<lancedb.Table>} The created or opened table
 * @throws {Error} If table creation fails
 * @deprecated Use createMemoryTableWithDimension() for dynamic dimensions
 */
export async function createMemoryTable(db, tableName = "memory_entries") {
    return createMemoryTableWithDimension(db, tableName, DEFAULT_VECTOR_DIMENSION);
}
/**
 * Creates a memory table in LanceDB with a specific vector dimension
 * @param {lancedb.Connection} db - LanceDB connection
 * @param {string} tableName - Name of the table to create
 * @param {number} vectorDim - Vector dimension (384, 768, 1536, etc.)
 * @returns {Promise<lancedb.Table>} The created or opened table
 * @throws {Error} If table creation fails
 */
export async function createMemoryTableWithDimension(db, tableName, vectorDim) {
    try {
        // Check if table already exists
        const existingTables = await db.tableNames();
        if (existingTables.includes(tableName)) {
            return await db.openTable(tableName);
        }
        // Create schema with specified dimension
        const schema = createMemorySchema(vectorDim);
        // Create table with schema
        // LanceDB v0.23.0+ accepts empty array as initial data with schema option
        const table = await db.createTable(tableName, [], { schema }); // Cast to any because lancedb types might be strict about options
        return table;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to create memory table with dimension ${vectorDim}: ${message}`);
    }
}
export default {
    MEMORY_SCHEMA,
    INDEX_CONFIG,
    createMemoryTable,
    createMemoryTableWithDimension,
    createMemorySchema,
    createMemorySchemaV2,
    isSchemaV2,
    getEmbeddingDimension,
    DEFAULT_VECTOR_DIMENSION,
    EMBEDDING_DIMENSIONS,
};
