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

import lancedb from "@lancedb/lancedb";
import fs from "fs";
import path from "path";
import {  createMemoryTableWithDimension, DEFAULT_VECTOR_DIMENSION  } from "./schema.js";
import { StorageError, QueryError, ConfigurationError } from "./errors.js";

/**
 * LanceDB Client wrapper class
 */
class LanceDBClient {
  /**
   * Create a new LanceDBClient instance
   * @param {Object} [config={}] - Configuration object
   * @param {string} [config.uri] - Database URI (default: from env or './data/lancedb')
   * @param {string} [config.tableName] - Table name (default: from env or 'memory_entries')
   * @param {number} [config.maxRetries] - Maximum connection retries (default: 3)
   * @param {number} [config.retryDelay] - Delay between retries in ms (default: 1000)
   * @param {number} [config.vectorDimension] - Vector dimension for embeddings (default: 384)
   * @param {Object} [config.driver] - LanceDB driver instance (for testing)
   */
  constructor(config = {}) {
    this.uri = (config && config.uri) || process.env.LANCEDB_URI || './data/lancedb';
    this.tableName = (config && config.tableName) || process.env.LANCEDB_MEMORY_TABLE || 'memory_entries';
    this.maxRetries = (config && config.maxRetries) || 3;
    this.retryDelay = (config && config.retryDelay) || 1000;
    this.vectorDimension = (config && config.vectorDimension) || DEFAULT_VECTOR_DIMENSION;
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
        // Ensure database directory exists
        const dbPath = path.resolve(this.uri);
        const dbDir = path.dirname(dbPath);

        if (!fs.existsSync(dbDir)) {
          fs.mkdirSync(dbDir, { recursive: true });
        }

        // Connect to database
        this.db = await this.driver.connect(this.uri);

        // Initialize table with dynamic dimension (creates if doesn't exist, opens if it does)
        this.table = await createMemoryTableWithDimension(this.db, this.tableName, this.vectorDimension);

        this.isConnected = true;
        return;

      } catch (error) {
        lastError = error;

        if (attempt < this.maxRetries) {
          // Wait before retrying
          await this._sleep(this.retryDelay * attempt);
        }
      }
    }

    // All retries failed
    const errorMessage = lastError instanceof Error ? lastError.message : String(lastError);
    throw new StorageError(
      `Failed to connect to LanceDB after ${this.maxRetries} attempts: ${errorMessage}`,
      { uri: this.uri, tableName: this.tableName, originalError: lastError }
    );
  }

  /**
   * Disconnect from LanceDB
   * @returns {Promise<void>}
   */
  async disconnect() {
    this.db = null;
    this.table = null;
    this.isConnected = false;
  }

  /**
   * Add a single memory entry
   * @param {Object} data - Entry data
   * @param {string} data.id - Unique identifier
   * @param {Array<number>} data.vector - Embedding vector (384 dimensions)
   * @param {string} data.content - Text content
   * @param {string} [data.metadata] - JSON string metadata
   * @returns {Promise<Object>} Result with id and success status
   * @throws {StorageError} If add operation fails
   */
  async add(data) {
    if (!this.isConnected) {
      await this.connect();
    }

    this._validateRecord(data);

    return await this._retryOperation(async () => {
      const record = {
        ...data,
        created_at: new Date(),
        updated_at: new Date()
      };

      if (!this.table) {
        throw new StorageError('Table not initialized');
      }

      await this.table.add([record]);

      return {
        id: data.id,
        success: true
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
      throw new StorageError('Records must be a non-empty array');
    }

    // Validate all records
    records.forEach(record => this._validateRecord(record));

    return await this._retryOperation(async () => {
      const now = new Date();
      const recordsWithTimestamps = records.map(record => ({
        ...record,
        created_at: now,
        updated_at: now
      }));

      if (!this.table) {
        throw new StorageError('Table not initialized');
      }

      await this.table.add(recordsWithTimestamps);

      return {
        count: records.length,
        success: true
      };
    });
  }

  /**
   * Search for similar vectors
   * @param {Array<number>} vector - Query vector (384 dimensions)
   * @param {Object} options - Search options
   * @param {number} [options.limit=10] - Maximum number of results
   * @param {string} [options.metric='cosine'] - Distance metric ('cosine', 'l2', 'dot')
   * @param {number} [options.nprobes=20] - Number of IVF partitions to search
   * @param {Object} [options.filter] - Filter expression for metadata (e.g., "content == 'value'")
   *                                Note: Filters work on top-level schema fields only.
   *                                The metadata field is stored as JSON string and cannot
   *                                be filtered directly. Use content or other top-level fields.
   * @returns {Promise<Array<Object>>} Array of search results with scores
   * @throws {QueryError} If search fails
   */
  async search(vector, options = {}) {
    if (!this.isConnected) {
      await this.connect();
    }

    this._validateVector(vector);

    const {
      limit = 10,
      metric = 'cosine',
      nprobes = 20,
      filter = null
    } = options;

    return await this._retryOperation(async () => {
      if (!this.table) {
        throw new StorageError('Table not initialized');
      }
      
      // Build the search query with all applicable options
      let query = this.table.search(vector);

      // Apply nprobes for IVF index (if supported)
      // Note: nprobes is typically set at index creation time, but we attempt to apply it here
      if (nprobes && typeof nprobes === 'number') {
        try {
          // @ts-ignore - nprobes might not exist on all query types or versions
          query = query.nprobes(nprobes);
        } catch (e) {
          // nprobes may not be supported in all LanceDB versions or configurations
          // Silently continue if not applicable
        }
      }

      // Apply filter if provided
      // LanceDB supports filtering with .where() clause
      if (filter) {
        query = query.where(filter);
      }

      // Execute search with limit
      // @ts-ignore - execute() is protected in types but public in JS implementation or types are wrong
      const resultsGenerator = await query.limit(limit).execute();
      const resultsArray = [];

      for await (const batch of resultsGenerator) {
        // Convert RecordBatch to array of StructRow objects
        const rows = batch.toArray();
        for (const row of rows) {
          resultsArray.push({
            id: row.id,
            content: row.content,
            metadata: row.metadata ? JSON.parse(row.metadata) : null,
            // @ts-ignore - _distance is internal property
            score: row._distance,
            created_at: row.created_at
          });
        }
      }

      return resultsArray;
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

    return await this._retryOperation(async () => {
      if (!this.table) {
        throw new StorageError('Table not initialized');
      }

      // Use a simple filter query instead of search
      const results = await this.table.query()
        .where(`id == '${id}'`)
        // @ts-ignore
        .execute();

      // Convert AsyncGenerator of RecordBatches to array
      const resultsArray = [];
      for await (const batch of results) {
        const rows = batch.toArray();
        resultsArray.push(...rows);
      }

      if (resultsArray.length === 0) {
        return null;
      }

      const record = resultsArray[0];
      return {
        id: record.id,
        vector: record.vector,
        content: record.content,
        metadata: record.metadata ? JSON.parse(record.metadata) : null,
        created_at: record.created_at,
        updated_at: record.updated_at
      };
    });
  }

  /**
   * Get all records from the database
   * @param {Object} options - Options
   * @param {number} [options.limit] - Optional limit
   * @returns {Promise<Array<Object>>} Array of all records
   */
  async getAll(options = {}) {
    if (!this.isConnected) {
      await this.connect();
    }

    return await this._retryOperation(async () => {
      if (!this.table) {
        throw new StorageError('Table not initialized');
      }

      let query = this.table.query();
      
      if (options.limit) {
        query = query.limit(options.limit);
      }

      // @ts-ignore
      const results = await query.execute();
      const resultsArray = [];

      for await (const batch of results) {
        const rows = batch.toArray();
        for (const row of rows) {
          resultsArray.push({
            id: row.id,
            content: row.content,
            metadata: row.metadata ? JSON.parse(row.metadata) : null,
            vector: row.vector,
            created_at: row.created_at,
            updated_at: row.updated_at
          });
        }
      }

      return resultsArray;
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

    return await this._retryOperation(async () => {
      if (!this.table) {
        throw new StorageError('Table not initialized');
      }

      await this.table.delete(`id == '${id}'`);

      return {
        id,
        success: true
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

    return await this._retryOperation(async () => {
      const updateData = {
        ...data,
        updated_at: new Date()
      };

      if (!this.table) {
        throw new StorageError('Table not initialized');
      }

      // Update API expects filter and values separately
      await this.table.update({
        where: `id == '${id}'`,
        values: updateData
      });

      return {
        id,
        success: true
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

    return await this._retryOperation(async () => {
      if (!this.table) {
        throw new StorageError('Table not initialized');
      }

      // Try to get count using table.count() method if available
      let count = 0;
      try {
        // LanceDB tables may have a count() method
        // @ts-ignore
        if (typeof this.table.count === 'function') {
          // @ts-ignore
          count = await this.table.count();
        } else {
          // Fallback: use a limited query to avoid loading all records
          // @ts-ignore
          const results = await this.table.query().limit(0).execute();
          // Try to extract count from metadata if available
          for await (const batch of results) {
            // Some LanceDB versions provide count in metadata
            if (batch.numRows !== undefined) {
              count = batch.numRows;
              break;
            }
          }
          // If count is still 0, we need to actually count
          if (count === 0) {
            // @ts-ignore
            const countResults = await this.table.query().execute();
            let tempCount = 0;
            for await (const batch of countResults) {
              tempCount += batch.numRows;
            }
            count = tempCount;
          }
                  }
              } catch (countError) {
                // If all counting methods fail, mark as unknown (-1)
                count = -1;
              }
        
              const stats = {
                tableName: this.tableName,
                uri: this.uri,
                count: count,
                isConnected: this.isConnected
              };
        
        
              return stats;
            });
          }
        
          /**
           * Validate a record object
           * @private
           * @param {Object} record - Record to validate
           * @throws {StorageError} If validation fails
           */
          _validateRecord(record) {
            if (!record || typeof record !== 'object') {
              throw new StorageError('Record must be an object');
            }
        
            if (!record.id) {
              throw new StorageError('Record must have an id field');
            }
        
            if (!record.content) {
              throw new StorageError('Record must have a content field');
            }
        
            if (!record.vector) {
              throw new StorageError('Record must have a vector field');
            }
        
            this._validateVector(record.vector);
          }
        
          /**
           * Validate a vector array
           * @private
           * @param {Array<number>} vector - Vector to validate
           * @throws {QueryError} If validation fails
           */
          _validateVector(vector) {
            if (!Array.isArray(vector)) {
              throw new QueryError('Vector must be an array');
            }
        
            // Expected dimension for all-MiniLM-L6-v2 model
            const expectedDim = 384;
        
            if (vector.length !== expectedDim) {
              throw new QueryError(
                `Vector must have ${expectedDim} dimensions, got ${vector.length}`
              );
            }
        
            // Validate all elements are numbers
            for (let i = 0; i < vector.length; i++) {
              if (typeof vector[i] !== 'number' || isNaN(vector[i])) {
                throw new QueryError(`Vector element ${i} is not a valid number`);
              }
            }
          }
        
          /**
           * Sleep for a specified duration
           * @private
           * @param {number} ms - Milliseconds to sleep
           * @returns {Promise<void>}
           */
          _sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
          }
        
          /**
           * Check if an error is retryable (transient network/connection issues)
           * @private
           * @param {Error} error - Error to check
           * @returns {boolean} True if error is retryable
           */
          _isRetryableError(error) {
            if (!error || !error.message) return false;
        
            const message = error.message.toLowerCase();
        
            // Network-related errors
            const retryablePatterns = [
              'econnreset',      // Connection reset by peer
              'etimedout',       // Operation timed out
              'enotfound',       // DNS resolution failed
              'econnrefused',    // Connection refused
              'enetunreach',     // Network unreachable
              'ehostunreach',    // Host unreachable
              'socket hang up',  // Socket closed unexpectedly
              'network error',   // Generic network error
              'failed to fetch', // Fetch/network failure
              'timeout',         // Timeout occurred
            ];
        
            // Check for network patterns
            const hasNetworkPattern = retryablePatterns.some(pattern => message.includes(pattern));
        
            // Check for 5xx HTTP errors (server-side errors that may be transient)
            const hasServerError = /5\d{2}/.test(message);
        
            // Check for specific LanceDB/lancedb errors that may be transient
            const lancedbRetryable = [
              'connection',
              'database closed',
              'table not found',
              'lock',
              'busy',
              'temporary'
            ].some(pattern => message.includes(pattern));
        
            return hasNetworkPattern || hasServerError || lancedbRetryable;
          }
        
          /**
           * Retry an operation with exponential backoff
           * @private
           * @param {Function} operation - Async function to retry
           * @param {number} [maxRetries] - Maximum retry attempts (default: 3)
           * @param {number} [baseDelay] - Base delay in ms (default: 1000)
           * @returns {Promise<*>} Result of the operation
           * @throws {Error} If all retries fail, throws the last error
           */
          async _retryOperation(operation, maxRetries, baseDelay) {
            const max = maxRetries ?? this.maxRetries;
            const delay = baseDelay ?? this.retryDelay;
            let lastError = null;
        
            for (let attempt = 1; attempt <= max; attempt++) {
              try {
                return await operation();
              } catch (error) {
                lastError = error;
        
                // Check if error is retryable
                // @ts-ignore - check error type
                if (!this._isRetryableError(error)) {
                  // Non-retryable error, throw immediately
                  throw error;
                }
        
                // Check if we've exhausted retries
                if (attempt === max) {
                  throw error;
                }
        
                // Calculate exponential backoff delay (1s, 2s, 4s, etc.)
                const backoffMs = delay * Math.pow(2, attempt - 1);
        
                        // Add jitter (0-25% of delay) to prevent thundering herd
                        const jitterMs = backoffMs * Math.random() * 0.25;
                
                        const message = error instanceof Error ? error.message : String(error);
                        console.warn(
                          `[LanceDBClient] Retryable error on attempt ${attempt}/${max}: ${message}. ` +
                          `Retrying in ${Math.round((backoffMs + jitterMs))}ms...`
                        );
                
                        await this._sleep(backoffMs + jitterMs);
                      }
                    }        
            // Should not reach here, but just in case
            throw lastError;
          }}

export { LanceDBClient };
export default LanceDBClient;
