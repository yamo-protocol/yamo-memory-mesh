/**
 * Retrieval eval runner. Seeds an in-memory MemoryMesh from a corpus fixture,
 * runs each query through each retrieval mode, scores against gold IDs.
 */
import fs from 'fs';
import path from 'path';
import { MemoryMesh } from '../memory/memory-mesh.js';
import { evaluateQuery, meanMetrics, QueryMetrics } from './metrics.js';

export interface CorpusEntry {
  slug: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface QueryCase {
  query: string;
  gold: string[]; // slugs
}

export type RetrievalMode =
  | 'vector'
  | 'keyword'
  | 'hybrid'
  | 'hybrid-rerank'
  | 'smora';

export interface ModeResult {
  mode: RetrievalMode;
  perQuery: Array<{ query: string; metrics: QueryMetrics; topIds: string[] }>;
  mean: QueryMetrics;
  totalLatencyMs: number;
}

export interface EvalReport {
  corpusSize: number;
  querySize: number;
  modes: ModeResult[];
  generatedAt: string;
}

export interface RunOptions {
  modes?: RetrievalMode[];
  limit?: number; // top-K to retrieve per query
}

const DEFAULT_MODES: RetrievalMode[] = [
  'vector',
  'keyword',
  'hybrid',
  'hybrid-rerank',
  'smora',
];

export async function runEval(
  corpus: CorpusEntry[],
  queries: QueryCase[],
  options: RunOptions = {},
): Promise<EvalReport> {
  const modes = options.modes ?? DEFAULT_MODES;
  const limit = options.limit ?? 20;

  // Seed an isolated in-memory mesh. enableReranker on so hybrid-rerank works.
  const mesh = new MemoryMesh({
    dbDir: ':memory:',
    enableYamo: false,
    enableLLM: false,
    enableReranker: true,
  });
  await mesh.init();

  // Map slug → real memory id
  const slugToId = new Map<string, string>();
  for (const entry of corpus) {
    const rec = await mesh.add(entry.content, {
      ...(entry.metadata ?? {}),
      eval_slug: entry.slug,
    });
    slugToId.set(entry.slug, rec.id);
  }

  const results: ModeResult[] = [];
  for (const mode of modes) {
    const t0 = Date.now();
    const perQuery: ModeResult['perQuery'] = [];
    for (const qcase of queries) {
      const goldIds = new Set(
        qcase.gold
          .map((slug) => slugToId.get(slug))
          .filter((id): id is string => typeof id === 'string'),
      );
      if (goldIds.size === 0) {
        // Skip queries whose gold isn't in the seeded corpus.
        continue;
      }
      const top = await retrieve(mesh, qcase.query, mode, limit);
      const topIds = top.map((r) => r.id);
      perQuery.push({
        query: qcase.query,
        metrics: evaluateQuery(top, goldIds),
        topIds: topIds.slice(0, 5),
      });
    }
    results.push({
      mode,
      perQuery,
      mean: meanMetrics(perQuery.map((p) => p.metrics)),
      totalLatencyMs: Date.now() - t0,
    });
  }

  await mesh.close();

  return {
    corpusSize: corpus.length,
    querySize: queries.length,
    modes: results,
    generatedAt: new Date().toISOString(),
  };
}

async function retrieve(
  mesh: MemoryMesh,
  query: string,
  mode: RetrievalMode,
  limit: number,
): Promise<Array<{ id: string }>> {
  if (mode === 'smora') {
    const r = await (mesh as any).smora(query, {
      limit,
      retrievalLimit: Math.max(30, limit * 2),
      enableHyDE: true,
    });
    return r.results.map((x: any) => ({ id: x.id }));
  }
  if (mode === 'hybrid-rerank') {
    // Reranker is on by default when enableReranker:true; mode 'hybrid' uses it.
    const r = await (mesh as any).search(query, { limit, mode: 'hybrid', useCache: false });
    return r;
  }
  // For 'hybrid' without rerank, temporarily disable the reranker on this call.
  if (mode === 'hybrid') {
    const prev = (mesh as any).enableReranker;
    (mesh as any).enableReranker = false;
    try {
      return await (mesh as any).search(query, { limit, mode: 'hybrid', useCache: false });
    } finally {
      (mesh as any).enableReranker = prev;
    }
  }
  // vector | keyword
  return await (mesh as any).search(query, { limit, mode, useCache: false });
}

export function loadFixtures(corpusPath: string, queriesPath: string): {
  corpus: CorpusEntry[];
  queries: QueryCase[];
} {
  const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8')) as CorpusEntry[];
  const queries = JSON.parse(fs.readFileSync(queriesPath, 'utf8')) as QueryCase[];
  return { corpus, queries };
}

export function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`# Retrieval Eval Report`);
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Corpus: ${report.corpusSize} memories · Queries: ${report.querySize}`);
  lines.push('');
  const cols = ['mode', 'R@5', 'R@10', 'R@20', 'MRR', 'nDCG@10', 'ms'];
  const widths = [16, 6, 6, 6, 6, 8, 7];
  const header = cols.map((c, i) => c.padEnd(widths[i])).join(' ');
  lines.push(header);
  lines.push('-'.repeat(header.length));
  for (const m of report.modes) {
    const row = [
      m.mode.padEnd(widths[0]),
      m.mean.recall_at_5.toFixed(3).padEnd(widths[1]),
      m.mean.recall_at_10.toFixed(3).padEnd(widths[2]),
      m.mean.recall_at_20.toFixed(3).padEnd(widths[3]),
      m.mean.mrr.toFixed(3).padEnd(widths[4]),
      m.mean.ndcg_at_10.toFixed(3).padEnd(widths[5]),
      String(m.totalLatencyMs).padEnd(widths[6]),
    ];
    lines.push(row.join(' '));
  }
  return lines.join('\n');
}

export function defaultFixturePaths(): { corpus: string; queries: string } {
  const here = path.dirname(new URL(import.meta.url).pathname);
  return {
    corpus: path.join(here, 'fixtures', 'corpus.json'),
    queries: path.join(here, 'fixtures', 'queries.json'),
  };
}
