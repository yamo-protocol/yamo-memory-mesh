#!/usr/bin/env node

/**
 * Migrate Memory - JSON to LanceDB Migration Utility
 *
 * Migrates existing JSON-based memory store to LanceDB vector database.
 */

import { fileURLToPath } from 'url';
import fs from "fs";
import path from "path";
import { LanceDBClient } from "../lancedb/client.js";
import { getConfig } from "../lancedb/config.js";
import { handleError, StorageError } from "../lancedb/errors.js";
import { Scrubber } from "../scrubber/scrubber.js";

/**
 * Embedding dimension for all-MiniLM-L6-v2 model
 */
const EMBEDDING_DIMENSION = 384;

/**
 * Generate a mock embedding vector
 * @param {string} text - Text to embed
 * @returns {Array<number>} Mock embedding vector
 */
function generateMockEmbedding(text) {
  const vector = new Array(EMBEDDING_DIMENSION);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash = hash & hash;
  }
  for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
    const value = (Math.sin(hash + i) + 1) / 2;
    vector[i] = value;
  }
  return vector;
}

/**
 * MemoryMigration class for handling JSON to LanceDB migration
 */
class MemoryMigration {
  constructor(config = {}) {
    this.config = config;
    this.client = null;
    this.scrubber = new Scrubber(config.scrubber);
  }

  /**
   * Initialize migration
   */
  async init() {
    try {
      this.client = new LanceDBClient({
        uri: this.config.LANCEDB_URI,
        tableName: this.config.LANCEDB_MEMORY_TABLE,
        maxRetries: 3,
        retryDelay: 1000,
        vectorDimension: 384
      });
      
      await this.client.connect();
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      throw handleError(e, { context: 'MemoryMigration.init' });
    }
  }

  /**
   * Run migration from JSON file
   * @param {string} sourceFile - Path to source JSON file
   * @returns {Promise<Object>} Migration statistics
   */
  async migrate(sourceFile) {
    if (!this.client) {
      await this.init();
    }

    const stats = {
      total: 0,
      processed: 0,
      skipped: 0,
      failed: 0,
      scrubbed: 0,
      backupFile: '',
      failedRecords: []
    };

    try {
      const records = await this._readJsonFile(sourceFile);
      stats.total = records.length;

      const backupPath = await this._createBackup(records, sourceFile);
      stats.backupFile = backupPath;

      for (const record of records) {
        try {
          const result = await this._processRecord(record);
          if (result.success) {
            stats.processed++;
            if (result.scrubbed) stats.scrubbed++;
          } else {
            stats.failed++;
            // @ts-ignore
            stats.failedRecords.push({
              id: result.id || 'unknown',
              error: result.error
            });
          }
        } catch (err) {
          stats.failed++;
          const message = err instanceof Error ? err.message : String(err);
          // @ts-ignore
          stats.failedRecords.push({
            id: record.id || 'unknown',
            error: message
          });
        }
      }

      return stats;
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      throw handleError(e, { context: 'MemoryMigration.migrate', sourceFile, stats });
    }
  }

  /**
   * Read JSON file safely
   * @private
   */
  async _readJsonFile(sourceFile) {
    try {
      const data = await fs.promises.readFile(sourceFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      throw handleError(e, { context: 'MemoryMigration.readJsonFile', sourceFile });
    }
  }

  /**
   * Create backup of source file
   * @private
   */
  async _createBackup(data, sourceFile) {
    try {
      const backupPath = `${sourceFile}.backup-${Date.now()}`;
      await fs.promises.writeFile(backupPath, JSON.stringify(data, null, 2));
      return backupPath;
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      throw handleError(e, { context: 'MemoryMigration.createBackup', sourceFile });
    }
  }

  /**
   * Process a single record
   * @private
   */
  async _processRecord(record) {
    if (!this.client) throw new Error('Client not initialized');
    
    const embedding = generateMockEmbedding(record.content);
    const result = await this.client.add({
      id: record.id,
      content: record.content,
      vector: embedding,
      metadata: JSON.stringify(record.metadata || {})
    });
    
    return { success: result.success, id: record.id, scrubbed: false };
  }
}

/**
 * Main migration runner
 */
async function run() {
  const args = process.argv.slice(2);
  const sourceFile = args[0];

  if (!sourceFile) {
    console.error('Usage: node tools/migrate-memory.js <source_file>');
    process.exit(1);
  }

  const config = getConfig();
  const migration = new MemoryMigration({
    LANCEDB_URI: config.LANCEDB_URI,
    LANCEDB_MEMORY_TABLE: config.LANCEDB_MEMORY_TABLE,
    scrubber: { enabled: true }
  });

  try {
    console.log(`Starting migration from ${sourceFile}...`);
    const stats = await migration.migrate(sourceFile);
    console.log('Migration complete:', JSON.stringify(stats, null, 2));
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    const errorResponse = handleError(e, { sourceFile });
    
    if (errorResponse.success === false) {
      console.error(`❌ Fatal Error: ${errorResponse.error.message}`);
    } else {
      console.error(`❌ Fatal Error: ${e.message}`);
      console.error(e.stack);
    }
    process.exit(1);
  }
}

// Export for testing
export { MemoryMigration, generateMockEmbedding };
export default MemoryMigration;

// Run CLI if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch(err => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ Fatal Error: ${message}`);
    if (err instanceof Error) console.error(err.stack);
    process.exit(1);
  });
}