/**
 * MemoryScorer - Calculate memory importance and detect duplicates
 */
export declare class MemoryScorer {
    #private;
    /**
     * @param {MemoryMesh} mesh - MemoryMesh instance for duplicate checking
     */
    constructor(mesh: any);
    /**
     * Calculate importance score for content
     * @param {string} content - Content to score
     * @param {Object} metadata - Associated metadata
     * @returns {Promise<number>} Importance score (0-1)
     */
    calculateImportance(content: any, metadata?: {}): number;
    /**
     * Check if content is duplicate of existing memory
     * @param {string} content - Content to check
     * @param {number} threshold - Similarity threshold (default 0.9)
     * @returns {Promise<boolean>} True if duplicate exists
     */
    isDuplicate(content: any, threshold?: number): Promise<boolean>;
}
export default MemoryScorer;
