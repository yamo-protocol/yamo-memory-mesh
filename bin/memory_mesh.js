#!/usr/bin/env node

/**
 * YAMO MemoryMesh CLI - Singularity Edition
 *
 * State-of-the-art interface for semantic memory orchestration.
 * Features: Interactive progress, beautiful formatting, and bulk ingestion.
 */

import { createRequire } from 'module';
import { Command } from 'commander';
import { MemoryMesh } from '../lib/memory/index.js';
import { createLogger } from '../lib/utils/logger.js';
import pc from 'picocolors';
import cliProgress from 'cli-progress';
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

const program = new Command();

// Version always tracks package.json — a hardcoded string here drifted before.
const { version } = createRequire(import.meta.url)('../package.json');

program
  .name('memory-mesh')
  .description('YAMO Semantic Subconscious - Protocol-Native CLI')
  .version(version);

// Helper for beautiful logging
const ui = {
  info: (msg) => console.log(`${pc.blue('ℹ')} ${pc.white(msg)}`),
  success: (msg) => console.log(`${pc.green('✔')} ${pc.green(msg)}`),
  warn: (msg) => console.log(`${pc.yellow('⚠')} ${pc.yellow(msg)}`),
  error: (msg) => console.error(`${pc.red('✖')} ${pc.red(msg)}`),
  // Math.max guard: a header longer than the rule width (long pull paths,
  // long ids) must truncate the rule, not crash the command via repeat(-n).
  header: (msg) => console.log(`\n${pc.bold(pc.cyan('── ' + msg + ' ' + '─'.repeat(Math.max(0, 50 - msg.length - 4))))}\n`)
};

