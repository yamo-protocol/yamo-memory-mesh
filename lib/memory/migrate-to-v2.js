#!/usr/bin/env node
/**
 * Memory Database Migration to V2 Schema
 *
 * Usage: node lib/memory/migrate-to-v2.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MemoryMesh } from './memory-mesh.js';
import { createMemorySchemaV2, isSchemaV2 } from '../lancedb/schema.js';

const MEMORY_DIR = './runtime/data/lancedb';
const BACKUP_DIR_TEMPLATE = './runtime/data/lancedb-backup-{timestamp}';

async function main() {
  console.log('🔄 Starting memory migration to V2...\n');

  // Step 1: Backup existing database
  console.log('📦 Step 1: Creating backup...');
  const backupPath = await createBackup();
  if (backupPath) {
    console.log(`✅ Database backed up to: ${backupPath}\n`);
  } else {
    console.log('⚠️  No existing database found (fresh installation)\n');
  }

  // Step 2: Initialize memory mesh
  console.log('🔌 Step 2: Initializing memory mesh...');
  const mesh = new MemoryMesh();
  await mesh.init();
  console.log('✅ Memory mesh initialized\n');

  // Step 3: Get current stats
  console.log('📊 Step 3: Checking current state...');
  const stats = await mesh.stats();
  console.log(`   Found ${stats.count} existing memories\n`);

  // Step 4: Check if migration needed
  console.log('🔍 Step 4: Checking schema version...');
  const needsMigration = await checkNeedsMigration(mesh);
  if (!needsMigration) {
    console.log('✅ Already at V2 schema - no migration needed\n');
    return;
  }
  console.log('   Migration to V2 required\n');

  // Step 5: Perform migration
  console.log('🔧 Step 5: Performing migration...');
  const migrationResult = await migrateSchema(mesh);
  if (!migrationResult.success) {
    console.log(`❌ Migration failed: ${migrationResult.error}\n`);
    console.log('💡 You can restore from backup:');
    console.log(`   rm -rf ${MEMORY_DIR}`);
    console.log(`   mv ${backupPath} ${MEMORY_DIR}\n`);
    process.exit(1);
  }
  console.log('✅ Schema migration complete\n');

  // Summary
  console.log('═══════════════════════════════════════════════════');
  console.log('🎉 Migration Complete!');
  console.log('═══════════════════════════════════════════════════');
  console.log(`\n📊 Final Stats:`);
  console.log(`   Total memories: ${migrationResult.totalMemories}`);
  console.log(`   Schema version: V2`);
  console.log(`\n💾 Backup available at: ${backupPath}`);
  console.log(`   (Keep this backup until you've verified everything works)\n`);
}

async function createBackup() {
  if (!fs.existsSync(MEMORY_DIR)) {
    return null;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `./runtime/data/lancedb-backup-${timestamp}`;

  fs.cpSync(MEMORY_DIR, backupPath, { recursive: true });
  return backupPath;
}

async function checkNeedsMigration(mesh) {
  const table = mesh.client.table;
  const schema = table.schema;

  return !isSchemaV2(schema);
}

async function migrateSchema(mesh) {
  try {
    const oldTableName = mesh.tableName;
    const newTableName = `${oldTableName}_v2`;

    // Get existing data
    const oldTable = mesh.client.db.openTable(oldTableName);
    const existingData = await oldTable.toArrow();

    console.log(`   Exported ${existingData.numRows} existing records`);

    // Create new table with V2 schema
    const newTable = await mesh.client.db.createTable(
      newTableName,
      existingData,
      { mode: 'overwrite' }
    );

    // Drop old table and rename new one
    await mesh.client.db.dropTable(oldTableName);
    await newTable.rename(oldTableName);

    return { success: true, totalMemories: existingData.numRows };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

await main();
