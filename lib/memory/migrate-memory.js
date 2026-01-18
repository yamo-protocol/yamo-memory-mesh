#!/usr/bin/env node

/**
 * Migrate Memory - JSON to LanceDB Migration Utility
 *
 * Migrates existing JSON-based memory store to LanceDB vector database.
 * Generates mock embeddings for each record (Phase 2).
 *
 * CLI Interface:
 *   node tools/migrate_memory.js [source_file]
 *
 * Default source: ./memory_store.json
 *
 * Features:
 * - Reads existing JSON file (array of memory records)
 * - Generates mock embeddings for each record (real embeddings in Phase 3)
 * - Preserves metadata (source_agent, type, tags, etc.)
 * - Adds migration metadata (migrated_from: 'json_store')
 * - Creates backup of original file
 * - Reports migration statistics
 */

import { fileURLToPath } from 'url';
import fs from "fs";
import path from "path";
import { LanceDBClient } from "../lancedb/client.js";
import { getConfig } from "../lancedb/config.js";
import { handleError, StorageError } from "../lancedb/errors.js";

/**
 * Embedding dimension for all-MiniLM-L6-v2 model
 * TODO: This will be replaced by the embedding service in Phase 3
 */
const EMBEDDING_DIMENSION = 384;

/**
 * Generate a mock embedding vector
 * TODO: Replace with real embedding service in Phase 3 (Task 3.1)
 * @param {string} text - Text to embed
 * @returns {Array<number>} Mock embedding vector
 */
function generateMockEmbedding(text) {
  // Generate deterministic mock vectors based on text content
  // This ensures the same text always gets the same "embedding"
  const vector = new Array(EMBEDDING_DIMENSION);

  // Simple hash-based mock vector
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }

  // Fill vector with deterministic values
  for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
    // Use hash and position to generate deterministic values
    const value = (Math.sin(hash + i) + 1) / 2; // Normalize to [0, 1]
    vector[i] = value;
  }

  return vector;
}

/**
 * MemoryMigration class for handling JSON to LanceDB migration
 */
class MemoryMigration {
  /**
   * Create a new MemoryMigration instance
   */
  constructor() {
    this.client = null;
    this.config = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the LanceDB client
   * @returns {Promise<void>}
   */
  async init() {
    if (this.isInitialized) {
      return;
    }

    try {
      // Load configuration
      this.config = getConfig();

      // Create LanceDB client
      this.client = new LanceDBClient({
        uri: this.config.LANCEDB_URI,
        tableName: this.config.LANCEDB_MEMORY_TABLE
      });

      // Connect to database
      await this.client.connect();
      this.isInitialized = true;

    } catch (error) {
      throw handleError(error, { context: 'MemoryMigration.init' });
    }
  }

  /**
   * Read JSON memory store file
   * @param {string} sourceFile - Path to JSON file
   * @returns {Array<Array>} Array of [record, isValid] tuples
   */
  readJsonFile(sourceFile) {
    try {
      const absolutePath = path.resolve(sourceFile);

      if (!fs.existsSync(absolutePath)) {
        throw new StorageError(
          `Source file not found: ${sourceFile}`,
          { path: absolutePath }
        );
      }

      const content = fs.readFileSync(absolutePath, 'utf8');
      const records = JSON.parse(content);

      if (!Array.isArray(records)) {
        throw new StorageError(
          'JSON file must contain an array of records',
          { path: absolutePath, type: typeof records }
        );
      }

      return records;

    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }
      throw handleError(error, { context: 'MemoryMigration.readJsonFile', sourceFile });
    }
  }

  /**
   * Create backup of source file
   * @param {string} sourceFile - Path to source file
   * @returns {string} Path to backup file
   */
  createBackup(sourceFile) {
    try {
      const absolutePath = path.resolve(sourceFile);
      const backupPath = absolutePath + '.backup';

      // Copy file to backup
      fs.copyFileSync(absolutePath, backupPath);

      return backupPath;

    } catch (error) {
      throw handleError(error, { context: 'MemoryMigration.createBackup', sourceFile });
    }
  }

  /**
   * Validate a memory record
   * @param {Object} record - Record to validate
   * @returns {boolean} True if valid
   */
  validateRecord(record) {
    if (!record || typeof record !== 'object') {
      return false;
    }

    // Must have id and content fields
    if (!record.id || !record.content) {
      return false;
    }

    return true;
  }

