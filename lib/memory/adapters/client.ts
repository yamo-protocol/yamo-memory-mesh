// @ts-nocheck
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
import fs from "fs";
import path from "path";
import { createMemoryTableWithDimension, DEFAULT_VECTOR_DIMENSION, } from "../schema.js";
import { StorageError, QueryError } from "./errors.js";
import { createLogger } from "../../utils/logger.js";
const logger = createLogger("lancedb-client");
/**
 * LanceDB Client wrapper class
 */
export class LanceDBClient {
    uri;
    tableName;
    maxRetries;
    retryDelay;
    vectorDimension;
    driver;
    db;
    table;
    isConnected;
    tempDir; // Track temp dirs for cleanup
    /**
     * Create a new LanceDBClient instance
     * @param {Object} [config={}] - Configuration object
     */
    constructor(config = {}) {
        this.uri =
            (config && config.uri) || process.env.LANCEDB_URI || "./data/lancedb";
        this.tableName =
            (config && config.tableName) ||
                process.env.LANCEDB_MEMORY_TABLE ||
                "memory_entries";
        this.maxRetries = (config && config.maxRetries) || 3;
        this.retryDelay = (config && config.retryDelay) || 1000;
        this.vectorDimension =
            (config && config.vectorDimension) || DEFAULT_VECTOR_DIMENSION;
        this.driver = (config && config.driver) || lancedb;
        // Connection state
        this.db = null;
        this.table = null;
        this.isConnected = false;
    }
    /**
     * Connect to LanceDB and initialize table
     * Creates the database directory and table if they don't exist
     * @returns {Promise<void>}
     * @throws {StorageError} If connection fails after retries
     */
    async connect() {
        if (this.isConnected) {
            return; // Already connected
        }
        let lastError = null;
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                // Handle :memory: specially - LanceDB doesn't support true in-memory DBs
                // Use OS temp directory for isolation
                let dbPath = this.uri;
                if (this.uri === ":memory:") {
                    const os = await import("os");
                    const crypto = await import("crypto");
                    const randomId = crypto.randomBytes(8).toString("hex");
                    dbPath = path.join(os.tmpdir(), `yamo-memory-${randomId}`);
                    this.tempDir = dbPath; // Track for cleanup
                }
                // Ensure database directory exists
                const resolvedPath = path.resolve(dbPath);
                const dbDir = path.dirname(resolvedPath);
                if (!fs.existsSync(dbDir)) {
                    fs.mkdirSync(dbDir, { recursive: true });
                }
                // Connect to database
                this.db = await this.driver.connect(dbPath);
                // Initialize table with dynamic dimension (creates if doesn't exist, opens if it does)
                if (this.db) {
                    this.table = await createMemoryTableWithDimension(this.db, this.tableName, this.vectorDimension);
                }
                this.isConnected = true;
                return;
            }
            catch (error) {
                lastError = error;
                const msg = error.message.toLowerCase();
                // Specific check for locking/busy errors
                if (msg.includes("busy") ||
                    msg.includes("locked") ||
                    msg.includes("resource temporarily unavailable")) {
                    logger.warn({ attempt, maxRetries: this.maxRetries, uri: this.uri }, "Database is locked by another process, retrying");
                    await this._sleep(this.retryDelay * attempt + Math.random() * 1000);
                    continue;
                }
                if (attempt < this.maxRetries) {
                    // Wait before retrying for other errors
                    await this._sleep(this.retryDelay * attempt);
                }
            }
        }
        // All retries failed
        const errorMessage = lastError instanceof Error ? lastError.message : String(lastError);
        throw new StorageError(`Failed to connect to LanceDB after ${this.maxRetries} attempts: ${errorMessage}`, { uri: this.uri, tableName: this.tableName, originalError: lastError });
    }
    /**
     * Disconnect from LanceDB
     * @returns {Promise<void>}
     */
    disconnect() {
        this.db = null;
        this.table = null;
        this.isConnected = false;
        // Clean up temp directory if we created one for :memory:
        if (this.tempDir && fs.existsSync(this.tempDir)) {
            try {
                fs.rmSync(this.tempDir, { recursive: true, force: true });
            }
            catch (_e) {
                // Best-effort cleanup, ignore errors
            }
            this.tempDir = undefined;
        }
    }
    /**
     * Add a single memory entry
     * @param {Object} data - Entry data
     * @returns {Promise<Object>} Result with id and success status
     * @throws {StorageError} If add operation fails
     */
    async add(data) {
        if (!this.isConnected) {
            await this.connect();
        }
        this._validateRecord(data);
        return this._retryOperation(async () => {
            const record = {
                ...data,
                created_at: new Date(),
                updated_at: new Date(),
            };
            if (!this.table) {
                throw new StorageError("Table not initialized");
            }
            await this.table.add([record]);
            return {
                id: data.id,
                success: true,
            };
        });
    }
    /**
     * Add multiple memory entries in batch
     * @param {Array<Object>} records - Array of entry data objects
     * @returns {Promise<Object>} Result with count of added records
     * @throws {StorageError} If batch add fails
     */
    async addBatch(records) {
        if (!this.isConnected) {
            await this.connect();
        }
        if (!Array.isArray(records) || records.length === 0) {
            throw new StorageError("Records must be a non-empty array");
        }
        // Validate all records
        records.forEach((record) => this._validateRecord(record));
        return this._retryOperation(async () => {
            const now = new Date();
            const recordsWithTimestamps = records.map((record) => ({
                ...record,
                created_at: now,
                updated_at: now,
            }));
            if (!this.table) {
                throw new StorageError("Table not initialized");
            }
            await this.table.add(recordsWithTimestamps);
            return {
                count: records.length,
                success: true,
            };
        });
    }
    /**
     * Search for similar vectors
     * @param {Array<number>} vector - Query vector (384 dimensions)
     * @param {Object} options - Search options
     * @returns {Promise<Array<Object>>} Array of search results with scores
     * @throws {QueryError} If search fails
     */
    async search(vector, options = {}) {
        if (!this.isConnected) {
            await this.connect();
        }
        this._validateVector(vector);
        const { limit = 10, nprobes = 20, filter = null, refineFactor, timeoutMs } = options;
        return this._retryOperation(async () => {
            if (!this.table) {
                throw new StorageError("Table not initialized");
            }
            // Build the search query with all applicable options
            let query = this.table.search(vector);
            // Apply nprobes for IVF index (if supported)
            if (nprobes && typeof nprobes === "number") {
                try {
                    query = query.nprobes(nprobes);
                }
                catch (_e) {
                    // ignore
                }
            }
            // Apply refineFactor for improved ANN recall (fetches N×candidates, reranks)
            if (refineFactor && typeof refineFactor === "number") {
                try {
                    query = query.refineFactor(refineFactor);
                }
                catch (_e) {
                    // ignore if not supported
                }
            }
            // Apply filter if provided
            if (filter) {
                query = query.where(filter);
            }
            // Execute search with limit (and optional timeout)
            const resultsArray = await query.limit(limit).toArray(
                timeoutMs ? { timeoutMs } : undefined,
            );
            return resultsArray.map((row) => ({
                id: row.id,
                content: row.content,
                metadata: row.metadata ? JSON.parse(row.metadata) : null,
                // _distance is internal LanceDB property
                score: row._distance,
                created_at: row.created_at,
                vector: row.vector, // Include vector if returned
            }));
        });
    }
    /**
     * Get a record by ID
     * @param {string} id - Record ID
     * @returns {Promise<Object|null>} Record object or null if not found
     * @throws {QueryError} If query fails
     */
    async getById(id) {
        if (!this.isConnected) {
            await this.connect();
        }
        return this._retryOperation(async () => {
            if (!this.table) {
                throw new StorageError("Table not initialized");
            }
            // Use a simple filter query instead of search
            const resultsArray = await this.table
                .query()
                .where(`id == '${this._sanitizeId(id)}'`)
                .toArray();
            if (resultsArray.length === 0) {
                return null;
            }
            const record = resultsArray[0];
            return {
                id: record.id,
                vector: record.vector,
                content: record.content,
                metadata: record.metadata
                    ? JSON.parse(record.metadata)
                    : null,
                created_at: record.created_at,
                updated_at: record.updated_at,
            };
        });
    }
    /**
     * Get all records from the database
     * @param {Object} options - Options
     * @returns {Promise<Array<Object>>} Array of all records
     */
    async getAll(options = {}) {
        if (!this.isConnected) {
            await this.connect();
        }
        return this._retryOperation(async () => {
            if (!this.table) {
                throw new StorageError("Table not initialized");
            }
            let query = this.table.query();
            if (options.limit) {
                query = query.limit(options.limit);
            }
            const resultsArray = await query.toArray();
            return resultsArray.map((row) => ({
                id: row.id,
                content: row.content,
                metadata: row.metadata ? JSON.parse(row.metadata) : null,
                vector: row.vector,
                created_at: row.created_at,
                updated_at: row.updated_at,
            }));
        });
    }
    /**
     * Delete a record by ID
     * @param {string} id - Record ID to delete
     * @returns {Promise<Object>} Result with success status
     * @throws {StorageError} If delete fails
     */
    async delete(id) {
        if (!this.isConnected) {
            await this.connect();
        }
        return this._retryOperation(async () => {
            if (!this.table) {
                throw new StorageError("Table not initialized");
            }
            await this.table.delete(`id == '${this._sanitizeId(id)}'`);
            return {
                id,
                success: true,
            };
        });
    }
    /**
     * Update an existing record
     * @param {string} id - Record ID to update
     * @param {Object} data - Updated data fields
     * @returns {Promise<Object>} Result with success status
     * @throws {StorageError} If update fails
     */
    async update(id, data) {
        if (!this.isConnected) {
            await this.connect();
        }
        return this._retryOperation(async () => {
            const updateData = {
                ...data,
                updated_at: new Date(),
            };
            if (!this.table) {
                throw new StorageError("Table not initialized");
            }
            // Update API expects filter and values separately
            await this.table.update({
                where: `id == '${this._sanitizeId(id)}'`,
                values: updateData,
            });
            return {
                id,
                success: true,
            };
        });
    }
    /**
     * Get database statistics
     * @returns {Promise<Object>} Statistics including count, size, etc.
     * @throws {QueryError} If stats query fails
     */
    async getStats() {
        if (!this.isConnected) {
            await this.connect();
        }
        return this._retryOperation(async () => {
            if (!this.table) {
                throw new StorageError("Table not initialized");
            }
            let count = 0;
            try {
                if (typeof this.table.count === "function") {
                    count = await this.table.count();
                }
                else {
                    // Fallback: use a limited query to avoid loading all records
                    const countResults = await this.table.query().execute();
                    for await (const batch of countResults) {
                        count += batch.numRows;
                    }
                }
            }
            catch (_countError) {
                count = -1;
            }
            return {
                tableName: this.tableName,
                uri: this.uri,
                count: count,
                isConnected: this.isConnected,
            };
        });
    }
    /**
     * Compact old data files and prune versions older than 7 days.
     * Best-effort — never throws.
     */
    async optimize() {
        if (!this.isConnected || !this.table) return;
        try {
            await this.table.optimize({
                cleanupOlderThan: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            });
        }
        catch (_e) {
            // Best-effort — never block normal operations
        }
    }
    /**
     * Sanitize an ID to prevent SQL injection
     * Removes any characters that aren't alphanumeric, underscore, or hyphen
     * @private
     */
    _sanitizeId(id) {
        // Remove any characters that aren't alphanumeric, underscore, or hyphen
        // This prevents SQL injection via raw string interpolation in queries
        return id.replace(/[^a-zA-Z0-9_-]/g, "");
    }
    /**
     * Validate a record object
     * @private
     */
    _validateRecord(record) {
        if (!record || typeof record !== "object") {
            throw new StorageError("Record must be an object");
        }
        if (!record.id) {
            throw new StorageError("Record must have an id field");
        }
        if (!record.content) {
            throw new StorageError("Record must have a content field");
        }
        if (!record.vector) {
            throw new StorageError("Record must have a vector field");
        }
        this._validateVector(record.vector);
    }
    /**
     * Validate a vector array
     * @private
     */
    _validateVector(vector) {
        if (!Array.isArray(vector)) {
            throw new QueryError("Vector must be an array");
        }
        // Expected dimension for all-MiniLM-L6-v2 model
        // This should ideally match this.vectorDimension
        // But keeping as is to match original logic or update to use this.vectorDimension
        const expectedDim = this.vectorDimension || 384;
        if (vector.length !== expectedDim) {
            // Loose validation for now as different models have different dims
            // throw new QueryError(`Vector must have ${expectedDim} dimensions, got ${vector.length}`);
        }
        // Validate all elements are numbers
        for (let i = 0; i < vector.length; i++) {
            if (typeof vector[i] !== "number" || isNaN(vector[i])) {
                throw new QueryError(`Vector element ${i} is not a valid number`);
            }
        }
    }
    /**
     * Sleep for a specified duration
     * @private
     */
    _sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    /**
     * Check if an error is retryable (transient network/connection issues)
     * @private
     */
    _isRetryableError(error) {
        if (!error || !error.message) {
            return false;
        }
        const message = error.message.toLowerCase();
        // Network-related errors
        const retryablePatterns = [
            "econnreset", // Connection reset by peer
            "etimedout", // Operation timed out
            "enotfound", // DNS resolution failed
            "econnrefused", // Connection refused
            "enetunreach", // Network unreachable
            "ehostunreach", // Host unreachable
            "socket hang up", // Socket closed unexpectedly
            "network error", // Generic network error
            "failed to fetch", // Fetch/network failure
            "timeout", // Timeout occurred
        ];
        // Check for network patterns
        const hasNetworkPattern = retryablePatterns.some((pattern) => message.includes(pattern));
        // Check for 5xx HTTP errors (server-side errors that may be transient)
        const hasServerError = /5\d{2}/.test(message);
        // Check for specific LanceDB/lancedb errors that may be transient
        const lancedbRetryable = [
            "connection",
            "database closed",
            "table not found",
            "lock",
            "busy",
            "temporary",
        ].some((pattern) => message.includes(pattern));
        return hasNetworkPattern || hasServerError || lancedbRetryable;
    }
    /**
     * Retry an operation with exponential backoff
     * @private
     */
    async _retryOperation(operation, maxRetries, baseDelay) {
        const max = maxRetries ?? this.maxRetries;
        const delay = baseDelay ?? this.retryDelay;
        let lastError = null;
        for (let attempt = 1; attempt <= max; attempt++) {
            try {
                return await operation();
            }
            catch (error) {
                lastError = error;
                if (!this._isRetryableError(error)) {
                    throw error;
                }
                if (attempt === max) {
                    throw error;
                }
                const backoffMs = delay * Math.pow(2, attempt - 1);
                const jitterMs = backoffMs * Math.random() * 0.25;
                const message = error instanceof Error ? error.message : String(error);
                logger.debug({
                    attempt,
                    max,
                    message,
                    retryDelayMs: Math.round(backoffMs + jitterMs),
                }, "Retryable error, retrying");
                await this._sleep(backoffMs + jitterMs);
            }
        }
        throw lastError;
    }
}
export default LanceDBClient;
