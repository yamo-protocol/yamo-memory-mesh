/**
 * Token Counting Utilities
 * @module smora/scrubber/utils/token-counter
 */
export declare class TokenCounter {
    /**
     * Estimate token count (approximation)
     * @param {string} text - Text to count
     * @returns {number} - Estimated token count
     */
    count(text: any): number;
    /**
     * More accurate token count (slower)
     * @param {string} text - Text to count
     * @returns {number} - More accurate token count
     */
    countAccurate(text: any): any;
}
