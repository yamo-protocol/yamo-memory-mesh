#!/usr/bin/env node

/**
 * YAMO MemoryMesh CLI - Protocol-Native Edition (v3.1.0)
 * 
 * Enforces the "Zero JSON" mandate by using standard CLI flags.
 * Machines don't parse YAMO; they execute commands.
 */

import { Command } from 'commander';
import { MemoryMesh } from '../lib/memory/index.js';
import { createLogger } from '../lib/utils/logger.js';

const logger = createLogger('memory-mesh-cli');
const program = new Command();

program
  .name('memory-mesh')
  .description('Portable semantic memory subconscious for YAMO agents')
  .version('3.1.0');

// 1. Store/Ingest Command
program
  .command('store')
  .alias('ingest')
  .description('Persist a semantic memory')
  .requiredOption('-c, --content <text>', 'The memory content')
  .option('-t, --type <type>', 'Memory type (e.g., insight, decision, error)', 'event')
  .option('-r, --rationale <text>', 'The constitutional rationale for this memory')
  .option('-h, --hypothesis <text>', 'The associated hypothesis')
  .option('--metadata <json>', 'Additional metadata (as flat flags or optional JSON)', '{}')
  .action(async (options) => {
    const mesh = new MemoryMesh();
    try {
      let metadata = {};
      try {
        metadata = JSON.parse(options.metadata);
      } catch (_e) {
        // Fallback to empty if invalid JSON
      }
      
      if (options.type) metadata.type = options.type;
      if (options.rationale) metadata.rationale = options.rationale;
      if (options.hypothesis) metadata.hypothesis = options.hypothesis;
      
      const record = await mesh.add(options.content, metadata);
      process.stdout.write(`[MemoryMesh] Ingested record ${record.id}\n`);
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

// 2. Search Command
program
  .command('search')
  .description('Perform semantic recall')
  .argument('<query>', 'The semantic search query')
  .option('-l, --limit <number>', 'Number of results', '10')
  .option('-f, --filter <string>', 'LanceDB SQL-style filter')
  .action(async (query, options) => {
    const mesh = new MemoryMesh();
    try {
      const results = await mesh.search(query, {
        limit: parseInt(options.limit),
        filter: options.filter || null
      });
      
      process.stdout.write(`[MemoryMesh] Found ${results.length} matches.\n`);
      process.stdout.write(mesh.formatResults(results));
      process.stdout.write('\n');
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

// 3. Stats Command
program
  .command('stats')
  .description('Get database health and statistics')
  .action(async () => {
    const mesh = new MemoryMesh();
    try {
      const stats = await mesh.stats();
      process.stdout.write(`[MemoryMesh] Total Memories: ${stats.count}\n`);
      process.stdout.write(`[MemoryMesh] DB Path: ${stats.uri}\n`);
      process.stdout.write(`[MemoryMesh] Status: ${stats.isConnected ? 'Connected' : 'Disconnected'}\n`);
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

program.parse();
