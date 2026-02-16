/**
 * Simple Keyword Search Engine (In-Memory)
 * Provides basic TF-IDF style retrieval to complement vector search
 */
export declare class KeywordSearch {
    index: any;
    docLengths: any;
    idf: any;
    docs: any;
    isDirty: any;
    constructor();
    /**
     * Tokenize text into normalized terms
     * @param {string} text
     * @returns {string[]} tokens
     */
    tokenize(text: any): any;
    /**
     * Add a document to the index
     * @param {string} id
     * @param {string} content
     * @param {Object} [metadata]
     */
    add(id: any, content: any, metadata?: {}): void;
    /**
     * Remove a document
     * @param {string} id
     */
    remove(id: any): void;
    /**
     * Recalculate IDF scores
     */
    _computeStats(): void;
    /**
     * Search for query terms
     * @param {string} query
     * @param {Object} options
     * @returns {Array<{id: string, score: number, matches: string[], content: string, metadata: Object}>}
     */
    search(query: any, options?: {}): any[];
    /**
     * Bulk load records
     * @param {Array} records
     */
    load(records: any): void;
}
