/**
 * LanceDB Client wrapper class
 */
export declare class LanceDBClient {
    uri: any;
    tableName: any;
    maxRetries: any;
    retryDelay: any;
    vectorDimension: any;
    driver: any;
    db: any;
    table: any;
    isConnected: any;
    tempDir: any;
    /**
     * Create a new LanceDBClient instance
     * @param {Object} [config={}] - Configuration object
     */
    constructor(config?: {});
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
    add(data: any): Promise<any>;
    /**
     * Add multiple memory entries in batch
     * @param {Array<Object>} records - Array of entry data objects
     * @returns {Promise<Object>} Result with count of added records
     * @throws {StorageError} If batch add fails
     */
    addBatch(records: any): Promise<any>;
    /**
     * Search for similar vectors
     * @param {Array<number>} vector - Query vector (384 dimensions)
     * @param {Object} options - Search options
     * @returns {Promise<Array<Object>>} Array of search results with scores
     * @throws {QueryError} If search fails
     */
    search(vector: any, options?: {}): Promise<any>;
    /**
     * Get a record by ID
     * @param {string} id - Record ID
     * @returns {Promise<Object|null>} Record object or null if not found
     * @throws {QueryError} If query fails
     */
    getById(id: any): Promise<any>;
    /**
     * Get all records from the database
     * @param {Object} options - Options
     * @returns {Promise<Array<Object>>} Array of all records
     */
    getAll(options?: {}): Promise<any>;
    /**
     * Delete a record by ID
     * @param {string} id - Record ID to delete
     * @returns {Promise<Object>} Result with success status
     * @throws {StorageError} If delete fails
     */
    delete(id: any): Promise<any>;
    /**
     * Update an existing record
     * @param {string} id - Record ID to update
     * @param {Object} data - Updated data fields
     * @returns {Promise<Object>} Result with success status
     * @throws {StorageError} If update fails
     */
    update(id: any, data: any): Promise<any>;
    /**
     * Get database statistics
     * @returns {Promise<Object>} Statistics including count, size, etc.
     * @throws {QueryError} If stats query fails
     */
    getStats(): Promise<any>;
    /**
     * Sanitize an ID to prevent SQL injection
     * Removes any characters that aren't alphanumeric, underscore, or hyphen
     * @private
     */
    _sanitizeId(id: any): any;
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
    _sleep(ms: any): Promise<unknown>;
    /**
     * Check if an error is retryable (transient network/connection issues)
     * @private
     */
    _isRetryableError(error: any): boolean;
    /**
     * Retry an operation with exponential backoff
     * @private
     */
    _retryOperation(operation: any, maxRetries: any, baseDelay: any): Promise<any>;
}
export default LanceDBClient;
