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

// 2. Directory Ingest Command
program
  .command('ingest-dir')
  .description('Recursively ingest a directory of files')
  .argument('<path>', 'Directory path to ingest')
  .option('-e, --extension <ext>', 'Filter by file extension (e.g., .yamo, .md)', '')
  .option('-t, --type <type>', 'Memory type for all files', 'documentation')
  .option('-r, --recursive', 'Ingest subdirectories', false)
  .action(async (dirPath, options) => {
    const mesh = new MemoryMesh();
    try {
      const absolutePath = path.resolve(dirPath);
      if (!fs.existsSync(absolutePath)) {
        throw new Error(`Directory not found: ${absolutePath}`);
      }

      const files = [];
      const walk = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory() && options.recursive) {
            walk(fullPath);
          } else if (entry.isFile()) {
            if (!options.extension || entry.name.endsWith(options.extension)) {
              files.push(fullPath);
            }
          }
        }
      };

      walk(absolutePath);
      process.stdout.write(`[MemoryMesh] Found ${files.length} files to ingest...\n`);

      for (const file of files) {
        const content = fs.readFileSync(file, 'utf-8');
        if (!content.trim()) continue;

        const metadata = {
          source: path.relative(process.cwd(), file),
          ingested_at: new Date().toISOString(),
          type: options.type
        };

        const record = await mesh.add(content, metadata);
        process.stdout.write(`  ✓ Ingested: ${metadata.source} (${record.id})\n`);
      }

      process.stdout.write(`[MemoryMesh] Completed bulk ingestion of ${files.length} files.\n`);
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

// 3. Search Command
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

// 4. Get Command
program
  .command('get')
  .description('Retrieve a single memory by ID')
  .requiredOption('--id <id>', 'Memory record ID')
  .action(async (options) => {
    const mesh = new MemoryMesh();
    try {
      await mesh.init();
      const record = await mesh.get(options.id);
      if (!record) {
        process.stdout.write(`[MemoryMesh] No record found with id: ${options.id}\n`);
        process.exit(1);
      }
      const meta = typeof record.metadata === 'string' ? JSON.parse(record.metadata) : record.metadata;
      process.stdout.write(`[MemoryMesh] id: ${record.id}\n`);
      process.stdout.write(`[MemoryMesh] content: ${record.content}\n`);
      process.stdout.write(`[MemoryMesh] type: ${meta?.type ?? 'unknown'}\n`);
      process.stdout.write(`[MemoryMesh] created_at: ${record.created_at}\n`);
      process.stdout.write(`[MemoryMesh] metadata: ${JSON.stringify(meta, null, 2)}\n`);
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

// 5. Delete Command
program
  .command('delete')
  .description('Delete a memory by ID')
  .requiredOption('--id <id>', 'Memory record ID to delete')
  .action(async (options) => {
    const mesh = new MemoryMesh();
    try {
      await mesh.init();
      await mesh.delete(options.id);
      process.stdout.write(`[MemoryMesh] Deleted record ${options.id}\n`);
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

// 6. Reflect Command
program
  .command('reflect')
  .description('Query distilled lessons from memory (wisdom distillation)')
  .option('--topic <text>', 'Topic or query to reflect on', '')
  .option('--lookback <n>', 'Limit results to this many lessons', '10')
  .action(async (options) => {
    const mesh = new MemoryMesh();
    try {
      await mesh.init();
      const query = options.topic || 'lessons learned patterns errors fixes';
      const limit = parseInt(options.lookback) || 10;
      const lessons = await mesh.queryLessons(query, { limit });
      if (lessons.length === 0) {
        process.stdout.write(`[MemoryMesh] No lessons found${options.topic ? ` for topic: ${options.topic}` : ''}.\n`);
      } else {
        process.stdout.write(`[MemoryMesh] Reflecting on ${lessons.length} lesson(s):\n\n`);
        for (const lesson of lessons) {
          process.stdout.write(`  scope: ${lesson.applicableScope}\n`);
          process.stdout.write(`  rule:  ${lesson.preventativeRule}\n`);
          process.stdout.write(`  confidence: ${lesson.ruleConfidence}\n`);
          process.stdout.write('\n');
        }
      }
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

program.parse();
