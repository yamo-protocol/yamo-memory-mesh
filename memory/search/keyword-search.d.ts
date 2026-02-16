/**
 * Simple Keyword Search Engine (In-Memory)
 * Provides basic TF-IDF style retrieval to complement vector search
 */
export interface KeywordDoc {
    content: string;
    metadata?: any;
}
export interface KeywordSearchResult extends KeywordDoc {
    id: string;
    score: number;
    matches: string[];
}
export interface SearchOptions {
    limit?: number;
}
export declare class KeywordSearch {
    index: Map<string, Map<string, number>>;
    docLengths: Map<string, number>;
    idf: Map<string, number>;
    docs: Map<string, KeywordDoc>;
    isDirty: boolean;
    constructor();
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
    add(id: string, content: string, metadata?: any): void;
    /**
     * Remove a document
     * @param {string} id
     */
    remove(id: string): void;
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
    search(query: string, options?: SearchOptions): KeywordSearchResult[];
    /**
     * Bulk load records
     * @param {Array} records
     */
    load(records: {
        id: string;
        content: string;
        metadata?: any;
    }[]): void;
}
