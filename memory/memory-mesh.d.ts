/**
 * Memory Mesh - Vector Memory Storage with LanceDB
 * Provides persistent semantic memory for YAMO OS using LanceDB backend
 *
 * CLI Interface:
 *   node tools/memory_mesh.js ingest '{"content": "...", "metadata": {...}}'
 *   node tools/memory_mesh.js search '{"query": "...", "limit": 10}'
 *   node tools/memory_mesh.js get '{"id": "..."}'
 *   node tools/memory_mesh.js delete '{"id": "..."}'
 *   node tools/memory_mesh.js stats '{}'
 *
 * Also supports STDIN input for YAMO skill compatibility:
 *   echo '{"action": "ingest", "content": "..."}' | node tools/memory_mesh.js
 */
import { LanceDBClient } from "./adapters/client.js";
import { Config } from "./adapters/config.js";
import EmbeddingFactory from "./embeddings/factory.js";
import { Scrubber } from "../scrubber/scrubber.js";
import { KeywordSearch } from "./search/keyword-search.js";
import { LLMClient } from "../llm/client.js";
import * as lancedb from "@lancedb/lancedb";
export interface MemoryMeshOptions {
    enableYamo?: boolean;
    enableLLM?: boolean;
    enableMemory?: boolean;
    agentId?: string;
    llmProvider?: string;
    llmApiKey?: string;
    llmModel?: string;
    llmMaxTokens?: number;
    skill_directories?: string | string[];
    dbDir?: string;
}
export interface MemoryEntry {
    id: string;
    content: string;
    vector: number[];
    metadata: string;
}
export interface SearchResult extends MemoryEntry {
    score: number;
    [key: string]: any;
}
export interface CacheEntry {
    result: SearchResult[];
    timestamp: number;
}
/**
 * MemoryMesh class for managing vector memory storage
 */
