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
export class KeywordSearch {
    index; // token -> Map<docId, tf>
    docLengths; // docId -> length
    idf; // token -> idf value
    docs; // docId -> content (optional, for snippet)
    isDirty;
    avgDocLength;
    k1;
    b;
    constructor(options = {}) {
        this.index = new Map();
        this.docLengths = new Map();
        this.idf = new Map();
        this.docs = new Map();
        this.isDirty = false;
        this.avgDocLength = 0;
        // BM25 hyperparameters (Lucene defaults).
        // k1: term frequency saturation — higher = more reward for repeated terms.
        // b:  length normalization — 1.0 fully normalizes, 0.0 ignores doc length.
        this.k1 = options.k1 ?? 1.2;
        this.b = options.b ?? 0.75;
    }
    /**
     * Tokenize text into normalized terms
     * @param {string} text
     * @returns {string[]} tokens
     */
    tokenize(text) {
        if (!text) {
            return [];
        }
        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, "") // Remove punctuation
            .split(/\s+/)
            .filter((t) => t.length > 2) // Filter stopwords/short
            .map((t) => t.substring(0, 20)); // Truncate
    }
    /**
     * Add a document to the index
     * @param {string} id
     * @param {string} content
     * @param {Object} [metadata]
     */
    add(id, content, metadata = {}) {
        const tokens = this.tokenize(content);
        const termFreqs = new Map();
        tokens.forEach((t) => {
            termFreqs.set(t, (termFreqs.get(t) || 0) + 1);
        });
        this.docLengths.set(id, tokens.length);
        this.docs.set(id, { content, metadata });
        // Update index
        for (const [token, freq] of termFreqs.entries()) {
            if (!this.index.has(token)) {
                this.index.set(token, new Map());
            }
            this.index.get(token).set(id, freq);
        }
        this.isDirty = true;
    }
    /**
     * Remove a document
     * @param {string} id
     */
    remove(id) {
        this.docLengths.delete(id);
        this.docs.delete(id);
        // This is expensive O(Vocab), but okay for small scale
        for (const docMap of this.index.values()) {
            docMap.delete(id);
        }
        this.isDirty = true;
    }
    /**
     * Recalculate BM25 IDF and average document length.
     * BM25 IDF: log((N - df + 0.5) / (df + 0.5) + 1) — the "+1" inside log
     * keeps it non-negative when df > N/2.
     */
    _computeStats() {
        if (!this.isDirty) {
            return;
        }
        const N = this.docLengths.size;
        // avgdl over all docs (in tokens, as recorded at index time)
        let totalLen = 0;
        for (const len of this.docLengths.values())
            totalLen += len;
        this.avgDocLength = N > 0 ? totalLen / N : 0;
        this.idf.clear();
        for (const [token, docMap] of this.index.entries()) {
            const df = docMap.size;
            const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
            this.idf.set(token, idf);
        }
        this.isDirty = false;
    }
    /**
     * Search for query terms
     * @param {string} query
     * @param {Object} options
     * @returns {Array<{id: string, score: number, matches: string[], content: string, metadata: Object}>}
     */
    search(query, options = {}) {
        this._computeStats();
        const tokens = this.tokenize(query);
        const scores = new Map(); // docId -> score
        const matches = new Map(); // docId -> matched tokens
        const limit = options.limit || 10;
        const { k1, b, avgDocLength } = this;
        for (const token of tokens) {
            const docMap = this.index.get(token);
            if (!docMap) {
                continue;
            }
            const idf = this.idf.get(token) || 0;
            for (const [docId, tf] of docMap.entries()) {
                // BM25:  idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * |D|/avgdl))
                // Term-frequency saturation (k1) prevents long docs with many
                // repeats from dominating; length normalization (b) penalizes
                // long docs to keep short, focused docs competitive.
                const docLen = this.docLengths.get(docId) || 0;
                const norm = avgDocLength > 0 ? docLen / avgDocLength : 1;
                const denom = tf + k1 * (1 - b + b * norm);
                const score = denom > 0 ? idf * (tf * (k1 + 1)) / denom : 0;
                scores.set(docId, (scores.get(docId) || 0) + score);
                if (!matches.has(docId)) {
                    matches.set(docId, []);
                }
                matches.get(docId).push(token);
            }
        }
        // Convert to array and sort
        return Array.from(scores.entries())
            .map(([id, score]) => ({
            id,
            score,
            matches: matches.get(id) || [],
            ...this.docs.get(id),
        }))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }
    /**
     * Bulk load records
     * @param {Array} records
     */
    load(records) {
        records.forEach((r) => this.add(r.id, r.content, r.metadata));
    }
}
