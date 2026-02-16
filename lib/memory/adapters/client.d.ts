/**
 * LanceDB Client Wrapper
 *
 * A comprehensive wrapper around LanceDB JavaScript SDK providing:
 * - Connection management with pooling and retries
 * - CRUD operations for memory entries
 * - Vector similarity search with filtering
 * - Database statistics and monitoring
 *
 * @class LanceDBClient
 */
import * as lancedb from "@lancedb/lancedb";
/**
 * LanceDB driver interface for dependency injection/testing
 */
export interface LanceDBDriver {
    connect(uri: string): Promise<lancedb.Connection>;
}
export interface ClientConfig {
    uri?: string;
    tableName?: string;
    maxRetries?: number;
    retryDelay?: number;
    vectorDimension?: number;
    driver?: LanceDBDriver;
}
export interface MemoryEntry {
    id: string;
    vector: number[];
    content: string;
    metadata?: string | Record<string, any> | null;
    created_at?: Date | string;
    updated_at?: Date | string;
}
export interface SearchResult extends MemoryEntry {
    score?: number;
}
export interface SearchOptions {
    limit?: number;
    metric?: string;
    nprobes?: number;
    filter?: string | null;
}
export interface Stats {
    tableName: string;
    uri: string;
    count: number;
    isConnected: boolean;
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
    driver: LanceDBDriver;
    db: lancedb.Connection | null;
    table: lancedb.Table | null;
    isConnected: boolean;
    private tempDir?;
    /**
     * Create a new LanceDBClient instance
     * @param {Object} [config={}] - Configuration object
     */
    constructor(config?: ClientConfig);
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
    add(data: MemoryEntry): Promise<{
        id: string;
        success: boolean;
    }>;
    /**
     * Add multiple memory entries in batch
     * @param {Array<Object>} records - Array of entry data objects
     * @returns {Promise<Object>} Result with count of added records
     * @throws {StorageError} If batch add fails
     */
    addBatch(records: MemoryEntry[]): Promise<{
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
    search(vector: number[], options?: SearchOptions): Promise<SearchResult[]>;
    /**
     * Get a record by ID
     * @param {string} id - Record ID
     * @returns {Promise<Object|null>} Record object or null if not found
     * @throws {QueryError} If query fails
     */
    getById(id: string): Promise<MemoryEntry | null>;
    /**
     * Get all records from the database
     * @param {Object} options - Options
     * @returns {Promise<Array<Object>>} Array of all records
     */
    getAll(options?: {
        limit?: number;
    }): Promise<MemoryEntry[]>;
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
    update(id: string, data: Partial<MemoryEntry>): Promise<{
        id: string;
        success: boolean;
    }>;
    /**
     * Get database statistics
     * @returns {Promise<Object>} Statistics including count, size, etc.
     * @throws {QueryError} If stats query fails
     */
    getStats(): Promise<Stats>;
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
     * Sleep for a specified duration
     * @private
     */
    _sleep(ms: number): Promise<void>;
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
