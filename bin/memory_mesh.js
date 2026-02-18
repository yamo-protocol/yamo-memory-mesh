#!/usr/bin/env node

/**
 * YAMO MemoryMesh CLI - Singularity Edition (v3.2.0)
 * 
 * State-of-the-art interface for semantic memory orchestration.
 * Features: Interactive progress, beautiful formatting, and bulk ingestion.
 */

import { Command } from 'commander';
import { MemoryMesh } from '../lib/memory/index.js';
import { createLogger } from '../lib/utils/logger.js';
import pc from 'picocolors';
import cliProgress from 'cli-progress';
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

const program = new Command();

program
  .name('memory-mesh')
  .description('YAMO Semantic Subconscious - Protocol-Native CLI')
  .version('3.2.0');

// Helper for beautiful logging
const ui = {
  info: (msg) => console.log(`${pc.blue('ℹ')} ${pc.white(msg)}`),
  success: (msg) => console.log(`${pc.green('✔')} ${pc.green(msg)}`),
  warn: (msg) => console.log(`${pc.yellow('⚠')} ${pc.yellow(msg)}`),
  error: (msg) => console.error(`${pc.red('✖')} ${pc.red(msg)}`),
  header: (msg) => console.log(`\n${pc.bold(pc.cyan('── ' + msg + ' ' + '─'.repeat(50 - msg.length - 4)))}\n`)
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
  .action(async (options) => {
    const mesh = new MemoryMesh();
    try {
      ui.info(`Ingesting into subconscious...`);
      const metadata = {
        type: options.type,
        rationale: options.rationale,
        hypothesis: options.hypothesis,
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
  .option('-e, --extension <ext>', 'File extensions (comma-separated)', '.yamo,.md')
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
  .action(async (query, options) => {
    const mesh = new MemoryMesh();
    try {
      ui.info(`Searching subconscious for "${pc.italic(query)}"...`);
      const results = await mesh.search(query, { limit: parseInt(options.limit) });
      
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

program.parse();
