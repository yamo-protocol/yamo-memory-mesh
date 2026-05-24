import { QueryMetrics } from './metrics.js';
export interface CorpusEntry {
    slug: string;
    content: string;
    metadata?: Record<string, unknown>;
}
export interface QueryCase {
    query: string;
    gold: string[];
}
export type RetrievalMode = 'vector' | 'keyword' | 'hybrid' | 'hybrid-rerank' | 'smora';
export interface ModeResult {
    mode: RetrievalMode;
    perQuery: Array<{
        query: string;
        metrics: QueryMetrics;
        topIds: string[];
    }>;
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
    limit?: number;
}
export declare function runEval(corpus: CorpusEntry[], queries: QueryCase[], options?: RunOptions): Promise<EvalReport>;
export declare function loadFixtures(corpusPath: string, queriesPath: string): {
    corpus: CorpusEntry[];
    queries: QueryCase[];
};
export declare function formatReport(report: EvalReport): string;
export declare function defaultFixturePaths(): {
    corpus: string;
    queries: string;
};
