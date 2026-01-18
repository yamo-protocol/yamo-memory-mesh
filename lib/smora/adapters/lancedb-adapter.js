/**
 * LanceDB Adapter for S-MORA
 *
 * Provides a unified interface to LanceDB operations
 *
 * @module smora/adapters/lancedb-adapter
 */

/**
 * LanceDB Adapter
 */
export class LanceDBAdapter {
  constructor(config = {}) {
    this.config = {
      uri: config.uri || './runtime/data/lancedb',
      apiKey: config.apiKey || null,
      region: config.region || null
    };
    this.db = null;
    this.initialized = false;
  }

  /**
   * Initialize the adapter
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // Use existing YAMO LanceDB client
      const { LanceDBClient } = await import('../../lancedb/client.js');
      this.client = new LanceDBClient({ uri: this.config.uri, tableName: 'memories' });
      await this.client.connect();
      this.db = this.client;
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize LanceDB: ${error.message}`);
    }
  }

  /**
   * Get a table by name
   *
   * @param {string} tableName - Table name
   * @returns {Promise<Object>} Table instance
   */
  async getTable(tableName) {
    await this.initialize();
    // LanceDBClient already has the table initialized
    // Just return the client's table property
    return this.db.table;
  }

  /**
   * Create a new table
   *
   * @param {string} tableName - Table name
   * @param {Array} data - Initial data
   * @param {Object} schema - Table schema
   * @returns {Promise<Object>} Table instance
   */
  async createTable(tableName, data = [], schema = null) {
    await this.initialize();
    // LanceDBClient creates table during connect()
    // Return the existing table
    return this.db.table;
  }

  /**
   * Search a table
   *
   * Supports two calling conventions:
   * 1. search(tableName, vector, options) - Original API with table name
   * 2. search(vector, options) - Simplified API using default table
   *
   * @param {string|Array} tableNameOrVector - Table name or query vector
   * @param {Array|Object} vectorOrOptions - Query vector or options object
   * @param {Object} options - Search options (only if tableName provided)
   * @returns {Promise<Array>} Search results
   */
  async search(tableNameOrVector, vectorOrOptions, options) {
    let tableName, vector, searchOptions;

    // Detect calling convention
    if (Array.isArray(tableNameOrVector)) {
      // Called as: search(vector, options)
      tableName = null; // Use default table
      vector = tableNameOrVector;
      searchOptions = vectorOrOptions || {};
    } else {
      // Called as: search(tableName, vector, options)
      tableName = tableNameOrVector;
      vector = vectorOrOptions;
      searchOptions = options || {};
    }

    // Get table (use default if tableName not provided)
    if (tableName) {
      await this.getTable(tableName);
    }
    const table = this.db.table;

    const limit = searchOptions.limit || 10;
    const nprobes = searchOptions.nprobes || 20;

    let query = table.search(vector);
    query = query.limit(limit);
    query = query.nprobes(nprobes);

    if (searchOptions.filter) {
      query = query.where(searchOptions.filter);
    }

    // Execute search and convert AsyncGenerator to array
    const resultsGenerator = await query.execute();
    const resultsArray = [];

    for await (const batch of resultsGenerator) {
      const rows = batch.toArray();
      for (const row of rows) {
        resultsArray.push({
          id: row.id,
          content: row.content,
          metadata: row.metadata ? JSON.parse(row.metadata) : null,
          _distance: row._distance,
          vector: row.vector
        });
      }
    }

    return resultsArray;
  }

  /**
   * Add data to a table
   *
   * @param {string} tableName - Table name
   * @param {Array} data - Data to add
   * @returns {Promise<void>}
   */
  async add(tableName, data) {
    const table = await this.getTable(tableName);
    await table.add(data);
  }

  /**
   * Health check
   *
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    try {
      await this.initialize();
      return { status: 'healthy', uri: this.config.uri };
    } catch (error) {
      return { status: 'unhealthy', error: error.message };
    }
  }

  /**
   * Close the connection
   */
  async close() {
    this.db = null;
    this.initialized = false;
  }
}

/**
 * Create a LanceDB adapter instance
 *
 * @param {Object} config - Configuration
 * @returns {LanceDBAdapter} Adapter instance
 */
export function createLancedbAdapter(config) {
  return new LanceDBAdapter(config);
}

export default LanceDBAdapter;
