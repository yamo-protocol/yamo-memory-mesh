/**
 * A stored memory row as returned by the read methods of this client.
 * `metadata` is already JSON-parsed (or null); the raw column is a JSON string.
 */
export interface MemoryRecord {
    id: string;
    content: string;
    metadata: Record<string, any> | null;
    vector: number[];
    created_at?: any;
    updated_at?: any;
    superseded_at?: any;
    state?: string | null;
    pinned?: boolean | null;
    defer_until?: any;
    importance_score?: number | null;
    memory_type?: string | null;
    access_count?: number | null;
    last_accessed?: any;
    session_id?: string | null;
    agent_id?: string | null;
}
/** A {@link MemoryRecord} plus the similarity/relevance score from a search. */
export interface SearchResult extends MemoryRecord {
    score: number;
}
/**
 * LanceDB Client wrapper class
 */
export declare class LanceDBClient {
    uri: string;
    tableName: string;
    maxRetries: number;
    retryDelay: number;
    vectorDimension: number;
    driver: any;
    db: any;
    table: any;
    isConnected: boolean;
    tempDir: any;
    _exitHookListener: any;
    /**
     * Create a new LanceDBClient instance
     * @param {Object} [config={}] - Configuration object
     */
    constructor(config?: {
        uri?: string;
        tableName?: string;
        maxRetries?: number;
        retryDelay?: number;
        vectorDimension?: number;
        driver?: any;
    });
    /**
     * Connect to LanceDB and initialize table
     * Creates the database directory and table if they don't exist
     * @returns {Promise<void>}
     * @throws {StorageError} If connection fails after retries
     */
    connect(): Promise<void>;
    /**
     * Disconnect from LanceDB
     * @returns {Promise<void>}
     */
    disconnect(): void;
    /**
     * Add a single memory entry
     * @param {Object} data - Entry data
     * @returns {Promise<Object>} Result with id and success status
     * @throws {StorageError} If add operation fails
     */
    add(data: any): Promise<{
        id: any;
        success: boolean;
    }>;
    /**
     * Add multiple memory entries in batch
     * @param {Array<Object>} records - Array of entry data objects
     * @returns {Promise<Object>} Result with count of added records
     * @throws {StorageError} If batch add fails
     */
    addBatch(records: any[]): Promise<{
        count: number;
        success: boolean;
    }>;
    /**
     * Search for similar vectors
     * @param {Array<number>} vector - Query vector (384 dimensions)
     * @param {Object} options - Search options
     * @returns {Promise<Array<Object>>} Array of search results with scores
     * @throws {QueryError} If search fails
     */
    search(vector: number[], options?: {
        limit?: number;
        nprobes?: number;
        filter?: string | null;
        refineFactor?: number;
        timeoutMs?: number;
    }): Promise<SearchResult[]>;
    /**
     * Search for records using Full-Text Search (FTS)
     * @param {string} queryText - Query text to search for
     * @param {Object} options - Search options
     * @returns {Promise<Array<Object>>} Array of search results with BM25 scores
     * @throws {QueryError} If search fails
     */
    searchFts(queryText: string, options?: {
        limit?: number;
        filter?: string | null;
        timeoutMs?: number;
    }): Promise<SearchResult[]>;
    /**
     * Get a record by ID
     * @param {string} id - Record ID
     * @returns {Promise<Object|null>} Record object or null if not found
     * @throws {QueryError} If query fails
     */
    getById(id: string): Promise<MemoryRecord | null>;
    /**
     * Get all records from the database
     * @param {Object} options - Options
     * @returns {Promise<Array<Object>>} Array of all records
     */
    getAll(options?: {
        limit?: number;
    }): Promise<MemoryRecord[]>;
    /**
     * Get records matching a filter expression
     * @param {string} filter - SQL-like filter expression
     * @param {Object} [options={}] - Query options
     * @returns {Promise<Array<Object>>} Array of matching records
     */
    getWhere(filter: string, options?: {
        limit?: number;
    }): Promise<MemoryRecord[]>;
    /**
     * Delete a record by ID
     * @param {string} id - Record ID to delete
     * @returns {Promise<Object>} Result with success status
     * @throws {StorageError} If delete fails
     */
    delete(id: string): Promise<{
        id: string;
        success: boolean;
    }>;
    /**
     * Update an existing record
     * @param {string} id - Record ID to update
     * @param {Object} data - Updated data fields
     * @returns {Promise<Object>} Result with success status
     * @throws {StorageError} If update fails
     */
    update(id: string, data: any): Promise<{
        id: string;
        success: boolean;
    }>;
    /**
     * Get database statistics
     * @returns {Promise<Object>} Statistics including count, size, etc.
     * @throws {QueryError} If stats query fails
     */
    getStats(): Promise<{
        tableName: string;
        uri: string;
        count: number;
        isConnected: boolean;
    }>;
    /**
     * Compact old data files and prune versions older than 7 days.
     * Best-effort — never throws.
     */
    optimize(): Promise<void>;
    /**
     * Sanitize an ID to prevent SQL injection
     * Removes any characters that aren't alphanumeric, underscore, or hyphen
     * @private
     */
    _sanitizeId(id: string): string;
    /**
     * Validate a record object
     * @private
     */
    _validateRecord(record: any): void;
    /**
     * Validate a vector array
     * @private
     */
    _validateVector(vector: any): void;
    /**
     * Refresh table handle if it becomes stale (e.g. after background compaction)
     */
    refresh(): Promise<void>;
    /**
     * Register exit hook to clean up temp directories on process crash/termination
     * @private
     */
    _registerExitHook(): void;
    /**
     * Sleep for a specified duration
     * @private
     */
    _sleep(ms: number): Promise<unknown>;
    /**
     * Check if an error is retryable (transient network/connection issues)
     * @private
     */
    _isRetryableError(error: any): boolean;
    /**
     * Retry an operation with exponential backoff
     * @private
     */
    _retryOperation<T>(operation: () => Promise<T>, maxRetries?: number, baseDelay?: number): Promise<T>;
}
export default LanceDBClient;
