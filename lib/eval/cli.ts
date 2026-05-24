#!/usr/bin/env node
/**
 * Retrieval eval CLI.
 *
 * Usage:
 *   npm run eval:retrieval
 *   npm run eval:retrieval -- --json out.json
 *   npm run eval:retrieval -- --modes vector,hybrid
 *   npm run eval:retrieval -- --corpus path/to/corpus.json --queries path/to/queries.json
 */
import fs from 'fs';
import {
  runEval,
  loadFixtures,
  formatReport,
  defaultFixturePaths,
  RetrievalMode,
} from './runner.js';

interface CliArgs {
  corpus?: string;
  queries?: string;
  json?: string;
  modes?: RetrievalMode[];
  limit?: number;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--corpus') out.corpus = argv[++i];
    else if (a === '--queries') out.queries = argv[++i];
    else if (a === '--json') out.json = argv[++i];
    else if (a === '--modes') out.modes = argv[++i].split(',') as RetrievalMode[];
    else if (a === '--limit') out.limit = parseInt(argv[++i], 10);
    else if (a === '-h' || a === '--help') {
      console.log(
        `Usage: npx tsx tools/eval-retrieval.ts [--corpus PATH] [--queries PATH] [--json PATH] [--modes vector,keyword,hybrid,hybrid-rerank,smora] [--limit N]`,
      );
      process.exit(0);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const defaults = defaultFixturePaths();
  const { corpus, queries } = loadFixtures(
    args.corpus ?? defaults.corpus,
    args.queries ?? defaults.queries,
  );

  console.error(
    `[eval] seeding ${corpus.length} memories, running ${queries.length} queries...`,
  );
  const report = await runEval(corpus, queries, {
    modes: args.modes,
    limit: args.limit,
  });

  console.log(formatReport(report));

  if (args.json) {
    fs.writeFileSync(args.json, JSON.stringify(report, null, 2));
    console.error(`[eval] wrote ${args.json}`);
  }
}

main().catch((err) => {
  console.error('[eval] failed:', err);
  process.exit(1);
});
