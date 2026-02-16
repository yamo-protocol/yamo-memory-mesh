/**
 * Simple Keyword Search Engine (In-Memory)
 * Provides basic TF-IDF style retrieval to complement vector search
 */
export class KeywordSearch {
    index; // token -> Map<docId, tf>
    docLengths; // docId -> length
    idf; // token -> idf value
    docs; // docId -> content (optional, for snippet)
    isDirty;
    constructor() {
        this.index = new Map();
        this.docLengths = new Map();
        this.idf = new Map();
        this.docs = new Map();
        this.isDirty = false;
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
     * Recalculate IDF scores
     */
    _computeStats() {
        if (!this.isDirty) {
            return;
        }
        const N = this.docLengths.size;
        this.idf.clear();
        for (const [token, docMap] of this.index.entries()) {
            const df = docMap.size;
            // Standard IDF: log(N / (df + 1)) + 1
            const idf = Math.log(N / (df + 1)) + 1;
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
        for (const token of tokens) {
            const docMap = this.index.get(token);
            if (!docMap) {
                continue;
            }
            const idf = this.idf.get(token) || 0;
            for (const [docId, tf] of docMap.entries()) {
                // TF-IDF Score
                // Score = tf * idf * (normalization?)
                // Simple variant:
                const score = tf * idf;
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