  /**
   * Migrate a single record to LanceDB
   * @param {Object} record - Record to migrate
   * @returns {Promise<Object>} Migration result
   */
  async migrateRecord(record) {
    try {
      // Validate record
      if (!this.validateRecord(record)) {
        return {
          id: record.id || 'unknown',
          success: false,
          error: 'Invalid record: missing id or content'
        };

      }

      // Generate mock embedding
      const vector = generateMockEmbedding(record.content);

      // Enhance metadata with migration info
      const originalMetadata = record.metadata || {};

      const enhancedMetadata = {
        ...originalMetadata,
        migrated_from: 'json_store',
        migration_date: new Date().toISOString()
      };


      // Prepare record for LanceDB
      const lancedbRecord = {
        id: record.id,
        vector,
        content: record.content,
        metadata: JSON.stringify(enhancedMetadata)
      };


      // Add to LanceDB
      const result = await this.client.add(lancedbRecord);

      return {
        id: result.id,
        success: true
      };


    } catch (error) {
      return {
        id: record.id || 'unknown',
        success: false,
        error: error.message
      };

    }
  }

  /**
   * Run migration from JSON file to LanceDB
   * @param {string} sourceFile - Path to JSON file
   * @returns {Promise<Object>} Migration statistics
   */
  async migrate(sourceFile) {
    await this.init();

    const stats = {
      source: sourceFile,
      total: 0,
      migrated: 0,
      failed: 0,
      failedRecords: [],
      backupFile: null
    };


    try {
      // Read JSON file
      console.log(`Migrating from: ${sourceFile}`);
      const records = this.readJsonFile(sourceFile);
      stats.total = records.length;

      console.log(`✅ Found ${stats.total} records to migrate`);

      // Create backup (even for empty files)
      const backupPath = this.createBackup(sourceFile);
      stats.backupFile = backupPath;

      if (stats.total === 0) {
        console.log('✅ Migration complete:');
        console.log(`  - Migrated: ${stats.migrated}`);
        console.log(`  - Failed: ${stats.failed}`);
        console.log(`💡 Backup created at: ${stats.backupFile}`);
        return stats;
      }

      // Migrate each record
      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        const result = await this.migrateRecord(record);

        // Show progress every 10 records or for last record
        if ((i + 1) % 10 === 0 || (i + 1) === records.length) {
          console.log(`Progress: ${i + 1}/${stats.total}`);
        }

        if (result.success) {
          stats.migrated++;
        } else {
          stats.failed++;
          stats.failedRecords.push({
            id: result.id,
            error: result.error
          });
        }
      }

      // Report results
      console.log('');
      console.log('✅ Migration complete:');
      console.log(`  - Migrated: ${stats.migrated}`);
      console.log(`  - Failed: ${stats.failed}`);

      if (stats.backupFile) {
        console.log(`💡 Backup created at: ${stats.backupFile}`);
      }

      if (stats.failedRecords.length > 0) {
        console.log('');
        console.log('⚠️  Failed records:');
        stats.failedRecords.forEach(({ id, error }) => {
          console.log(`  - ${id}: ${error}`);
        });
      }

      return stats;

    } catch (error) {
      throw handleError(error, { context: 'MemoryMigration.migrate', sourceFile, stats });
    }
  }
}

/**
 * Main CLI handler
 */
async function run() {
  // Get source file from CLI argument or use default
  const sourceFile = process.argv[2] || './memory_store.json';

  // Create migration instance
  const migration = new MemoryMigration();

  try {
    await migration.migrate(sourceFile);
    process.exit(0);

  } catch (error) {
    const errorResponse = handleError(error, { sourceFile });

    if (errorResponse.success === false) {
      console.error(`❌ Fatal Error: ${errorResponse.error.message}`);
      if (process.env.NODE_ENV === 'development' && errorResponse.error.details) {
        console.error(`Details:`, errorResponse.error.details);
      }
      console.error(JSON.stringify(errorResponse, null, 2));
    } else {
      console.error(`❌ Fatal Error: ${error.message}`);
      console.error(error.stack);
    }

    process.exit(1);
  }
}

// Export for testing
export { MemoryMigration, generateMockEmbedding };
export default LanceDBClient;

// Run CLI if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch(err => {
    console.error(`❌ Fatal Error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  });
}