export declare class MemoryMesh {
    client: LanceDBClient | null;
    config: Config | null;
    embeddingFactory: EmbeddingFactory;
    keywordSearch: KeywordSearch;
    isInitialized: boolean;
    vectorDimension: number;
    enableYamo: boolean;
    enableLLM: boolean;
    enableMemory: boolean;
    agentId: string;
    yamoTable: lancedb.Table | null;
    skillTable: lancedb.Table | null;
    llmClient: LLMClient | null;
    scrubber: Scrubber;
    queryCache: Map<string, CacheEntry>;
    cacheConfig: {
        maxSize: number;
        ttlMs: number;
    };
    skillDirectories: string[];
    dbDir?: string;
    /**
     * Create a new MemoryMesh instance
     * @param {Object} [options={}]
     */
    constructor(options?: MemoryMeshOptions);
    /**
     * Generate a cache key from query and options
     * @private
     */
    _generateCacheKey(query: string, options?: any): string;
    /**
     * Get cached result if valid
     * @private
     *
     * Race condition fix: The delete-then-set pattern for LRU tracking creates a window
     * where another operation could observe the key as missing. We use a try-finally
     * pattern to ensure atomicity at the application level.
     */
    _getCachedResult(key: string): SearchResult[] | null;
    /**
     * Cache a search result
     * @private
     */
    _cacheResult(key: string, result: SearchResult[]): void;
    /**
     * Clear all cached results
     */
    clearCache(): void;
    /**
     * Get cache statistics
     */
    getCacheStats(): any;
    /**
     * Validate and sanitize metadata to prevent prototype pollution
     * @private
     */
    _validateMetadata(metadata: any): Record<string, any>;
    /**
     * Sanitize and validate content before storage
     * @private
     */
    _sanitizeContent(content: string): string;
    /**
     * Initialize the LanceDB client
     */
    init(): Promise<void>;
    /**
     * Add content to memory with auto-generated embedding and scrubbing.
     *
     * This is the primary method for storing information in the memory mesh.
     * The content goes through several processing steps:
     *
     * 1. **Scrubbing**: PII and sensitive data are sanitized (if enabled)
     * 2. **Validation**: Content length and metadata are validated
     * 3. **Embedding**: Content is converted to a vector representation
     * 4. **Storage**: Record is stored in LanceDB with metadata
     * 5. **Emission**: Optional YAMO block emitted for provenance tracking
     *
     * @param content - The text content to store in memory
     * @param metadata - Optional metadata (type, source, tags, etc.)
     * @returns Promise with memory record containing id, content, metadata, created_at
     *
     * @example
     * ```typescript
     * const memory = await mesh.add("User likes TypeScript", {
     *   type: "preference",
     *   source: "chat",
     *   tags: ["programming", "languages"]
     * });
     * ```
     *
     * @throws {Error} If content exceeds max length (100KB)
     * @throws {Error} If embedding generation fails
     * @throws {Error} If database client is not initialized
     */
    add(content: string, metadata?: any): Promise<any>;
    /**
     * Reflect on recent memories
     */
    reflect(options?: any): Promise<any>;
    /**
     * Ingest synthesized skill
     * @param sourceFilePath - If provided, skip file write (file already exists)
     */
    ingestSkill(yamoText: string, metadata?: any, sourceFilePath?: string): Promise<any>;
    /**
     * Recursive Skill Synthesis
     */
    synthesize(options?: any): Promise<any>;
    /**
     * Update reliability
     */
    updateSkillReliability(id: string, success: boolean): Promise<any>;
    /**
     * Prune skills
     */
    pruneSkills(threshold?: number): Promise<any>;
    /**
     * List all synthesized skills
     * @param {Object} [options={}] - Search options
     * @returns {Promise<Array>} Normalized skill results
     */
    listSkills(options?: any): Promise<any[]>;
    /**
     * Search for synthesized skills by semantic intent
     * @param {string} query - Search query (intent description)
     * @param {Object} [options={}] - Search options
     * @returns {Promise<Array>} Normalized skill results
     */
    searchSkills(query: string, options?: any): Promise<any[]>;
    /**
     * Get recent YAMO logs for the heartbeat
     * @param {Object} options
     */
    getYamoLog(options?: any): Promise<any[]>;
    /**
     * Emit a YAMO block to the YAMO blocks table
     * @private
     *
     * Note: YAMO emission is non-critical - failures are logged but don't throw
     * to prevent disrupting the main operation.
     */
    _emitYamoBlock(operationType: string, memoryId: string | undefined, yamoText: string): Promise<void>;
    /**
     * Search memory using hybrid vector + keyword search with Reciprocal Rank Fusion (RRF).
     *
     * This method performs semantic search by combining:
     * 1. **Vector Search**: Uses embeddings to find semantically similar content
     * 2. **Keyword Search**: Uses BM25-style keyword matching
     * 3. **RRF Fusion**: Combines both result sets using Reciprocal Rank Fusion
     *
     * The RRF algorithm scores each document as: `sum(1 / (k + rank))` where k=60.
     * This gives higher scores to documents that rank well in BOTH searches.
     *
     * **Performance**: Uses adaptive sorting strategy
     * - Small datasets (≤ 2× limit): Full sort O(n log n)
     * - Large datasets: Partial selection sort O(n×k) where k=limit
     *
     * **Caching**: Results are cached for 5 minutes by default (configurable via options)
     *
     * @param query - The search query text
     * @param options - Search options
     * @param options.limit - Maximum results to return (default: 10)
     * @param options.filter - LanceDB filter expression (e.g., "type == 'preference'")
     * @param options.useCache - Enable/disable result caching (default: true)
     * @returns Promise with array of search results, sorted by relevance score
     *
     * @example
     * ```typescript
     * // Simple search
     * const results = await mesh.search("TypeScript preferences");
     *
     * // Search with filter
     * const code = await mesh.search("bug fix", { filter: "type == 'error'" });
     *
     * // Search with limit
     * const top3 = await mesh.search("security issues", { limit: 3 });
     * ```
     *
     * @throws {Error} If embedding generation fails
     * @throws {Error} If database client is not initialized
     */
    search(query: string, options?: any): Promise<SearchResult[]>;
    _normalizeScores(results: SearchResult[]): SearchResult[];
    /**
     * Tokenize query for keyword matching (private helper for searchSkills)
     * Converts text to lowercase tokens, filtering out short tokens and punctuation.
     * Handles camelCase/PascalCase by splitting on uppercase letters.
     */
    private _tokenizeQuery;
    formatResults(results: SearchResult[]): string;
    get(id: string): Promise<any>;
    getAll(options?: any): Promise<any>;
    stats(): Promise<any>;
    _parseEmbeddingConfig(): any[];
    /**
     * Close database connections and release resources
     *
     * This should be called when done with the MemoryMesh to properly:
     * - Close LanceDB connections
     * - Release file handles
     * - Clean up resources
     *
     * Important for tests and cleanup to prevent connection leaks.
     *
     * @returns {Promise<void>}
     *
     * @example
     * ```typescript
     * const mesh = new MemoryMesh();
     * await mesh.init();
     * // ... use mesh ...
     * await mesh.close(); // Clean up
     * ```
     */
    close(): Promise<void>;
}
/**
 * Main CLI handler
 */
export declare function run(): Promise<void>;
export default MemoryMesh;
