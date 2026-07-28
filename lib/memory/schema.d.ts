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
 * Common embedding model dimensions. Used by getEmbeddingDimension() to
 * size the LanceDB vector column. Matryoshka-capable models (Nomic v1.5,
 * Jina v3, Arctic v2) can be stored at a smaller dimension by passing
 * EMBEDDING_DIMENSION explicitly — the embed call will truncate + renorm.
 */
export declare const EMBEDDING_DIMENSIONS: {
    "Xenova/all-MiniLM-L6-v2": number;
    "Xenova/all-mpnet-base-v2": number;
    "Xenova/distiluse-base-multilingual-cased-v1": number;
    "sentence-transformers/all-MiniLM-L6-v2": number;
    "sentence-transformers/all-mpnet-base-v2": number;
    "Xenova/bge-base-en-v1.5": number;
    "Xenova/bge-large-en-v1.5": number;
    "Xenova/bge-small-en-v1.5": number;
    "Xenova/bge-m3": number;
    "BAAI/bge-base-en-v1.5": number;
    "BAAI/bge-large-en-v1.5": number;
    "BAAI/bge-m3": number;
    "Xenova/nomic-embed-text-v1": number;
    "Xenova/nomic-embed-text-v1.5": number;
    "nomic-ai/nomic-embed-text-v1.5": number;
    "Xenova/jina-embeddings-v2-base-en": number;
    "jinaai/jina-embeddings-v3": number;
    "intfloat/e5-base-v2": number;
    "intfloat/multilingual-e5-large": number;
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
export declare function getEmbeddingDimension(modelName: string): number;
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
 * Controlled vocabulary for the memory lifecycle `state` column.
 * `null` on legacy rows is read as 'active'. `superseded` is kept consistent
 * with the `superseded_at` timestamp by the belief-revision write path.
 */
export declare const MEMORY_STATES: readonly ["active", "superseded", "deprecated", "archived"];
export type MemoryState = (typeof MEMORY_STATES)[number];
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
 * Ensure the vector column has an IVF_PQ index.
 * Skipped when: table has too few rows, index already exists, or table is a mock.
 * Called automatically by createMemoryTableWithDimension after migration.
 */
export declare function ensureVectorIndex(table: any): Promise<void>;
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
        metric: "cosine";
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
export declare function createMemoryTableWithDimension(db: any, tableName: string, vectorDim: number): Promise<any>;
/**
 * Ensure the content column has a Full-Text Search (FTS) index.
 * Called automatically by createMemoryTableWithDimension after migration.
 */
export declare function ensureFtsIndex(table: any): Promise<void>;
/**
 * Create Graph-RAG Edges Table Schema
 * Columns: id, source, target, relation, weight, created_at
 */
export declare function createGraphSchema(): arrow.Schema<any>;
/**
 * Creates/opens a graph_edges table in LanceDB
 */
export declare function createGraphTable(db: any, tableName?: string): Promise<any>;
/**
 * Controlled vocabulary for decision_edges.relation.
 *
 * Edge direction is invariant: source_id is ALWAYS the newer memory and
 * target_id ALWAYS pre-exists at write time. This keeps the write path free
 * of dangling targets and lets traversal walk either direction.
 *
 *   supersedes   — the new decision replaces the (now superseded) target
 *   depends-on   — the new decision rests on a still-active target decision
 *   justified-by — the new decision is grounded in the target evidence/memory
 *   contradicts  — the new decision conflicts with the (retained) target
 */
export declare const DECISION_RELATIONS: readonly ["supersedes", "depends-on", "justified-by", "contradicts"];
export type DecisionRelation = (typeof DECISION_RELATIONS)[number];
/**
 * Create Decision Context Graph edge table schema.
 *
 * Distinct from graph_edges (free-text entity triples used only to boost
 * Graph-RAG retrieval). Here nodes are memory IDs and `relation` is a
 * controlled decision vocabulary — this table is for reasoning-audit
 * traversal, not retrieval scoring.
 *
 * Columns: id, source_id, target_id, relation, rationale, weight, created_at
 */
export declare function createDecisionEdgeSchema(): arrow.Schema<any>;
/**
 * Creates/opens a decision_edges table in LanceDB
 */
export declare function createDecisionEdgeTable(db: any, tableName?: string): Promise<any>;
/**
 * Create memory_revisions table schema (workspace-g9p.3).
 *
 * Append-only mutation history — the Dolt principle without Dolt. Every
 * in-place mutation (outcome recording, state change, pin/unpin, belief
 * revision, skill reliability walk, delete) appends one row per changed
 * field. Rows are never updated or deleted; `history()` reads them back
 * ordered by created_at.
 *
 * Columns: id, memory_id, field, old_value, new_value, actor, created_at.
 * old_value/new_value are JSON-encoded strings (null for absent).
 */
export declare function createRevisionSchema(): arrow.Schema<any>;
/**
 * Creates/opens a memory_revisions table in LanceDB
 */
export declare function createRevisionTable(db: any, tableName?: string): Promise<any>;
declare const _default: {
    MEMORY_SCHEMA: arrow.Schema<any>;
    INDEX_CONFIG: {
        vector: {
            index_type: string;
            metric: "cosine";
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
    ensureVectorIndex: typeof ensureVectorIndex;
    ensureFtsIndex: typeof ensureFtsIndex;
    getEmbeddingDimension: typeof getEmbeddingDimension;
    DEFAULT_VECTOR_DIMENSION: number;
    EMBEDDING_DIMENSIONS: {
        "Xenova/all-MiniLM-L6-v2": number;
        "Xenova/all-mpnet-base-v2": number;
        "Xenova/distiluse-base-multilingual-cased-v1": number;
        "sentence-transformers/all-MiniLM-L6-v2": number;
        "sentence-transformers/all-mpnet-base-v2": number;
        "Xenova/bge-base-en-v1.5": number;
        "Xenova/bge-large-en-v1.5": number;
        "Xenova/bge-small-en-v1.5": number;
        "Xenova/bge-m3": number;
        "BAAI/bge-base-en-v1.5": number;
        "BAAI/bge-large-en-v1.5": number;
        "BAAI/bge-m3": number;
        "Xenova/nomic-embed-text-v1": number;
        "Xenova/nomic-embed-text-v1.5": number;
        "nomic-ai/nomic-embed-text-v1.5": number;
        "Xenova/jina-embeddings-v2-base-en": number;
        "jinaai/jina-embeddings-v3": number;
        "intfloat/e5-base-v2": number;
        "intfloat/multilingual-e5-large": number;
        "openai/text-embedding-3-small": number;
        "openai/text-embedding-3-large": number;
        "cohere/embed-english-light-v3.0": number;
        "cohere/embed-english-v3.0": number;
    };
    createGraphSchema: typeof createGraphSchema;
    createGraphTable: typeof createGraphTable;
    MEMORY_STATES: readonly ["active", "superseded", "deprecated", "archived"];
    createRevisionSchema: typeof createRevisionSchema;
    createRevisionTable: typeof createRevisionTable;
};
export default _default;
