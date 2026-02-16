// @ts-nocheck
/**
 * MemoryScorer - Calculate memory importance and detect duplicates
 */
export class MemoryScorer {
    #mesh;
    /**
     * @param {MemoryMesh} mesh - MemoryMesh instance for duplicate checking
     */
    constructor(mesh) {
        this.#mesh = mesh;
    }
    /**
     * Calculate importance score for content
     * @param {string} content - Content to score
     * @param {Object} metadata - Associated metadata
     * @returns {Promise<number>} Importance score (0-1)
     */
    calculateImportance(content, metadata = {}) {
        let score = 0;
        // Content length (longer = more important, up to a point)
        const length = content.length;
        score += Math.min(length / 1000, 0.2);
        // Has structured data (JSON, code blocks)
        if (content.includes("```") || content.includes("{")) {
            score += 0.1;
        }
        // Interaction type bonuses
        if (metadata.interaction_type === "tool_execution") {
            score += 0.15;
        }
        if (metadata.interaction_type === "file_operation") {
            score += 0.1;
        }
        // Tool usage indicates importance
        if (metadata.tools_used?.length > 0) {
            score += Math.min(metadata.tools_used.length * 0.05, 0.15);
        }
        // File involvement
        if (metadata.files_involved?.length > 0) {
            score += Math.min(metadata.files_involved.length * 0.05, 0.15);
        }
        // Keywords that indicate importance
        const importantKeywords = [
            "error",
            "bug",
            "fix",
            "important",
            "critical",
            "note",
            "remember",
        ];
        const lowerContent = content.toLowerCase();
        const keywordMatches = importantKeywords.filter((k) => lowerContent.includes(k)).length;
        score += Math.min(keywordMatches * 0.05, 0.15);
        return Math.min(score, 1.0);
    }
    /**
     * Check if content is duplicate of existing memory
     * @param {string} content - Content to check
     * @param {number} threshold - Similarity threshold (default 0.9)
     * @returns {Promise<boolean>} True if duplicate exists
     */
    async isDuplicate(content, threshold = 0.9) {
        try {
            const results = await this.#mesh.search(content, {
                limit: 1,
                useCache: false,
            });
            return results.length > 0 && results[0].score >= threshold;
        }
        catch (_error) {
            // On error, assume not duplicate to allow storage
            return false;
        }
    }
}
export default MemoryScorer;
