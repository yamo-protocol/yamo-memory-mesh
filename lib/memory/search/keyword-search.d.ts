/**
 * In-Memory Keyword Search — BM25 ranking.
 *
 * Used as the fallback path when LanceDB's native Tantivy FTS index is
 * unavailable (fresh tables, test environments, IO errors). The native
 * path also uses BM25, so this fallback keeps ranking consistent.
 *
 * Defaults k1=1.2, b=0.75 follow Lucene. Tune via constructor:
 *   new KeywordSearch({ k1: 1.5, b: 0.5 })
 */
export declare class KeywordSearch {
    index: Map<any, any>;
    docLengths: Map<any, any>;
    idf: Map<any, any>;
    docs: Map<any, any>;
    isDirty: boolean;
    avgDocLength: number;
    k1: number;
    b: number;
    constructor(options?: {
        k1?: number;
        b?: number;
    });
    /**
     * Tokenize text into normalized terms
     * @param {string} text
     * @returns {string[]} tokens
     */
    tokenize(text: string): string[];
    /**
     * Add a document to the index
     * @param {string} id
     * @param {string} content
     * @param {Object} [metadata]
     */
    add(id: string, content: string, metadata?: Record<string, any>): void;
    /**
     * Remove a document
     * @param {string} id
     */
    remove(id: string): void;
    /**
     * Recalculate BM25 IDF and average document length.
     * BM25 IDF: log((N - df + 0.5) / (df + 0.5) + 1) — the "+1" inside log
     * keeps it non-negative when df > N/2.
     */
    _computeStats(): void;
    /**
     * Search for query terms
     * @param {string} query
     * @param {Object} options
     * @returns {Array<{id: string, score: number, matches: string[], content: string, metadata: Object}>}
     */
    search(query: string, options?: {
        limit?: number;
    }): any[];
    /**
     * Bulk load records
     * @param {Array} records
     */
    load(records: any[]): void;
}
