import type { MemoryMesh, RankedMemory } from "../memory-mesh.js";
/**
 * Search memory using hybrid vector + keyword search with Reciprocal Rank Fusion (RRF).
 *
 * This method performs semantic search by combining:
 * 1. **Vector Search**: Uses embeddings to find semantically similar content
 * 2. **Keyword Search**: Uses BM25-style keyword matching
 * 3. **RRF Fusion**: Combines both result sets using Reciprocal Rank Fusion
 *
 * The RRF algorithm scores each document as: `sum(1 / (k + rank))` where k=60.
 * This gives higher scores to documents that rank well in BOTH searches.
 *
 * **Performance**: Uses adaptive sorting strategy
 * - Small datasets (≤ 2× limit): Full sort O(n log n)
 * - Large datasets: Partial selection sort O(n×k) where k=limit
 *
 * **Caching**: Results are cached for 5 minutes by default (configurable via options)
 *
 * @param query - The search query text
 * @param options - Search options
 * @param options.limit - Maximum results to return (default: 10)
 * @param options.filter - LanceDB filter expression (e.g., "type == 'preference'")
 * @param options.useCache - Enable/disable result caching (default: true)
 * @returns Promise with array of search results, sorted by relevance score
 *
 * @example
 * ```typescript
 * // Simple search
 * const results = await mesh.search("TypeScript preferences");
 *
 * // Search with filter
 * const code = await mesh.search("bug fix", { filter: "type == 'error'" });
 *
 * // Search with limit
 * const top3 = await mesh.search("security issues", { limit: 3 });
 * ```
 *
 * @throws {Error} If embedding generation fails
 * @throws {Error} If database client is not initialized
 */
export declare function search(mesh: MemoryMesh, query: string, options?: {
    limit?: number;
    filter?: any;
    mode?: string;
    useCache?: boolean;
    includeArchived?: boolean;
}): Promise<RankedMemory[]>;
export declare function _keywordSearch(mesh: MemoryMesh, query: string, limit: number, filter?: any, opts?: {
    includeArchived?: boolean;
}): Promise<RankedMemory[]>;
export declare function _normalizeScores(_mesh: MemoryMesh, results: RankedMemory[]): RankedMemory[];
/**
 * Tokenize query for keyword matching (private helper for searchSkills)
 * Converts text to lowercase tokens, filtering out short tokens and punctuation.
 * Handles camelCase/PascalCase by splitting on uppercase letters.
 */
export declare function _tokenizeQuery(_mesh: MemoryMesh, text: string): string[];
export declare function formatResults(_mesh: MemoryMesh, results: any[]): string;