// 1. Store/Ingest Command
program
  .command('store')
  .alias('ingest')
  .description('Persist a semantic memory')
  .requiredOption('-c, --content <text>', 'The memory content')
  .option('-t, --type <type>', 'Memory type (e.g., insight, decision, error)', 'event')
  .option('-r, --rationale <text>', 'The constitutional rationale for this memory')
  .option('-h, --hypothesis <text>', 'The associated hypothesis')
  .option('-d, --document-context <text>', 'Explicit global document/source context for situated chunking')
  .option('--depends-on <ids>', 'Decision edge: comma-separated memory IDs this decision depends on')
  .option('--justified-by <ids>', 'Decision edge: comma-separated memory IDs that justify this decision')
  .option('--contradicts <ids>', 'Decision edge: comma-separated memory IDs this decision contradicts')
  .option('-k, --key <key>', 'Stable key: supersedes prior memories with the same key (belief revision)')
  .option('--pin', 'Pin this memory so prime always surfaces it verbatim')
  .option('--defer-until <date>', 'Suppress from recall until this ISO date, then resurface')
  .action(async (options) => {
    const mesh = new MemoryMesh();
    const idList = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);
    try {
      ui.info(`Ingesting into subconscious...`);
      const metadata = {
        type: options.type,
        rationale: options.rationale,
        hypothesis: options.hypothesis,
        documentContext: options.documentContext,
        depends_on: idList(options.dependsOn),
        justified_by: idList(options.justifiedBy),
        contradicts: idList(options.contradicts),
        key: options.key,
        pinned: options.pin === true ? true : undefined,
        defer_until: options.deferUntil,
        source: 'cli-manual'
      };
      
      const record = await mesh.add(options.content, metadata);
      ui.success(`Ingested record ${pc.bold(record.id)}`);
    } catch (err) {
      ui.error(`Ingestion failed: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

// 2. Pull Command (Smart Directory Ingest)
program
  .command('pull')
  .description('Smart recursive repository/directory ingestion')
  .argument('<path>', 'Directory path to pull')
  .option('-e, --extension <ext>', 'File extensions (comma-separated)', '.md,.yamo')
  .option('-t, --type <type>', 'Memory type', 'documentation')
  .action(async (dirPath, options) => {
    const mesh = new MemoryMesh();
    try {
      ui.header(`Pulling Wisdom: ${dirPath}`);
      
      const absolutePath = path.resolve(dirPath);
      if (!fs.existsSync(absolutePath)) {
        throw new Error(`Directory not found: ${absolutePath}`);
      }

      // 1. Discover files
      const extensions = options.extension.split(',').map(e => e.trim());
      const pattern = `**/*{${extensions.join(',')}}`;
      
      ui.info(`Scanning for ${pc.cyan(extensions.join(' ')) } files...`);
      
      const files = await glob(pattern, { cwd: absolutePath, absolute: true, nodir: true });
      
      if (files.length === 0) {
        ui.warn('No matching files found.');
        return;
      }

      ui.info(`Found ${pc.bold(files.length)} files. Starting bulk ingestion...`);

      // 2. Initialize Progress Bar
      const bar = new cliProgress.SingleBar({
        format: `${pc.cyan('Ingesting')} |${pc.cyan('{bar}')}| {percentage}% | {value}/{total} Files | {file}`,
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true
      }, cliProgress.Presets.shades_classic);

      bar.start(files.length, 0, { file: 'Initializing...' });

      // 3. Process
      for (const file of files) {
        const relativeName = path.relative(absolutePath, file);
        bar.update(files.indexOf(file) + 1, { file: relativeName });
        
        const content = fs.readFileSync(file, 'utf-8');
        if (!content.trim()) continue;

        await mesh.add(content, {
          source: relativeName,
          type: options.type,
          ingest_method: 'smart-pull'
        });
      }

      bar.stop();
      ui.success(`Successfully distilled ${pc.bold(files.length)} files into memory.`);
      
    } catch (err) {
      ui.error(`Pull failed: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

// 3. Search Command
program
  .command('search')
  .description('Perform high-fidelity semantic recall')
  .argument('<query>', 'The semantic query')
  .option('-l, --limit <number>', 'Number of results', '5')
  .option('-m, --mode <mode>', 'Search mode: hybrid, vector, keyword', 'hybrid')
  .option('-f, --filter <sql>', 'LanceDB SQL filter clause')
  .action(async (query, options) => {
    const mesh = new MemoryMesh();
    try {
      ui.info(`Searching subconscious for "${pc.italic(query)}"...`);
      const results = await mesh.search(query, {
        limit: parseInt(options.limit),
        mode: options.mode,
        filter: options.filter
      });
      
      if (results.length === 0) {
        ui.warn('No relevant memories found.');
        return;
      }

      ui.header(`Recalled ${results.length} Memories`);
      
      results.forEach((res, i) => {
        const meta = typeof res.metadata === 'string' ? JSON.parse(res.metadata) : res.metadata;
        const scoreColor = res.score > 0.8 ? pc.green : (res.score > 0.5 ? pc.yellow : pc.red);
        
        console.log(`${pc.bold(pc.cyan('Memory ' + (i + 1)))} [Rel: ${scoreColor(res.score.toFixed(2))}]`);
        console.log(`${pc.dim('ID: ' + res.id)} | ${pc.dim('Type: ' + (meta.type || 'event'))}`);
        console.log(`${pc.white(res.content.substring(0, 300))}${res.content.length > 300 ? '...' : ''}`);
        console.log(pc.dim('─'.repeat(40)));
      });
      
    } catch (err) {
      ui.error(`Search failed: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

// 4. Stats Command
program
  .command('stats')
  .description('Subconscious health and database metrics')
  .action(async () => {
    const mesh = new MemoryMesh();
    try {
      const stats = await mesh.stats();
      ui.header('MemoryMesh Subconscious Status');
      
      const statusColor = stats.isConnected ? pc.green : pc.red;
      
      console.log(`${pc.bold('Status:')}      ${statusColor(stats.isConnected ? 'CONNECTED' : 'DISCONNECTED')}`);
      console.log(`${pc.bold('Memories:')}    ${pc.cyan(stats.count)} entries`);
      console.log(`${pc.bold('Skills:')}      ${pc.cyan(stats.totalSkills)} synthesized`);
      console.log(`${pc.bold('Engine:')}      LanceDB (Vector Index)`);
      console.log(`${pc.bold('Model:')}       ${pc.dim(stats.embedding.primary?.modelName || 'Unknown')}`);
      console.log(`${pc.bold('Path:')}        ${pc.dim(stats.uri)}`);
      
    } catch (err) {
      ui.error(`Stats failed: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

// 5. Get Command
program
  .command('get')
  .description('Retrieve a memory record by ID')
  .requiredOption('-i, --id <id>', 'Memory record ID')
  .action(async (options) => {
    const mesh = new MemoryMesh();
    try {
      const record = await mesh.get(options.id);
      if (!record) {
        ui.warn(`Record not found: ${options.id}`);
        process.exit(1);
      }
      const meta = typeof record.metadata === 'string' ? JSON.parse(record.metadata) : (record.metadata || {});
      ui.header(`Memory ${options.id}`);
      console.log(`${pc.bold('ID:')}       ${pc.dim(record.id)}`);
      console.log(`${pc.bold('Type:')}     ${pc.dim(meta.type || 'event')}`);
      console.log(`${pc.bold('Created:')} ${pc.dim(record.created_at)}`);
      console.log(`\n${pc.white(record.content)}`);
    } catch (err) {
      ui.error(`Get failed: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

// 6. Delete Command
program
  .command('delete')
  .description('Permanently remove a memory record by ID')
  .requiredOption('-i, --id <id>', 'Memory record ID to delete')
  .action(async (options) => {
    const mesh = new MemoryMesh();
    try {
      await mesh.delete(options.id);
      ui.success(`Deleted record ${pc.bold(options.id)}`);
    } catch (err) {
      ui.error(`Delete failed: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

// 7. Reflect Command
program
  .command('reflect')
  .description('Synthesize insights from stored memories')
  .option('-t, --topic <topic>', 'Focus the reflection on a specific topic')
  .option('-l, --lookback <number>', 'Number of memories to review', '10')
  .action(async (options) => {
    const mesh = new MemoryMesh();
    try {
      ui.info(`Reflecting on ${options.topic ? `"${pc.italic(options.topic)}"` : 'recent memories'}...`);
      const result = await mesh.reflect({
        topic: options.topic,
        lookback: parseInt(options.lookback),
      });
      ui.header('Reflection');
      if (result.reflection) {
        console.log(pc.white(result.reflection));
        console.log(`\n${pc.bold('Confidence:')} ${pc.cyan((result.confidence * 100).toFixed(0))}%`);
      } else {
        console.log(pc.dim(`Reviewed ${result.count} memories${result.topic ? ` on topic: ${result.topic}` : ''}`));
        console.log(`\n${pc.bold('Prompt for LLM:')}\n${pc.white(result.prompt)}`);
        if (result.context?.length) {
          console.log('');
          result.context.forEach((m, i) => {
            console.log(`${pc.cyan(`Memory ${i + 1}:`)} ${pc.white(m.content.substring(0, 200))}${m.content.length > 200 ? '...' : ''}`);
          });
        }
      }
    } catch (err) {
      ui.error(`Reflect failed: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

// 8. Prime Command (push-based curated recall — the bd prime analog)
program
  .command('prime')
  .description('Emit pinned memories verbatim, newly-due deferred memories, and contextual matches')
  .argument('[query]', 'Optional query for the contextual section')
  .option('-l, --limit <number>', 'Contextual results', '5')
  .action(async (query, options) => {
    const mesh = new MemoryMesh();
    try {
      const out = await mesh.prime(query, { limit: parseInt(options.limit) });
      ui.header(`Pinned (${out.pinned.length})`);
      out.pinned.forEach((p) => {
        console.log(`${pc.bold(pc.cyan(p.metadata?.key || p.id))}`);
        console.log(`${pc.white(p.content)}`);
        console.log(pc.dim('─'.repeat(40)));
      });
      if (out.due.length > 0) {
        ui.header(`Due (${out.due.length})`);
        out.due.forEach((d) => {
          console.log(`${pc.bold(pc.yellow(d.id))} ${pc.dim('(deferred until ' + d.defer_until + ')')}`);
          console.log(`${pc.white(d.content)}`);
          console.log(pc.dim('─'.repeat(40)));
        });
      }
      ui.header(`Contextual (${out.contextual.length})`);
      out.contextual.forEach((c) => {
        console.log(`${pc.dim(c.id)} [${c.score.toFixed(2)}] ${pc.white(c.content.substring(0, 200))}${c.content.length > 200 ? '...' : ''}`);
      });
    } catch (err) {
      ui.error(`Prime failed: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

// 9. Pin / Unpin
program
  .command('pin')
  .description('Pin a memory (by id or stable key) so prime always surfaces it')
  .argument('<idOrKey>', 'Memory id or metadata.key')
  .action(async (idOrKey) => {
    const mesh = new MemoryMesh();
    try {
      const res = await mesh.pin(idOrKey);
      ui.success(`Pinned ${pc.bold(res.id)}`);
    } catch (err) {
      ui.error(`Pin failed: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

program
  .command('unpin')
  .description('Unpin a memory (by id or stable key)')
  .argument('<idOrKey>', 'Memory id or metadata.key')
  .action(async (idOrKey) => {
    const mesh = new MemoryMesh();
    try {
      const res = await mesh.unpin(idOrKey);
      ui.success(`Unpinned ${pc.bold(res.id)}`);
    } catch (err) {
      ui.error(`Unpin failed: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

// 10. Lifecycle: set-state / defer
program
  .command('set-state')
  .description('Set a memory lifecycle state: active | superseded | deprecated | archived')
  .argument('<id>', 'Memory id')
  .argument('<state>', 'Target state')
  .action(async (id, state) => {
    const mesh = new MemoryMesh();
    try {
      const res = await mesh.setState(id, state);
      ui.success(`${pc.bold(id)}: ${res.previous ?? 'active'} → ${res.state}`);
    } catch (err) {
      ui.error(`set-state failed: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

program
  .command('defer')
  .description('Suppress a memory from recall until a date, then resurface it (bd defer analog)')
  .argument('<id>', 'Memory id')
  .argument('[until]', 'ISO date; omit with --clear to remove the deferral')
  .option('--clear', 'Clear an existing deferral')
  .action(async (id, until, options) => {
    const mesh = new MemoryMesh();
    try {
      const res = await mesh.deferMemory(id, options.clear ? null : until);
      ui.success(res.defer_until ? `Deferred ${pc.bold(id)} until ${res.defer_until}` : `Cleared deferral on ${pc.bold(id)}`);
    } catch (err) {
      ui.error(`Defer failed: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

// 11. History / Restore (bd history / bd restore analogs)
program
  .command('history')
  .description('Show the append-only revision history for a memory or skill id')
  .argument('<id>', 'Memory or skill id')
  .action(async (id) => {
    const mesh = new MemoryMesh();
    try {
      const rows = await mesh.history(id);
      if (rows.length === 0) {
        ui.warn('No revisions recorded.');
        return;
      }
      ui.header(`History for ${id} (${rows.length})`);
      rows.forEach((r) => {
        console.log(`${pc.dim(r.created_at)} ${pc.bold(pc.cyan(r.field))} ${pc.red(JSON.stringify(r.old_value))} → ${pc.green(JSON.stringify(r.new_value))}${r.actor ? pc.dim(' by ' + r.actor) : ''}`);
      });
    } catch (err) {
      ui.error(`History failed: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

program
  .command('restore')
  .description('Restore a deleted memory from its revision snapshot')
  .argument('<id>', 'Deleted memory id')
  .action(async (id) => {
    const mesh = new MemoryMesh();
    try {
      const res = await mesh.restoreDeleted(id);
      if (!res) {
        ui.warn(`No deletion snapshot found for ${id}.`);
        process.exit(1);
      }
      ui.success(`Restored ${pc.bold(res.id)}`);
    } catch (err) {
      ui.error(`Restore failed: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

// 12. Stale beliefs (bd blocked pointed backward at beliefs)
program
  .command('stale-beliefs')
  .description('List memories still resting on refuted decisions')
  .argument('[id]', 'Optional: check dependents of this memory only')
  .action(async (id) => {
    const mesh = new MemoryMesh();
    try {
      const report = await mesh.staleBeliefs(id ? { memoryId: id } : {});
      const withDeps = report.filter((r) => r.dependents.length > 0);
      if (withDeps.length === 0) {
        ui.success('No stale beliefs: nothing rests on a refuted decision.');
        return;
      }
      withDeps.forEach((entry) => {
        ui.header(`Refuted: ${entry.refuted.id}`);
        if (entry.refuted.content) console.log(pc.white(entry.refuted.content.substring(0, 200)));
        if (entry.refuted.note) console.log(pc.dim(`note: ${entry.refuted.note}`));
        entry.dependents.forEach((d) => {
          console.log(`  ${pc.yellow('↳')} [hop ${d.hop}, ${d.relation}] ${pc.bold(d.id)} ${pc.dim(d.content ? d.content.substring(0, 120) : '')}`);
        });
      });
      process.exit(1);
    } catch (err) {
      ui.error(`stale-beliefs failed: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

// 13. Export / Import (the issues.jsonl principle)
program
  .command('export')
  .description('Write a deterministic, vector-free JSONL export (git-committable)')
  .argument('<path>', 'Output file path')
  .action(async (outPath) => {
    const mesh = new MemoryMesh();
    try {
      const res = await mesh.exportJsonl(outPath);
      ui.success(`Exported ${pc.bold(res.lines - 1)} rows to ${res.path}`);
    } catch (err) {
      ui.error(`Export failed: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

program
  .command('import')
  .description('Import a JSONL export, re-embedding content locally (idempotent)')
  .argument('<path>', 'Export file path')
  .action(async (inPath) => {
    const mesh = new MemoryMesh();
    try {
      const counts = await mesh.importJsonl(inPath);
      ui.header('Import complete');
      Object.entries(counts).forEach(([table, c]) => {
        console.log(`${pc.bold(table)}: ${pc.green(c.imported + ' imported')}, ${pc.dim(c.skipped + ' skipped')}`);
      });
    } catch (err) {
      ui.error(`Import failed: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

// 14. Doctor / Stale / Orphans (hygiene tooling)
program
  .command('doctor')
  .description('Run mechanical health checks; exits nonzero on failure')
  .action(async () => {
    const mesh = new MemoryMesh();
    try {
      const res = await mesh.doctor();
      ui.header('Mesh Doctor');
      res.checks.forEach((c) => {
        const mark = c.ok ? pc.green('✔') : pc.red('✖');
        console.log(`${mark} ${pc.bold(c.name)} ${pc.dim(c.detail)}`);
      });
      if (!res.ok) {
        ui.error('Doctor found problems.');
        process.exit(1);
      }
      ui.success('All checks passed.');
    } catch (err) {
      ui.error(`Doctor failed: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

program
  .command('stale')
  .description('List active memories untouched for N days (bd stale analog)')
  .option('-d, --days <number>', 'Staleness threshold in days', '90')
  .option('-l, --limit <number>', 'Max rows', '50')
  .action(async (options) => {
    const mesh = new MemoryMesh();
    try {
      const rows = await mesh.staleMemoriesReport({ days: parseInt(options.days), limit: parseInt(options.limit) });
      if (rows.length === 0) {
        ui.success('No stale memories.');
        return;
      }
      ui.header(`Stale memories (${rows.length})`);
      rows.forEach((r) => {
        console.log(`${pc.dim(r.last_touch || 'never')} ${pc.bold(r.id)} ${pc.white(r.content)}`);
      });
    } catch (err) {
      ui.error(`Stale failed: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

program
  .command('orphans')
  .description('List decision edges whose endpoints no longer resolve')
  .action(async () => {
    const mesh = new MemoryMesh();
    try {
      const rows = await mesh.orphanEdges();
      if (rows.length === 0) {
        ui.success('No orphaned decision edges.');
        return;
      }
      ui.header(`Orphaned edges (${rows.length})`);
      rows.forEach((r) => {
        console.log(`${pc.bold(r.id)} ${r.source_id} ${pc.dim('-[' + r.relation + ']->')} ${r.target_id} ${pc.red('missing: ' + r.missing.join(', '))}`);
      });
      process.exit(1);
    } catch (err) {
      ui.error(`Orphans failed: ${err.message}`);
      process.exit(1);
    } finally {
      await mesh.close();
    }
  });

program.parse();
